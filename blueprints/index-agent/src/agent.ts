/**
 * Index agent — global portfolio.
 *
 * Deposits USDC, invests it across the user's weighted token basket, and keeps
 * the basket rebalanced toward global target weights. Runs in cross-chain mode:
 * the runner invokes tick() once and this
 * executable drives each chain via ctx.chain(id).
 *
 * Reads the machine-readable strategy config from .sail/index.json, written at
 * onboarding by the sailor-index skill. See
 * sailor-index/references/index-category.md for the schema.
 *
 * Cross-chain: when a token must be bought on a chain that holds no USDC, the
 * agent bridges USDC there via CCTP (approve + depositForBurn), gated on-chain
 * by the CctpBridgePermission (see the sailor-cctp-bridge skill). The mint
 * recipient is the SMA's own address, which is CREATE2-identical on every chain.
 */

import fs from "node:fs";
import path from "node:path";
import type { Address, Agent, AgentContext, Dispatch } from "@sail.money/sailor/sdk";
import { encodeFunctionData } from "viem";
import {
  buildSnapshot,
  composeReport,
  sendTelegramReport,
  shouldRun,
  writeSnapshot,
} from "./report.js";

// ── Config (.sail/index.json) ────────────────────────────────────────────────

export type ChainToken = { chainId: number; address: Address; decimals: number; feeTier: number };

export type BasketToken = {
  symbol: string;
  weight: number; // 0..1, sums to 1.0 across the basket
  chains: ChainToken[]; // ordered deepest-liquidity-first: the routing preference
};

export type IndexConfig = {
  chains: number[];
  usdc: Record<string, Address>; // chainId -> USDC
  router: Record<string, Address>; // chainId -> Uniswap V3 SwapRouter02
  quoter: Record<string, Address>; // chainId -> Uniswap V3 QuoterV2
  bridge: {
    messenger: Record<string, Address>; // source chain -> CCTP TokenMessenger
    domains: Record<string, number>; // chain -> CCTP domain id
    maxPerTxUsd: number;
  };
  basket: BasketToken[];
  /**
   * Optional cadence-DCA setting. When present, the agent buys `amountUsd` every
   * `periodSec` (split across tokens by target weight) instead of deploying every
   * idle USDC. When absent, the agent invests any idle USDC as it arrives.
   */
  dca?: { amountUsd: number; periodSec: number };
  rebalanceBandBps: number; // basis points, e.g. 500 = ±5 percentage points
  maxSlippageBps: number;
  /** Optional. How often (seconds) the agent trims overweight holdings. 0 or absent = every run. */
  rebalancePeriodSec?: number;
  /** Optional. When present, the agent sends a Telegram report every `cadenceSec`. */
  report?: { cadenceSec: number; channel: "telegram" };
};

export function loadConfig(): IndexConfig {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), ".sail", "index.json"), "utf-8"),
  ) as IndexConfig;
}

function specFor(token: BasketToken, chainId: number): ChainToken | undefined {
  return token.chains.find((c) => c.chainId === chainId);
}

// ── ABI fragments (only what the loop calls) ─────────────────────────────────

const QUOTER_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const DEPOSIT_FOR_BURN_ABI = [
  {
    name: "depositForBurn",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;

// ── Memory ledger (.sail/memory/ledger.jsonl) ────────────────────────────────
// Append-only, chain-reconciled record. The cadence and in-flight-bridge guards
// read here, not ctx.data, because ctx.data resets on every fresh process. Full
// reconciliation follows the canonical skeleton in
// sailor-agent-build/references/canonical-skeleton.md.

/** Ledger file path, resolved at call time so tests can chdir into a fresh project. */
function ledgerPath(): string {
  return path.join(process.cwd(), ".sail", "memory", "ledger.jsonl");
}

function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function appendLedger(entry: Record<string, unknown>): void {
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

/** Timestamp of the most recent bridge to `destChain`, to avoid re-bridging while a mint is in flight. */
function lastBridgeTs(destChain: number): number {
  const lines = readLines(ledgerPath());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i]) as { kind?: string; dest?: number; ts?: number };
      if (e.kind === "bridged" && e.dest === destChain) return e.ts ?? 0;
    } catch {
      // skip
    }
  }
  return 0;
}

/** Timestamp of the most recent cadence-DCA investment, to space the periodic buys. */
function lastInvestTs(): number {
  const lines = readLines(ledgerPath());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i]) as { kind?: string; ts?: number };
      if (e.kind === "invested") return e.ts ?? 0;
    } catch {
      // skip
    }
  }
  return 0;
}

/** Timestamp of the most recent rebalance trim, to honor the rebalance cadence. */
function lastRebalanceTs(): number {
  const lines = readLines(ledgerPath());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i]) as { kind?: string; ts?: number };
      if (e.kind === "rebalanced") return e.ts ?? 0;
    } catch {
      // skip
    }
  }
  return 0;
}

/** Timestamp of the most recent report, to honor the report cadence. */
function lastReportTs(): number {
  const lines = readLines(ledgerPath());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i]) as { kind?: string; ts?: number };
      if (e.kind === "reported") return e.ts ?? 0;
    } catch {
      // skip
    }
  }
  return 0;
}

/**
 * Cumulative USDC spent on buys and received from sells, read from the ledger.
 * The cost basis of current holdings is `invested - sold`; unrealized P&L is
 * `investedValue - costBasis` (which equals total return while there are no
 * withdrawals).
 */
function cumulativeCost(): { invested: bigint; sold: bigint } {
  let invested = 0n;
  let sold = 0n;
  for (const line of readLines(ledgerPath())) {
    try {
      const e = JSON.parse(line) as { kind?: string; amount?: string };
      if (e.kind === "bought" && e.amount) invested += BigInt(e.amount);
      else if (e.kind === "sold" && e.amount) sold += BigInt(e.amount);
    } catch {
      // skip
    }
  }
  return { invested, sold };
}

// ── Pricing and dispatch ─────────────────────────────────────────────────────

const USDC_DECIMALS = 6;
const USDC_ONE = 10n ** BigInt(USDC_DECIMALS); // 1 USDC in base units
const BRIDGE_PENDING_SEC = 1800; // don't re-bridge a chain while its mint is in flight
const DUST_USD = 10n * USDC_ONE; // skip investments below 10 USDC to avoid gas-wasteful dust

/** Quote a swap on a chain; returns amountOut, or null on revert or zero (fail closed). */
async function quoteSwap(
  ctx: AgentContext,
  chainId: number,
  cfg: IndexConfig,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  feeTier: number,
): Promise<bigint | null> {
  try {
    const q = await ctx.chain(chainId).publicClient.simulateContract({
      address: cfg.quoter[String(chainId)],
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee: feeTier, sqrtPriceLimitX96: 0n }],
    });
    const amountOut = (q.result as readonly [bigint, bigint, number, bigint])[0];
    return amountOut === 0n ? null : amountOut;
  } catch {
    return null;
  }
}

/** Build a swap dispatch on a chain. Returns null when the quote fails (skip, no gas). */
async function swap(
  ctx: AgentContext,
  chainId: number,
  cfg: IndexConfig,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  feeTier: number,
): Promise<Dispatch | null> {
  const expectedOut = await quoteSwap(ctx, chainId, cfg, tokenIn, tokenOut, amountIn, feeTier);
  if (expectedOut === null) return null;
  const minOut = (expectedOut * BigInt(10_000 - cfg.maxSlippageBps)) / 10_000n;
  const data = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        fee: feeTier,
        recipient: ctx.safe,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return ctx
    .chain(chainId)
    .dispatch({ calls: [{ target: cfg.router[String(chainId)], value: 0n, data }] });
}

/** USDC-denominated value of the SMA's holding of a token on one chain. */
export async function usdcValueOf(
  ctx: AgentContext,
  cfg: IndexConfig,
  spec: ChainToken,
): Promise<bigint> {
  const balance = await ctx.chain(spec.chainId).read.balance(spec.address);
  if (balance === 0n) return 0n;
  const oneUnit = 10n ** BigInt(spec.decimals);
  const usdcPerToken = await quoteSwap(
    ctx,
    spec.chainId,
    cfg,
    spec.address,
    cfg.usdc[String(spec.chainId)],
    oneUnit,
    spec.feeTier,
  );
  if (usdcPerToken === null) return 0n; // unpriceable holding: fail closed, value 0
  return (balance * usdcPerToken) / oneUnit;
}

/** First chain (in liquidity order) where the token is routable and the SMA holds enough USDC. */
async function pickBuyChain(
  ctx: AgentContext,
  cfg: IndexConfig,
  token: BasketToken,
  buyUsd: bigint,
): Promise<number | null> {
  for (const spec of token.chains) {
    const usdcBalance = await ctx.chain(spec.chainId).read.balance(cfg.usdc[String(spec.chainId)]);
    if (usdcBalance >= buyUsd) return spec.chainId;
  }
  return null;
}

/** First chain (in liquidity order) where the SMA holds a balance of the token. */
async function pickSellChain(
  ctx: AgentContext,
  cfg: IndexConfig,
  token: BasketToken,
): Promise<number | null> {
  for (const spec of token.chains) {
    const balance = await ctx.chain(spec.chainId).read.balance(spec.address);
    if (balance > 0n) return spec.chainId;
  }
  return null;
}

/** Chain (other than `destChain`) holding the most USDC, to fund a bridge. */
async function pickSourceChain(
  ctx: AgentContext,
  cfg: IndexConfig,
  destChain: number,
  amount: bigint,
): Promise<number | null> {
  let best: number | null = null;
  let bestUsdc = 0n;
  for (const chainId of cfg.chains) {
    if (chainId === destChain) continue;
    const usdcBalance = await ctx.chain(chainId).read.balance(cfg.usdc[String(chainId)]);
    if (usdcBalance >= amount && usdcBalance > bestUsdc) {
      best = chainId;
      bestUsdc = usdcBalance;
    }
  }
  return best;
}

/** Bridge USDC from source to dest via CCTP. Approves first when allowance is short. */
async function bridgeUsdc(
  ctx: AgentContext,
  cfg: IndexConfig,
  sourceChain: number,
  destChain: number,
  amount: bigint,
): Promise<Dispatch | null> {
  const ch = ctx.chain(sourceChain);
  const usdc = cfg.usdc[String(sourceChain)];
  const messenger = cfg.bridge.messenger[String(sourceChain)];
  const allowance = await ch.read.allowance(usdc, ctx.safe, messenger);
  if (allowance < amount) {
    const data = encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [messenger, amount],
    });
    return ch.dispatch({ calls: [{ target: usdc, value: 0n, data }] });
  }
  const domain = cfg.bridge.domains[String(destChain)];
  // Self-recipient: the SMA's own address, left-padded to bytes32. CREATE2 makes it
  // the same address on every chain, so this lands at the account's own address there.
  const mintRecipient = `0x${"0".repeat(24)}${ctx.safe.slice(2)}` as `0x${string}`;
  const data = encodeFunctionData({
    abi: DEPOSIT_FOR_BURN_ABI,
    functionName: "depositForBurn",
    args: [amount, domain, mintRecipient, usdc],
  });
  return ch.dispatch({ calls: [{ target: messenger, value: 0n, data }] });
}

// ── The agent ────────────────────────────────────────────────────────────────

const BPS = 10_000n;

export const agent: Agent = {
  name: "index-agent",
  description:
    "Invest USDC into a weighted token basket and keep it rebalanced toward global target weights across named chains.",

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    const cfg = loadConfig();
    ctx.log(`tick — block ${ctx.blockNumber}, chains ${cfg.chains.join(",")}`);

    // 1. Value the portfolio in USDC across every named chain.
    let usdcTotal = 0n;
    for (const chainId of cfg.chains) {
      usdcTotal += await ctx.chain(chainId).read.balance(cfg.usdc[String(chainId)]);
    }

    const entries: { token: BasketToken; value: bigint; weightBps: bigint; targetBps: bigint }[] =
      [];
    for (const token of cfg.basket) {
      let value = 0n;
      for (const spec of token.chains) {
        value += await usdcValueOf(ctx, cfg, spec);
      }
      entries.push({
        token,
        value,
        weightBps: 0n,
        targetBps: BigInt(Math.round(token.weight * 10_000)),
      });
    }

    const investedValue = entries.reduce((a, e) => a + e.value, 0n);
    const totalValue = usdcTotal + investedValue;
    if (totalValue === 0n) {
      ctx.log("portfolio empty — skipping");
      appendLedger({
        ts: ctx.timestamp,
        block: Number(ctx.blockNumber),
        kind: "skipped",
        reason: "portfolio empty",
      });
      return [];
    }
    // Weights are measured against the invested portfolio in DCA mode (idle USDC is a
    // war chest, not dilution) and against the full portfolio in invest mode (idle USDC
    // is to be deployed). The mode is read once here.
    const dca = cfg.dca;
    const valueBase = dca ? investedValue : totalValue;
    for (const e of entries) {
      e.weightBps = valueBase === 0n ? 0n : (e.value * BPS) / valueBase;
    }

    const dispatches: Dispatch[] = [];
    const bandBps = BigInt(cfg.rebalanceBandBps);
    const cap = BigInt(Math.round(cfg.bridge.maxPerTxUsd * 1e6));

    // 2. Rebalance the overweight leg: sell tokens that drifted above their target
    //    band back to USDC. The USDC this raises is invested on a later tick. Trimming
    //    follows the rebalance cadence (rebalancePeriodSec); buying toward target stays
    //    continuous so deposits are invested promptly.
    const rebalanceDue = shouldRun(ctx.timestamp, lastRebalanceTs(), cfg.rebalancePeriodSec ?? 0);
    if (rebalanceDue) {
      let sold = false;
      for (const e of entries) {
        const excessBps = e.weightBps - e.targetBps;
        if (excessBps <= bandBps) continue;
        const chainId = await pickSellChain(ctx, cfg, e.token);
        if (chainId === null) {
          ctx.log(`no balance to sell ${e.token.symbol} — skipping`);
          continue;
        }
        const spec = specFor(e.token, chainId);
        if (!spec) continue;
        const balance = await ctx.chain(chainId).read.balance(spec.address);
        const amountIn = (balance * excessBps) / e.weightBps; // excess fraction of the holding
        if (amountIn === 0n) continue;
        const proceeds = await quoteSwap(
          ctx,
          chainId,
          cfg,
          spec.address,
          cfg.usdc[String(chainId)],
          amountIn,
          spec.feeTier,
        );
        if (proceeds === null) continue;
        const d = await swap(
          ctx,
          chainId,
          cfg,
          spec.address,
          cfg.usdc[String(chainId)],
          amountIn,
          spec.feeTier,
        );
        if (d) {
          dispatches.push(d);
          sold = true;
          appendLedger({ ts: ctx.timestamp, kind: "sold", amount: proceeds.toString() });
        }
      }
      if (sold) appendLedger({ ts: ctx.timestamp, kind: "rebalanced" });
    }

    // 3. Buy toward target. Two modes, chosen at onboarding:
    //    - invest (no `dca`): deploy idle USDC by buying each token's shortfall — a fresh
    //      deposit is idle USDC, so the next tick invests it across the whole basket.
    //    - dca: buy a fixed amount every period split by target weight, and rebalance-buy
    //      tokens that drift below their band between periods.
    const dcaDue = dca ? ctx.timestamp - lastInvestTs() >= dca.periodSec : false;
    for (const e of entries) {
      let buyUsd: bigint;
      if (dca) {
        if (dcaDue) {
          buyUsd = BigInt(Math.round(dca.amountUsd * e.token.weight * 1e6)); // periodic, proportional
        } else {
          const deficitBps = e.targetBps - e.weightBps;
          if (deficitBps <= bandBps) continue;
          buyUsd = (valueBase * deficitBps) / BPS; // rebalance-buy
        }
      } else {
        const targetValue = (totalValue * e.targetBps) / BPS;
        const shortfall = targetValue - e.value;
        if (shortfall <= DUST_USD) continue;
        buyUsd = shortfall;
      }
      if (buyUsd > cap) buyUsd = cap;
      if (buyUsd <= 0n) continue;

      const chainId = await pickBuyChain(ctx, cfg, e.token, buyUsd);
      if (chainId !== null) {
        const spec = specFor(e.token, chainId);
        if (!spec) continue;
        const d = await swap(
          ctx,
          chainId,
          cfg,
          cfg.usdc[String(chainId)],
          spec.address,
          buyUsd,
          spec.feeTier,
        );
        if (d) {
          dispatches.push(d);
          appendLedger({ ts: ctx.timestamp, kind: "bought", amount: buyUsd.toString() });
        }
        continue;
      }

      // No chain holds USDC where this token is routable: bridge USDC to the preferred chain.
      const dest = e.token.chains[0].chainId;
      if (ctx.timestamp - lastBridgeTs(dest) < BRIDGE_PENDING_SEC) {
        ctx.log(`bridge to chain ${dest} in flight — waiting for mint`);
        continue;
      }
      const source = await pickSourceChain(ctx, cfg, dest, buyUsd);
      if (source === null) {
        ctx.log(`no source USDC to bridge for ${e.token.symbol} — skipping`);
        continue;
      }
      const d = await bridgeUsdc(ctx, cfg, source, dest, buyUsd);
      if (d) {
        dispatches.push(d);
        appendLedger({
          ts: ctx.timestamp,
          kind: "bridged",
          source,
          dest,
          amount: buyUsd.toString(),
        });
      }
    }

    // 4. Write the display snapshot (the report and the dashboard both read it), then
    //    send a Telegram report when the cadence is due. Both are best-effort: a
    //    snapshot or send failure never stops a dispatch.
    const { invested, sold } = cumulativeCost();
    const snapshot = buildSnapshot({
      usdcTotal,
      holdings: entries.map((e) => ({
        symbol: e.token.symbol,
        value: e.value,
        targetBps: e.targetBps,
      })),
      bandBps: cfg.rebalanceBandBps,
      costBasis: invested - sold,
      asOf: ctx.timestamp,
    });
    writeSnapshot(snapshot);

    if (cfg.report && shouldRun(ctx.timestamp, lastReportTs(), cfg.report.cadenceSec)) {
      try {
        const asOf = new Date(ctx.timestamp * 1000).toISOString().slice(0, 10);
        await sendTelegramReport(composeReport(snapshot, { asOf }));
        appendLedger({ ts: ctx.timestamp, kind: "reported" });
      } catch (err) {
        ctx.log(`report failed: ${(err as Error).message}`);
      }
    }

    // Record the cadence so the next periodic buy waits a full period.
    if (dca && dcaDue) {
      appendLedger({ ts: ctx.timestamp, kind: "invested" });
    }

    if (dispatches.length === 0) {
      appendLedger({
        ts: ctx.timestamp,
        block: Number(ctx.blockNumber),
        kind: "skipped",
        reason: "nothing actionable",
      });
    } else {
      ctx.log(`dispatching ${dispatches.length} call(s)`);
    }
    return dispatches;
  },
};
