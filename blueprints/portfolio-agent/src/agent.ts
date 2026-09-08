/**
 * Portfolio agent — global portfolio.
 *
 * Invests the basket's settlement currency across the user's weighted asset
 * basket (tokens and tokenized stocks) and keeps it rebalanced toward global
 * target weights. Each chain settles in its own currency — USDC on most chains
 * (including Base, where Coinbase tokenized stocks trade), USDG on Robinhood,
 * USDT on BNB. Runs in cross-chain mode: the runner invokes tick() once and
 * this executable drives each chain via ctx.chain(id).
 *
 * Reads the machine-readable strategy config from .sail/portfolio.json, written at
 * onboarding by the sailor-portfolio skill. See
 * sailor-portfolio/references/portfolio-category.md for the schema.
 *
 * Cross-chain: when an asset must be bought on a chain that holds no settlement
 * currency, the agent bridges USDC there via CCTP (approve + depositForBurn),
 * gated on-chain by the CctpBridgePermission (see the sailor-cctp-bridge skill).
 * The mint recipient is the SMA's own address, which is CREATE2-identical on
 * every chain. Chains without a CCTP domain (Robinhood, BNB) are never bridged.
 *
 * Ledger-confirmation model: a `bought`/`sold`/`minted` entry is written only
 * AFTER the runner surfaces the dispatch outcome in .sail/activity.jsonl
 * (`dispatch_executed` vs `dispatch_reverted`). A swap or bridge is first
 * recorded as a pending intent (`trade`/`bridged`) and confirmed on the next
 * tick. This keeps cost basis honest — a slippage-reverted swap can never masquerade
 * as a successful buy.
 */

import fs from "node:fs";
import path from "node:path";
import type { Address, Agent, AgentContext, Dispatch } from "@sail.money/sailor/sdk";
import { encodeFunctionData, encodePacked, keccak256 } from "viem";
import {
  buildReportContext,
  buildSnapshot,
  composeReport,
  sendTelegramReport,
  shouldRun,
  writeSnapshot,
} from "./report.js";

// ── Config (.sail/portfolio.json) ────────────────────────────────────────────────

export type ChainToken = {
  chainId: number;
  address: Address;
  decimals: number;
  /** The DEX family that executes this token's swap. Defaults to "uniswap-v3" when absent. */
  dex?: "uniswap-v3" | "aerodrome";
  /** The token-side leg fee. For a direct swap it is settlement→token; for a two-hop
   *  asset it is the hub→token leg. Basis points (3000 = 0.3%). Used only when
   *  `dex` is uniswap-v3 (or absent). */
  feeTier: number;
  /** Aerodrome Slipstream pool tick spacing (int24). Replaces `feeTier` as the path's
   *  24-bit hop discriminator when `dex` is "aerodrome". */
  tickSpacing?: number;
  /**
   * Optional two-hop route: buy/sell through this hub asset (WETH/WBNB). When present,
   * the swap is settlement → via → token (buy) or token → via → settlement (sell/valuation).
   * `via.feeTier` is the settlement→via leg. Absent means a direct single-hop swap.
   * (Uniswap V3 only — an Aerodrome two-hop is not yet supported and fails closed.)
   */
  via?: { address: Address; feeTier: number };
};

export type BasketToken = {
  symbol: string;
  weight: number; // 0..1, sums to 1.0 across the basket
  chains: ChainToken[]; // ordered deepest-liquidity-first: the routing preference
};

/** The chain's settlement currency: what value is denominated in and what deposits arrive as. */
export type SettlementCurrency = { symbol: string; address: Address; decimals: number };

/** One Across V3 route: source settlement → destination settlement, one permission per direction. */
export type AcrossRoute = {
  source: number;
  dest: number;
  spokePool: Address; // Across SpokePool on the source chain (depositV3 target)
  destinationSpokePool: Address; // SpokePool on the destination (where the fill is recorded)
  inputToken: Address; // the source chain's settlement currency
  outputToken: Address; // the destination chain's settlement currency
  /** The registered AcrossBridgePermission on the source chain (pinned on the dispatch). */
  permission?: Address;
  /** Refuse any quote whose relayer fee exceeds this (the permission enforces the same floor on-chain). */
  maxFeeBps: number;
  /** Seconds a deposit may wait for a fill before Across refunds it (≤ the SpokePool's 6h buffer). */
  fillDeadlineSec: number;
};

export type PortfolioConfig = {
  chains: number[];
  /** chainId -> the settlement currency (USDC on most chains, USDG on Robinhood, USDT on BNB). */
  settlement: Record<string, SettlementCurrency>;
  router: Record<string, Address>; // chainId -> Uniswap V3 SwapRouter02
  quoter: Record<string, Address>; // chainId -> Uniswap V3 QuoterV2
  /** Optional. Aerodrome Slipstream router + quoter per chain (Base). Present only when
   *  a basket token resolves to an Aerodrome pool. */
  aerodrome?: { router: Record<string, Address>; quoter: Record<string, Address> };
  bridge: {
    messenger: Record<string, Address>; // source chain -> CCTP TokenMessenger
    transmitter: Record<string, Address>; // chain -> CCTP MessageTransmitter (completes the mint half)
    /** chain -> the registered CctpBridgePermission. The runtime passes it as the dispatch's
     *  explicit `permission`, so the runner uses it directly instead of auto-resolving (which
     *  is unreliable for cross-chain mint completions). */
    permission?: Record<string, Address>;
    domains: Record<string, number>; // chain -> CCTP domain id (present ONLY on USDC chains)
    maxPerTxUsd: number;
    /**
     * Optional. Across V3 routes for chains CCTP does not reach (Robinhood Chain settles in USDG).
     * A route moves the source chain's settlement currency into the destination chain's one in a
     * single `depositV3`, filled by a relayer in seconds; the registered `AcrossBridgePermission`
     * pins depositor/recipient to the SMA, both tokens, the destination and an output floor.
     */
    across?: { routes: AcrossRoute[] };
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

export function loadConfig(): PortfolioConfig {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), ".sail", "portfolio.json"), "utf-8"),
  ) as PortfolioConfig;
}

function specFor(token: BasketToken, chainId: number): ChainToken | undefined {
  return token.chains.find((c) => c.chainId === chainId);
}

// ── ABI fragments (only what the loop calls) ─────────────────────────────────

const QUOTER_ABI = [
  {
    name: "quoteExactInput",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
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
    name: "exactInput",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/**
 * Uniswap V3 SwapRouter02 `exactInputSingle`. Base (and any chain whose Uniswap V3
 * deployment shipped only SwapRouter02, not the classic SwapRouter) has NO multi-hop
 * `exactInput` — single-hop swaps there go through this selector. The params struct is
 * 7 fields with NO `deadline` (SwapRouter02 removed it, unlike the classic router).
 */
const EXACT_INPUT_SINGLE_ABI = [
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

/**
 * Aerodrome Slipstream QuoterV2. `exactInput`/`quoteExactInput` share the same selector
 * and path layout as Uniswap V3, but the path's 24-bit hop field is `tickSpacing`, and
 * `quoteExactInput(bytes,uint256)` returns ARRAYS (sqrtPriceX96AfterList /
 * initializedTicksCrossedList), unlike Uniswap V3's scalars — so it needs its own ABI.
 */
const AERODROME_QUOTER_ABI = [
  {
    name: "quoteExactInput",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
      { name: "gasEstimate", type: "uint256" },
    ],
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

/** CCTP v1 MessageTransmitter: `usedNonces(keccak256(sourceDomain ‖ nonce))` is 1 once a message was received. */
const USED_NONCES_ABI = [
  {
    name: "usedNonces",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "sourceAndNonce", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Parse the CCTP v1 message header: version(4) sourceDomain(4) destDomain(4) nonce(8) … */
function parseCctpHeader(message: string): { sourceDomain: number; nonce: bigint } | null {
  const hex = message.startsWith("0x") ? message.slice(2) : message;
  if (hex.length < 40) return null;
  return {
    sourceDomain: Number.parseInt(hex.slice(8, 16), 16),
    nonce: BigInt(`0x${hex.slice(24, 40)}`),
  };
}

/** Has the destination transmitter already consumed this burn's nonce (i.e. the mint landed)? */
async function mintLanded(
  ctx: AgentContext,
  destChain: number,
  transmitter: Address,
  message: string,
): Promise<boolean | null> {
  const header = parseCctpHeader(message);
  if (!header) return null; // unparseable message: unknown, let the caller fall through
  const key = keccak256(encodePacked(["uint32", "uint64"], [header.sourceDomain, header.nonce]));
  try {
    const used = (await ctx.chain(destChain).publicClient.readContract({
      address: transmitter,
      abi: USED_NONCES_ABI,
      functionName: "usedNonces",
      args: [key],
    })) as bigint;
    return used > 0n;
  } catch {
    return null;
  }
}

const RECEIVE_MESSAGE_ABI = [
  {
    name: "receiveMessage",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

/** Circle's free, keyless attestation service. `getMessages` returns the signed message + attestation. */
const IRIS_BASE = "https://iris-api.circle.com";

/** Across's public API: fee quotes (`suggested-fees`) and deposit lifecycle (`deposit/status`). */
const ACROSS_API = "https://app.across.to/api";

/** Across V3 `depositV3` on the SpokePool (selector 0x7b939232). */
const DEPOSIT_V3_ABI = [
  {
    name: "depositV3",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "depositor", type: "address" },
      { name: "recipient", type: "address" },
      { name: "inputToken", type: "address" },
      { name: "outputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      { name: "outputAmount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "exclusiveRelayer", type: "address" },
      { name: "quoteTimestamp", type: "uint32" },
      { name: "fillDeadline", type: "uint32" },
      { name: "exclusivityDeadline", type: "uint32" },
      { name: "message", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/**
 * `FundsDeposited(bytes32,bytes32,uint256,uint256,uint256 indexed destinationChainId,
 * uint256 indexed depositId, uint32,uint32,uint32, bytes32 indexed depositor, bytes32, bytes32, bytes)`
 * — the event every current SpokePool emits on deposit; `depositId` is topic[2].
 */
const FUNDS_DEPOSITED_TOPIC = "0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3";

/**
 * Across route lookups. A route is live only once its `AcrossBridgePermission` is registered and
 * named in `permission`: until then the kernel would deny every deposit, so the runtime treats the
 * destination as not bridgeable rather than retrying denials every tick.
 */
function acrossRouteFor(cfg: PortfolioConfig, source: number, dest: number): AcrossRoute | null {
  return (
    cfg.bridge.across?.routes.find(
      (r) => r.source === source && r.dest === dest && !!r.permission,
    ) ?? null
  );
}
function cctpRouteExists(cfg: PortfolioConfig, source: number, dest: number): boolean {
  return (
    cfg.bridge.messenger[String(source)] !== undefined &&
    cfg.bridge.domains[String(source)] !== undefined &&
    cfg.bridge.domains[String(dest)] !== undefined
  );
}
/** Which mechanism moves settlement currency from `source` to `dest`, or null if none can. */
function bridgeVia(cfg: PortfolioConfig, source: number, dest: number): "cctp" | "across" | null {
  if (cctpRouteExists(cfg, source, dest)) return "cctp";
  if (acrossRouteFor(cfg, source, dest)) return "across";
  return null;
}
/** True when at least one configured mechanism can deliver settlement currency to `dest`. */
function bridgeableDest(cfg: PortfolioConfig, dest: number): boolean {
  return cfg.chains.some((c) => c !== dest && bridgeVia(cfg, c, dest) !== null);
}

/**
 * The agent grants router/messenger allowances via `approve` (gated on-chain by the
 * `BoundedErc20Approve` permission, which is uncapped — MAX_APPROVAL == 0). Approving
 * MAX_UINT256 once instead of the exact per-trade amount avoids a re-approve loop: the
 * shortfall is recomputed each tick and drifts slightly with price, so an exact-amount
 * allowance is perpetually just-short and the swap never fires. The real safety bound is
 * the swap/bridge permission's per-tx cap, not the allowance.
 */
const MAX_UINT256 = 2n ** 256n - 1n;

// ── Memory ledger (.sail/memory/ledger.jsonl) ────────────────────────────────
// Append-only, chain-reconciled record. The cadence and in-flight-bridge guards
// read here, not ctx.data, because ctx.data resets on every fresh process. Full
// reconciliation follows the canonical skeleton in
// sailor-agent-build/references/canonical-skeleton.md.

/** Ledger file path, resolved at call time so tests can chdir into a fresh project. */
function ledgerPath(): string {
  return path.join(process.cwd(), ".sail", "memory", "ledger.jsonl");
}

/** Activity log path — the runner writes `dispatch_executed` (with txHash) here on every successful dispatch. */
function activityPath(): string {
  return path.join(process.cwd(), ".sail", "activity.jsonl");
}

/** Parse the runner's activity log into objects, oldest first, silently skipping malformed lines. */
function readActivity(): Record<string, unknown>[] {
  return readLines(activityPath())
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
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

/** A bridge that has left the source chain and not yet arrived (or been refunded) on the destination. */
type UnsettledBridge = {
  kind: "bridge" | "bridged";
  via: "cctp" | "across";
  source: number;
  dest: number;
  amount: bigint;
  ts: number;
  txHash?: string;
  target: string;
  id?: string;
};

/**
 * Every bridge intent or confirmed burn/deposit that has not settled. Settled means a `minted`
 * (CCTP), `filled` (Across) or `bridgeRefunded` entry references its txHash; legacy entries
 * without a txHash settle by the latest `minted` timestamp for their destination.
 */
function unsettledBridges(): UnsettledBridge[] {
  const entries: Record<string, unknown>[] = [];
  for (const line of readLines(ledgerPath())) {
    try {
      entries.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // skip malformed line
    }
  }
  const settledTx = new Set<string>();
  const resolvedIntent = new Set<string>();
  const mintedTsByDest = new Map<number, number>();
  for (const e of entries) {
    const tx = String(e.txHash ?? "").toLowerCase();
    if (e.kind === "minted" || e.kind === "filled" || e.kind === "bridgeRefunded") {
      if (tx) settledTx.add(tx);
      if (e.kind === "minted" && e.dest !== undefined) {
        const d = Number(e.dest);
        mintedTsByDest.set(d, Math.max(mintedTsByDest.get(d) ?? 0, Number(e.ts ?? 0)));
      }
    }
    if ((e.kind === "bridged" || e.kind === "bridgeFailed") && e.id)
      resolvedIntent.add(String(e.id));
  }
  const out: UnsettledBridge[] = [];
  for (const e of entries) {
    if (e.kind !== "bridge" && e.kind !== "bridged") continue;
    if (e.kind === "bridge" && resolvedIntent.has(String(e.id ?? ""))) continue; // confirmed or failed
    const tx = e.txHash ? String(e.txHash).toLowerCase() : undefined;
    if (tx && settledTx.has(tx)) continue;
    const dest = Number(e.dest ?? 0);
    if (!tx && e.kind === "bridged" && Number(e.ts ?? 0) <= (mintedTsByDest.get(dest) ?? 0))
      continue; // legacy
    out.push({
      kind: e.kind,
      via: e.via === "across" ? "across" : "cctp",
      source: Number(e.source ?? 0),
      dest,
      amount: BigInt(String(e.amount ?? "0")),
      ts: Number(e.ts ?? 0),
      txHash: tx,
      target: String(e.target ?? e.messenger ?? "").toLowerCase(),
      id: e.id ? String(e.id) : undefined,
    });
  }
  return out;
}

/** True while any bridge to `destChain` is unsettled — never double-fund a shortfall in flight. */
function bridgeInFlight(destChain: number): boolean {
  return unsettledBridges().some((b) => b.dest === destChain);
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
 * Cumulative USDC spent on confirmed buys and received from confirmed sells, read from the
 * ledger. The cost basis of current holdings is `invested - sold`; unrealized P&L is
 * `investedValue - costBasis` (which equals total return while there are no withdrawals).
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

// ── Swap confirmation (the ledger writes `bought`/`sold` only after on-chain confirmation) ──

/** A pending trade intent, written when the swap dispatch is queued. */
type PendingTrade = {
  id: string;
  side: "buy" | "sell" | "bridge";
  symbol: string;
  amount: bigint;
  chainId: number;
  target: string; // the swap router (or CCTP messenger), lowercased — matches the activity record's `target`
  ts: number; // the intent's block timestamp — activity older than this can never confirm it
  /** Bridge intents only: where the USDC is going, and for whom. */
  source?: number;
  dest?: number;
  symbols?: string[];
  messenger?: string;
  via?: "cctp" | "across";
  outputAmount?: string;
};

/** Unique, deterministic id for a pending-trade intent. */
function nextOpId(): string {
  return `op-${readLines(ledgerPath()).length + 1}`;
}

/** Consecutive trailing `tradeFailed` entries for a symbol since its last confirmed trade. */
function recentFailures(symbol: string): number {
  const lines = readLines(ledgerPath());
  let n = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let e: { kind?: string; symbol?: string };
    try {
      e = JSON.parse(lines[i]) as { kind?: string; symbol?: string };
    } catch {
      continue;
    }
    if (e.kind === "tradeFailed" && e.symbol === symbol) {
      n++;
      continue;
    }
    if ((e.kind === "bought" || e.kind === "sold") && e.symbol === symbol) break;
  }
  return n;
}

/** Widen the slippage floor by a few bps per consecutive revert, capped at +3pp. */
function effectiveSlippageBps(cfg: PortfolioConfig, symbol: string): number {
  return Math.min(cfg.maxSlippageBps + recentFailures(symbol) * 25, cfg.maxSlippageBps + 300);
}

/** The activity outcome kinds that terminate a dispatch (everything else is a pre-execution marker). */
const TERMINAL_OUTCOMES = new Set([
  "dispatch_executed",
  "dispatch_reverted",
  "dispatch_denied",
  "error",
]);

/**
 * Reconcile pending `trade` intents against the runner's activity log, FIFO per (chain, target).
 *
 * A pending buy/sell becomes a confirmed `bought`/`sold` only when a `dispatch_executed`
 * record matches; a reverted/denied/errored dispatch becomes a `tradeFailed` marker (no
 * cost-basis entry), so the next tick re-quotes and retries with adaptive slippage. Matching
 * is monotonic because the runner writes activity records in the same order it executes the
 * dispatches the tick returned, which is the order the intents were appended.
 */
function reconcileTrades(nowSec: number): void {
  const resolved = new Set<string>();
  const claimedTx = new Set<string>();
  const pending: PendingTrade[] = [];

  for (const line of readLines(ledgerPath())) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (e.kind === "trade") {
      pending.push({
        id: String(e.id ?? ""),
        side: e.side === "sell" ? "sell" : "buy",
        symbol: String(e.symbol ?? ""),
        amount: BigInt(String(e.amount ?? "0")),
        chainId: Number(e.chainId ?? 0),
        target: String(e.target ?? "").toLowerCase(),
        ts: Number(e.ts ?? 0),
      });
    } else if (e.kind === "bridge") {
      pending.push({
        id: String(e.id ?? ""),
        side: "bridge",
        symbol: (Array.isArray(e.symbols) ? (e.symbols as string[]) : []).join(","),
        amount: BigInt(String(e.amount ?? "0")),
        chainId: Number(e.source ?? 0),
        target: String(e.target ?? e.messenger ?? "").toLowerCase(),
        ts: Number(e.ts ?? 0),
        source: Number(e.source ?? 0),
        dest: Number(e.dest ?? 0),
        symbols: Array.isArray(e.symbols) ? (e.symbols as string[]) : [],
        messenger: String(e.messenger ?? ""),
        via: e.via === "across" ? "across" : "cctp",
        outputAmount: e.outputAmount ? String(e.outputAmount) : undefined,
      });
    } else if (
      e.kind === "bought" ||
      e.kind === "sold" ||
      e.kind === "tradeFailed" ||
      e.kind === "bridged" ||
      e.kind === "bridgeFailed"
    ) {
      resolved.add(String(e.id ?? ""));
      const tx = String(e.txHash ?? "").toLowerCase();
      if (tx) claimedTx.add(tx);
    }
  }

  const unresolved = pending.filter((p) => p.id !== "" && !resolved.has(p.id));
  if (unresolved.length === 0) return;

  const activity = readActivity();
  let cursor = 0;
  for (const p of unresolved) {
    let hit: Record<string, unknown> | null = null;
    while (cursor < activity.length) {
      const a = activity[cursor];
      cursor++;
      if (!TERMINAL_OUTCOMES.has(String(a.type ?? ""))) continue;
      if (Number(a.chainId) !== p.chainId) continue;
      if (String(a.target ?? "").toLowerCase() !== p.target) continue;
      // An outcome recorded before the intent existed belongs to an earlier tick (a project
      // with history has many old router dispatches) — it can never confirm this intent.
      const aTs = Date.parse(String(a.ts ?? ""));
      if (Number.isFinite(aTs) && aTs < (p.ts - 300) * 1000) continue;
      const tx = String(a.txHash ?? "").toLowerCase();
      if (tx && claimedTx.has(tx)) continue;
      hit = a;
      break;
    }
    if (!hit) continue;
    const txHash = String(hit.txHash ?? "");
    claimedTx.add(txHash.toLowerCase());
    if (p.side === "bridge") {
      // A burn is only "bridged" once the runner confirms it executed: the approve that may
      // precede it, or a reverted burn, never becomes phantom in-flight money.
      appendLedger(
        hit.type === "dispatch_executed"
          ? {
              ts: nowSec,
              kind: "bridged",
              id: p.id,
              via: p.via,
              source: p.source,
              dest: p.dest,
              amount: p.amount.toString(),
              symbols: p.symbols,
              messenger: p.messenger,
              target: p.target,
              outputAmount: p.outputAmount,
              txHash,
            }
          : {
              ts: nowSec,
              kind: "bridgeFailed",
              id: p.id,
              source: p.source,
              dest: p.dest,
              amount: p.amount.toString(),
              symbols: p.symbols,
              txHash,
            },
      );
      continue;
    }
    if (hit.type === "dispatch_executed") {
      appendLedger({
        ts: nowSec,
        kind: p.side === "buy" ? "bought" : "sold",
        id: p.id,
        symbol: p.symbol,
        amount: p.amount.toString(),
        txHash,
      });
    } else {
      appendLedger({
        ts: nowSec,
        kind: "tradeFailed",
        id: p.id,
        side: p.side,
        symbol: p.symbol,
        amount: p.amount.toString(),
        txHash,
      });
    }
  }
}

/**
 * Sum of `bridged` amounts whose mint has not landed yet — USDC that has left the source
 * chain but is not yet visible on the destination. This is the user's money in flight and
 * must count toward total value, or buys sized during the flight window undershoot target.
 */
function pendingBridgeUsd(): bigint {
  // Only confirmed departures count: an unconfirmed intent's money is still on the source chain.
  return unsettledBridges()
    .filter((b) => b.kind === "bridged")
    .reduce((a, b) => a + b.amount, 0n);
}

// ── Pricing and dispatch ─────────────────────────────────────────────────────

const USDC_DECIMALS = 6;
const USDC_ONE = 10n ** BigInt(USDC_DECIMALS); // 1 USDC in base units (the value-accounting base)
const DUST_USD = 1n * USDC_ONE; // skip investments below $1 to avoid gas-wasteful dust

/** The settlement currency for a chain (throws on a misconfigured chain — fail closed). */
function settlementOf(cfg: PortfolioConfig, chainId: number): SettlementCurrency {
  const s = cfg.settlement[String(chainId)];
  if (!s) throw new Error(`no settlement currency configured for chain ${chainId}`);
  return s;
}

/**
 * Normalize a raw amount in the chain's settlement currency to the value-accounting base
 * (USDC 6-decimal units). USDG and USDT are 18-decimal; USDC is 6-decimal. All value math —
 * weights, shortfalls, the dust threshold, the buy cap — is done in this 6-decimal base.
 */
function toBase(raw: bigint, settlement: SettlementCurrency): bigint {
  return settlement.decimals === 6
    ? raw
    : (raw * 10n ** BigInt(6)) / 10n ** BigInt(settlement.decimals);
}

/** Convert a value-accounting (6-decimal) amount back into the chain's settlement native units. */
function fromBase(base: bigint, settlement: SettlementCurrency): bigint {
  return settlement.decimals === 6
    ? base
    : (base * 10n ** BigInt(settlement.decimals)) / 10n ** BigInt(6);
}

/** Encode a uint24 fee tier as 3 bytes (6 hex chars). */
function feeToHex(fee: number): string {
  return fee.toString(16).padStart(6, "0");
}

/** A Uniswap V3 path: tokenIn (20B) || fee (3B) || tokenOut (20B), all lowercase hex. */
function encodeV3PathSingle(tokenIn: Address, fee: number, tokenOut: Address): `0x${string}` {
  return `0x${tokenIn.slice(2).toLowerCase()}${feeToHex(fee)}${tokenOut.slice(2).toLowerCase()}` as `0x${string}`;
}

/** A two-hop Uniswap V3 path: tokenIn || fee1 || via || fee2 || tokenOut. */
function encodeV3PathMulti(
  tokenIn: Address,
  feeIn: number,
  via: Address,
  feeOut: number,
  tokenOut: Address,
): `0x${string}` {
  return `0x${tokenIn.slice(2).toLowerCase()}${feeToHex(feeIn)}${via.slice(2).toLowerCase()}${feeToHex(feeOut)}${tokenOut.slice(2).toLowerCase()}` as `0x${string}`;
}

/** The 24-bit hop discriminator for a token's leg: fee (Uniswap V3) or tickSpacing (Aerodrome). */
function hopOf(spec: ChainToken, tagged = false): number {
  if (spec.dex === "aerodrome") {
    const ts = spec.tickSpacing ?? 0;
    // Aerodrome Slipstream's MixedQuoterV3 tags the tickSpacing with the CL factory:
    // 0x80000 | tickSpacing = the newest ("Gauges V3") factory. The SwapRouter is
    // single-factory and uses the RAW tickSpacing, so only the quote path is tagged.
    return tagged ? AERODROME_FACTORY_TAG | ts : ts;
  }
  return spec.feeTier;
}

/** The Aerodrome factory tag OR-ed into a tickSpacing for the quote path (0x80000). */
const AERODROME_FACTORY_TAG = 0x80000;

/** True when a token routes through Aerodrome Slipstream (tickSpacing, its own router/quoter). */
function isAero(spec: ChainToken): boolean {
  return spec.dex === "aerodrome";
}

/**
 * Build the swap path for a settlement↔token swap. Direction is inferred from
 * tokenIn/tokenOut. The path's 24-bit hop field is a fee for Uniswap V3 and a
 * tickSpacing for Aerodrome Slipstream (identical encoding, different semantics).
 * A two-hop spec routes through `spec.via`; a direct spec uses a single leg.
 * Returns null when a two-hop spec lacks a `via`, or when an Aerodrome token asks
 * for a two-hop (unsupported) — fail closed, the caller must not guess a hop.
 *
 * `tagged` (true for the quote path) OR-s the Aerodrome factory tag into the
 * tickSpacing so the MixedQuoterV3 resolves the right CL factory; the swap path
 * leaves it raw.
 */
function v3Path(
  spec: ChainToken,
  settlement: Address,
  tokenIn: Address,
  tokenOut: Address,
  tagged = false,
): `0x${string}` | null {
  const buy = tokenIn.toLowerCase() === settlement.toLowerCase();
  if (isAero(spec) && spec.via) return null; // Aerodrome two-hop not supported yet
  if (!spec.via) return encodeV3PathSingle(tokenIn, hopOf(spec, tagged), tokenOut);
  if (buy) {
    // settlement → via → token
    return encodeV3PathMulti(tokenIn, spec.via.feeTier, spec.via.address, spec.feeTier, tokenOut);
  }
  // token → via → settlement (reverse of the buy path)
  return encodeV3PathMulti(tokenIn, spec.feeTier, spec.via.address, spec.via.feeTier, tokenOut);
}

/** The quoter address for a token's DEX, or null when none is configured. */
function quoterFor(cfg: PortfolioConfig, chainId: number, spec: ChainToken): Address | null {
  if (isAero(spec)) return cfg.aerodrome?.quoter?.[String(chainId)] ?? null;
  return cfg.quoter[String(chainId)] ?? null;
}

/** The swap router address for a token's DEX, or null when none is configured. */
function routerFor(cfg: PortfolioConfig, chainId: number, spec: ChainToken): Address | null {
  if (isAero(spec)) return cfg.aerodrome?.router?.[String(chainId)] ?? null;
  return cfg.router[String(chainId)] ?? null;
}

/** Quote a swap on a chain; returns amountOut, or null on revert or zero (fail closed). */
async function quoteSwap(
  ctx: AgentContext,
  chainId: number,
  cfg: PortfolioConfig,
  spec: ChainToken,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<bigint | null> {
  const path = v3Path(spec, settlementOf(cfg, chainId).address, tokenIn, tokenOut, true); // tag aerodrome
  if (path === null) return null;
  const quoter = quoterFor(cfg, chainId, spec);
  if (!quoter) return null;
  try {
    const q = await ctx.chain(chainId).publicClient.simulateContract({
      address: quoter,
      abi: isAero(spec) ? AERODROME_QUOTER_ABI : QUOTER_ABI,
      functionName: "quoteExactInput",
      args: [path, amountIn],
    });
    const amountOut = (q.result as readonly unknown[])[0] as bigint;
    return amountOut === 0n ? null : amountOut;
  } catch {
    return null;
  }
}

/**
 * The result of a swap: either an approve (allowance short — the swap happens on a later
 * tick once the allowance clears) or the actual swap dispatch. Null when the quote fails.
 */
type SwapResult = { kind: "approve"; dispatch: Dispatch } | { kind: "swap"; dispatch: Dispatch };

/**
 * Build a swap dispatch on a chain. Returns an approve when the router's allowance on the
 * input token is short (the agent grants it via the BoundedErc20Approve permission and swaps
 * next tick); otherwise the swap with a slippage floor from `slippageBps`.
 */
async function swap(
  ctx: AgentContext,
  chainId: number,
  cfg: PortfolioConfig,
  spec: ChainToken,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  slippageBps: number,
): Promise<SwapResult | null> {
  const path = v3Path(spec, settlementOf(cfg, chainId).address, tokenIn, tokenOut);
  if (path === null) return null;
  const expectedOut = await quoteSwap(ctx, chainId, cfg, spec, tokenIn, tokenOut, amountIn);
  if (expectedOut === null) return null;
  const router = routerFor(cfg, chainId, spec);
  if (!router) return null;
  // Agent-managed approve: when the router's allowance on the input token is short, the
  // agent grants it first (gated on-chain by the BoundedErc20Approve permission) and the
  // swap happens on a later tick. No owner signature is ever needed for a standing allow.
  const allowance = await ctx.chain(chainId).read.allowance(tokenIn, ctx.safe, router);
  if (allowance < amountIn) {
    const data = encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [router, MAX_UINT256],
    });
    return {
      kind: "approve",
      dispatch: ctx.chain(chainId).dispatch({ calls: [{ target: tokenIn, value: 0n, data }] }),
    };
  }
  const minOut = (expectedOut * BigInt(10_000 - slippageBps)) / 10_000n;
  // Single-hop Uniswap V3 swaps go through SwapRouter02's `exactInputSingle` (Base has no
  // classic SwapRouter, and SwapRouter02 dropped the multi-hop `exactInput`). Two-hop legs
  // (classic SwapRouter) and Aerodrome keep the multi-hop `exactInput`.
  const singleHop = !isAero(spec) && !spec.via;
  let data: `0x${string}`;
  if (singleHop) {
    data = encodeFunctionData({
      abi: EXACT_INPUT_SINGLE_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          fee: spec.feeTier,
          recipient: ctx.safe,
          amountIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
  } else {
    const deadline = BigInt(Math.floor(ctx.timestamp)) + 3600n;
    data = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: "exactInput",
      args: [
        {
          path,
          recipient: ctx.safe,
          deadline,
          amountIn,
          amountOutMinimum: minOut,
        },
      ],
    });
  }
  return {
    kind: "swap",
    dispatch: ctx.chain(chainId).dispatch({ calls: [{ target: router, value: 0n, data }] }),
  };
}

/** Settlement-currency-denominated value of the SMA's holding of a token on one chain (base units). */
export async function usdcValueOf(
  ctx: AgentContext,
  cfg: PortfolioConfig,
  spec: ChainToken,
): Promise<bigint> {
  const balance = await ctx.chain(spec.chainId).read.balance(spec.address);
  if (balance === 0n) return 0n;
  const settlement = settlementOf(cfg, spec.chainId);
  const oneUnit = 10n ** BigInt(spec.decimals);
  const perToken = await quoteSwap(
    ctx,
    spec.chainId,
    cfg,
    spec,
    spec.address,
    settlement.address,
    oneUnit,
  );
  if (perToken === null) return 0n; // unpriceable holding: fail closed, value 0
  // `perToken` is in the chain's settlement native units; normalize to the 6-decimal base.
  return (balance * toBase(perToken, settlement)) / oneUnit;
}

/**
 * The chain (in the token's liquidity order) that holds the most settlement currency in the
 * shared spend budget. Returns null when none holds anything. This is a pure read of the
 * budget map — the balance is read once up front (see the buy loop), never per token.
 */
function pickBuyChain(
  cfg: PortfolioConfig,
  token: BasketToken,
  availableByChain: Record<number, bigint>,
): number | null {
  let best: number | null = null;
  let bestBal = 0n;
  for (const spec of token.chains) {
    const bal = availableByChain[spec.chainId] ?? 0n;
    // Dust is not a usable balance: returning a chain with ≤ $1 would shrink the buy to dust
    // and silently drop it, never reaching the bridge path that could actually fund the leg.
    if (bal <= DUST_USD) continue;
    if (bal > bestBal) {
      bestBal = bal;
      best = spec.chainId;
    }
  }
  return best;
}

/** First chain (in liquidity order) where the SMA holds a balance of the token. */
async function pickSellChain(
  ctx: AgentContext,
  cfg: PortfolioConfig,
  token: BasketToken,
): Promise<number | null> {
  for (const spec of token.chains) {
    const balance = await ctx.chain(spec.chainId).read.balance(spec.address);
    if (balance > 0n) return spec.chainId;
  }
  return null;
}

/**
 * Chain (other than `destChain`) holding the most USDC in the spend budget, to fund a bridge.
 * The caller sizes the bridge to `min(need, available)`, so a source that cannot cover the whole
 * need still moves what it has — the same partial rule as buys, never all-or-nothing.
 */
function pickSourceChain(
  cfg: PortfolioConfig,
  destChain: number,
  availableByChain: Record<number, bigint>,
): number | null {
  let best: number | null = null;
  let bestBase = 0n;
  for (const chainId of cfg.chains) {
    if (chainId === destChain) continue;
    // A source must be able to reach the destination: CCTP between USDC chains, or an Across route.
    if (bridgeVia(cfg, chainId, destChain) === null) continue;
    const base = availableByChain[chainId] ?? 0n;
    if (base > DUST_USD && base > bestBase) {
      best = chainId;
      bestBase = base;
    }
  }
  return best;
}

/** The result of a bridge: an approve (allowance short) or the actual burn/deposit dispatch. */
type BridgeResult =
  | { kind: "approve"; dispatch: Dispatch }
  | {
      kind: "bridge";
      dispatch: Dispatch;
      via: "cctp" | "across";
      target: Address;
      outputAmount?: bigint;
    };

/** Bridge USDC from source to dest via CCTP. Approves first when allowance is short. */
async function bridgeUsdc(
  ctx: AgentContext,
  cfg: PortfolioConfig,
  sourceChain: number,
  destChain: number,
  amount: bigint, // in the value-accounting base (6-decimal)
): Promise<BridgeResult | null> {
  const ch = ctx.chain(sourceChain);
  const settlement = settlementOf(cfg, sourceChain); // USDC on every bridged chain
  const usdc = settlement.address;
  const messenger = cfg.bridge.messenger[String(sourceChain)];
  const amountNative = fromBase(amount, settlement); // base → the chain's native units
  const allowance = await ch.read.allowance(usdc, ctx.safe, messenger);
  if (allowance < amountNative) {
    const data = encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [messenger, MAX_UINT256],
    });
    return {
      kind: "approve",
      dispatch: ch.dispatch({ calls: [{ target: usdc, value: 0n, data }] }),
    };
  }
  const domain = cfg.bridge.domains[String(destChain)];
  // Self-recipient: the SMA's own address, left-padded to bytes32. CREATE2 makes it
  // the same address on every chain, so this lands at the account's own address there.
  const mintRecipient = `0x${"0".repeat(24)}${ctx.safe.slice(2)}` as `0x${string}`;
  const data = encodeFunctionData({
    abi: DEPOSIT_FOR_BURN_ABI,
    functionName: "depositForBurn",
    args: [amountNative, domain, mintRecipient, usdc],
  });
  return {
    kind: "bridge",
    via: "cctp",
    target: messenger,
    dispatch: ch.dispatch({ calls: [{ target: messenger, value: 0n, data }] }),
  };
}

/** Across's fee quote for one deposit, or null when the route cannot take this amount right now. */
async function quoteAcross(
  route: AcrossRoute,
  amountIn: bigint,
  recipient: Address,
): Promise<{ outputAmount: bigint; quoteTimestamp: number; feeBps: number } | null> {
  const url =
    `${ACROSS_API}/suggested-fees?inputToken=${route.inputToken}&outputToken=${route.outputToken}` +
    `&originChainId=${route.source}&destinationChainId=${route.dest}&amount=${amountIn}&recipient=${recipient}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = (await res.json()) as {
    outputAmount?: string;
    timestamp?: string;
    isAmountTooLow?: boolean;
    totalRelayFee?: { pct?: string };
  };
  if (j.isAmountTooLow || !j.outputAmount || !j.timestamp) return null;
  // `pct` is an 18-decimal fraction of the input (1e18 == 100%); 1e14 of it is one basis point.
  const feeBps = j.totalRelayFee?.pct ? Number(BigInt(j.totalRelayFee.pct) / 10n ** 14n) : 0;
  return { outputAmount: BigInt(j.outputAmount), quoteTimestamp: Number(j.timestamp), feeBps };
}

/** Scale an amount between two token decimal conventions (floor). */
function scaleDecimals(amount: bigint, from: number, to: number): bigint {
  if (to > from) return amount * 10n ** BigInt(to - from);
  if (from > to) return amount / 10n ** BigInt(from - to);
  return amount;
}

/**
 * Bridge settlement currency over an Across route: one `depositV3`, filled by a relayer in seconds.
 * Approves the SpokePool first when the allowance is short. The quote is taken from Across and
 * refused above the route's fee ceiling; the registered permission enforces the same floor on-chain,
 * pins depositor and recipient to the SMA, and keeps the message empty.
 */
async function bridgeAcross(
  ctx: AgentContext,
  cfg: PortfolioConfig,
  route: AcrossRoute,
  amount: bigint, // value-accounting base (6-decimal)
): Promise<BridgeResult | null> {
  const ch = ctx.chain(route.source);
  const src = settlementOf(cfg, route.source);
  const dst = settlementOf(cfg, route.dest);
  const amountIn = fromBase(amount, src);
  const allowance = await ch.read.allowance(route.inputToken, ctx.safe, route.spokePool);
  if (allowance < amountIn) {
    const data = encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [route.spokePool, MAX_UINT256],
    });
    return {
      kind: "approve",
      dispatch: ch.dispatch({ calls: [{ target: route.inputToken, value: 0n, data }] }),
    };
  }
  let quote: Awaited<ReturnType<typeof quoteAcross>>;
  try {
    quote = await quoteAcross(route, amountIn, ctx.safe);
  } catch (err) {
    ctx.log(`across quote failed ${route.source}→${route.dest}: ${(err as Error).message}`);
    return null;
  }
  if (!quote) {
    ctx.log(`across has no quote for ${route.source}→${route.dest} at this size — skipping`);
    return null;
  }
  if (quote.feeBps > route.maxFeeBps) {
    ctx.log(`across fee ${quote.feeBps} bps exceeds the ${route.maxFeeBps} bps ceiling — skipping`);
    return null;
  }
  // The same floor the permission enforces: never sign a deposit the kernel would reject.
  const floor =
    (scaleDecimals(amountIn, src.decimals, dst.decimals) * BigInt(10_000 - route.maxFeeBps)) /
    10_000n;
  if (quote.outputAmount < floor) {
    ctx.log(`across output ${quote.outputAmount} below the floor ${floor} — skipping`);
    return null;
  }
  const fillDeadline = quote.quoteTimestamp + route.fillDeadlineSec;
  const data = encodeFunctionData({
    abi: DEPOSIT_V3_ABI,
    functionName: "depositV3",
    args: [
      ctx.safe, // depositor: refunds land in the SMA
      ctx.safe, // recipient: the SMA's own address on the destination
      route.inputToken,
      route.outputToken,
      amountIn,
      quote.outputAmount,
      BigInt(route.dest),
      "0x0000000000000000000000000000000000000000", // open to every relayer
      quote.quoteTimestamp,
      fillDeadline,
      0, // no exclusivity window
      "0x", // no cross-chain message, ever
    ],
  });
  return {
    kind: "bridge",
    via: "across",
    target: route.spokePool,
    outputAmount: quote.outputAmount,
    dispatch: ch.dispatch({
      calls: [{ target: route.spokePool, value: 0n, data }],
      permission: route.permission,
    }),
  };
}

/**
 * Settle Across deposits: a confirmed `depositV3` becomes `filled` only once Across reports the fill
 * AND the fill transaction is verified on the destination chain (successful, sent to the destination
 * SpokePool). An expired deposit becomes `bridgeRefunded` (Across returns it to the depositor on
 * the source chain), so the cash is counted there again. No dispatch is ever needed.
 */
async function completePendingAcrossFills(ctx: AgentContext, cfg: PortfolioConfig): Promise<void> {
  for (const b of unsettledBridges()) {
    if (b.kind !== "bridged" || b.via !== "across" || !b.txHash) continue;
    const route = acrossRouteFor(cfg, b.source, b.dest);
    if (!route) continue;
    let depositId: bigint | null = null;
    try {
      const receipt = (await ctx.chain(b.source).publicClient.getTransactionReceipt({
        hash: b.txHash as `0x${string}`,
      })) as { logs?: { address?: string; topics?: readonly string[] }[] };
      for (const log of receipt.logs ?? []) {
        if (String(log.address ?? "").toLowerCase() !== route.spokePool.toLowerCase()) continue;
        if (String(log.topics?.[0] ?? "").toLowerCase() !== FUNDS_DEPOSITED_TOPIC) continue;
        depositId = BigInt(String(log.topics?.[2] ?? "0x0"));
        break;
      }
    } catch (err) {
      ctx.log(
        `across deposit receipt ${b.txHash.slice(0, 10)}… unavailable: ${(err as Error).message}`,
      );
      continue;
    }
    if (depositId === null) {
      ctx.log(`across deposit ${b.txHash.slice(0, 10)}… has no FundsDeposited log — will retry`);
      continue;
    }
    let status: { status?: string; fillTx?: string; fillTxHash?: string };
    try {
      const res = await fetch(
        `${ACROSS_API}/deposit/status?originChainId=${b.source}&depositId=${depositId}`,
      );
      if (!res.ok) {
        ctx.log(`across status ${res.status} for deposit ${depositId} — will retry`);
        continue;
      }
      status = (await res.json()) as typeof status;
    } catch (err) {
      ctx.log(`across status fetch failed for deposit ${depositId}: ${(err as Error).message}`);
      continue;
    }
    const state = String(status.status ?? "").toLowerCase();
    if (state === "filled") {
      const fillTx = String(status.fillTx ?? status.fillTxHash ?? "");
      if (!/^0x[0-9a-fA-F]{64}$/.test(fillTx)) {
        ctx.log(`across reports deposit ${depositId} filled without a fill tx — will retry`);
        continue;
      }
      try {
        const fr = (await ctx.chain(b.dest).publicClient.getTransactionReceipt({
          hash: fillTx as `0x${string}`,
        })) as { status?: string; to?: string | null };
        const ok =
          String(fr.status ?? "") === "success" &&
          String(fr.to ?? "").toLowerCase() === route.destinationSpokePool.toLowerCase();
        if (!ok) {
          ctx.log(
            `across fill ${fillTx.slice(0, 10)}… did not verify on chain ${b.dest} — will retry`,
          );
          continue;
        }
      } catch (err) {
        ctx.log(
          `across fill receipt ${fillTx.slice(0, 10)}… unavailable: ${(err as Error).message}`,
        );
        continue;
      }
      appendLedger({
        ts: ctx.timestamp,
        kind: "filled",
        via: "across",
        source: b.source,
        dest: b.dest,
        amount: b.amount.toString(),
        depositId: depositId.toString(),
        txHash: b.txHash,
        fillTxHash: fillTx,
      });
      continue;
    }
    if (state === "expired" || state === "refunded") {
      appendLedger({
        ts: ctx.timestamp,
        kind: "bridgeRefunded",
        via: "across",
        source: b.source,
        dest: b.dest,
        amount: b.amount.toString(),
        depositId: depositId.toString(),
        txHash: b.txHash,
      });
      ctx.log(
        `across deposit ${depositId} ${state}: ${Number(b.amount) / 1e6} returns to chain ${b.source}`,
      );
      continue;
    }
    ctx.log(
      `across deposit ${depositId} to chain ${b.dest} is ${state || "pending"} — waiting for the fill`,
    );
  }
}

/**
 * Complete any CCTP burn whose mint half has not landed yet.
 *
 * The burn half (approve + depositForBurn) only destroys USDC on the source chain; CCTP v1
 * does not auto-relay, so the destination MessageTransmitter must be called with the message
 * and Circle's attestation for the USDC to be minted on the other side. The runner records the
 * burn's tx hash in .sail/activity.jsonl as `dispatch_executed`; this reads it back, fetches the
 * signed message + attestation from Circle's Iris API (free, keyless), and emits a `receiveMessage`
 * dispatch on the destination chain. Replay and forgery are both impossible: a valid attestation
 * exists only for a burn that happened, and that burn's mintRecipient was already forced to the
 * account, so the mint always lands back at the SMA. The MessageTransmitter rejects a repeated
 * message on-chain, so re-emitting after a crash is harmless.
 *
 * `minted` is written only once the destination MessageTransmitter reports the burn's nonce as
 * used (the mint landed) — never optimistically when the receiveMessage is merely emitted, and
 * never from a destination balance (dust or an unrelated deposit is not a mint). Until it lands,
 * the emit is re-attempted each tick (idempotent on-chain).
 */
async function completePendingMints(ctx: AgentContext, cfg: PortfolioConfig): Promise<Dispatch[]> {
  const out: Dispatch[] = [];

  const ledger = readLines(ledgerPath());
  const mintedTx = new Set<string>();
  const bridged: {
    source: number;
    dest: number;
    messenger: string;
    ts: number;
    txHash?: string;
  }[] = [];
  for (const line of ledger) {
    try {
      const e = JSON.parse(line) as {
        kind?: string;
        txHash?: string;
        dest?: number;
        source?: number;
        messenger?: string;
        ts?: number;
      };
      if (e.kind === "minted" && e.txHash) mintedTx.add(String(e.txHash).toLowerCase());
      else if (e.kind === "bridged") {
        bridged.push({
          source: e.source ?? 0,
          dest: e.dest ?? 0,
          messenger: String(e.messenger ?? "").toLowerCase(),
          ts: e.ts ?? 0,
          txHash: e.txHash ? String(e.txHash).toLowerCase() : undefined,
        });
      }
    } catch {
      // skip malformed line
    }
  }
  if (bridged.length === 0) return out;

  const activity = readActivity();
  // Burn tx hashes already claimed this tick, so two pending burns never resolve to the same hash.
  const claimed = new Set<string>();

  for (const b of bridged) {
    if (!b.messenger) continue;
    const sourceDomain = cfg.bridge.domains[String(b.source)];
    if (sourceDomain === undefined) continue;
    const transmitter = cfg.bridge.transmitter[String(b.dest)];
    if (!transmitter) continue;

    // A confirmed burn carries its own txHash (written by reconcileTrades). Legacy entries
    // without one fall back to the runner's dispatch_executed for the same messenger + chain.
    if (b.txHash) {
      if (mintedTx.has(b.txHash) || claimed.has(b.txHash)) continue;
    }
    const hit = b.txHash
      ? { txHash: b.txHash }
      : activity.find((a) => {
          const target = String(a.target ?? "").toLowerCase();
          const txHash = String(a.txHash ?? "").toLowerCase();
          return (
            a.type === "dispatch_executed" &&
            Number(a.chainId) === b.source &&
            target === b.messenger &&
            txHash !== "" &&
            !mintedTx.has(txHash) &&
            !claimed.has(txHash)
          );
        });
    if (!hit) continue; // burn not yet executed (or already completed) — try next tick
    const txHash = String(hit.txHash).toLowerCase();
    claimed.add(txHash);

    // Fetch the signed message + attestation. Attestation can lag the burn by a minute, so a
    // missing message is not an error: just retry on the next tick.
    let message: string;
    let attestation: string;
    try {
      const res = await fetch(`${IRIS_BASE}/v1/messages/${sourceDomain}/${txHash}`);
      if (!res.ok) {
        ctx.log(`iris ${res.status} for ${txHash.slice(0, 10)}… — will retry`);
        continue;
      }
      const json = (await res.json()) as {
        messages?: { message?: string; attestation?: string }[];
      };
      const m = json.messages?.[0];
      // Iris answers with the literal string "PENDING" (not empty) until the attestation is
      // signed. Only a hex signature is usable — anything else means wait for the next tick.
      const isHex = (v: unknown): v is string =>
        typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v);
      const msgHex = m?.message;
      const attHex = m?.attestation;
      if (!isHex(msgHex) || !isHex(attHex)) {
        ctx.log(
          `attestation for ${txHash.slice(0, 10)}… still ${String(attHex ?? "missing")} — will retry`,
        );
        continue;
      }
      message = msgHex;
      attestation = attHex;
    } catch (err) {
      ctx.log(`iris fetch failed for ${txHash.slice(0, 10)}…: ${(err as Error).message}`);
      continue;
    }

    // The mint has landed iff the destination transmitter has consumed this burn's nonce.
    // (A destination balance is NOT evidence: dust or an unrelated deposit would be mistaken
    // for the mint and strand the bridged USDC.) When landed, record it and stop re-emitting.
    const landed = await mintLanded(ctx, b.dest, transmitter as Address, message);
    if (landed === true) {
      appendLedger({ ts: ctx.timestamp, kind: "minted", dest: b.dest, txHash });
      continue;
    }

    const data = encodeFunctionData({
      abi: RECEIVE_MESSAGE_ABI,
      functionName: "receiveMessage",
      args: [message as `0x${string}`, attestation as `0x${string}`],
    });
    // Pin the authorizing permission explicitly. The runner's auto-resolution is unreliable
    // for the cross-chain mint completion, so we name the registered CctpBridgePermission
    // on the destination chain directly.
    const mintPermission = cfg.bridge.permission?.[String(b.dest)];
    out.push(
      ctx.chain(b.dest).dispatch({
        calls: [{ target: transmitter as Address, value: 0n, data }],
        permission: mintPermission,
      }),
    );
    // NOTE: `minted` is NOT written here — it is written next tick once the destination
    // balance confirms the mint actually landed.
  }

  return out;
}

// ── The agent ────────────────────────────────────────────────────────────────

const BPS = 10_000n;

export const agent: Agent = {
  name: "portfolio-agent",
  description:
    "Invest USDC into a weighted token basket and keep it rebalanced toward global target weights across named chains.",

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    const cfg = loadConfig();
    ctx.log(`tick — block ${ctx.blockNumber}, chains ${cfg.chains.join(",")}`);

    const dispatches: Dispatch[] = [];

    // 0. Reconcile pending trades against the runner's activity log (confirms buys/sells),
    //    then complete any CCTP burn whose mint half hasn't landed. Both run BEFORE the
    //    empty-portfolio guard: a pending confirmation or a burned-but-unminted bridge must
    //    resolve even when the portfolio looks empty on both chains.
    reconcileTrades(ctx.timestamp);
    dispatches.push(...(await completePendingMints(ctx, cfg)));
    await completePendingAcrossFills(ctx, cfg);

    // 1. Value the portfolio in settlement currency (normalized to the 6-decimal base) across
    //    every named chain, and build the shared per-chain spend budget in one pass. The budget
    //    is decremented as each buy is queued, so the sum of queued buys in a tick never exceeds
    //    what the SMA actually holds (no over-dispatch).
    let usdcTotal = 0n;
    const availableByChain: Record<number, bigint> = {};
    for (const chainId of cfg.chains) {
      const settlement = settlementOf(cfg, chainId);
      const raw = await ctx.chain(chainId).read.balance(settlement.address);
      const base = toBase(raw, settlement);
      availableByChain[chainId] = base;
      usdcTotal += base;
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
    // In-flight bridge USDC is the user's money — it must count toward total value, or buys
    // sized during the flight window undershoot target by the in-flight amount.
    const pendingBridge = pendingBridgeUsd();
    const totalValue = usdcTotal + investedValue + pendingBridge;
    if (totalValue === 0n) {
      ctx.log("portfolio empty — skipping");
      appendLedger({
        ts: ctx.timestamp,
        block: Number(ctx.blockNumber),
        kind: "skipped",
        reason: "portfolio empty",
      });
      return dispatches; // may still carry a completed bridge mint or a reconciled trade
    }
    // Weights are measured against the invested portfolio in DCA mode (idle USDC is a
    // war chest, not dilution) and against the full portfolio in invest mode (idle USDC
    // is to be deployed). The mode is read once here.
    const dca = cfg.dca;
    const valueBase = dca ? investedValue : totalValue;
    for (const e of entries) {
      e.weightBps = valueBase === 0n ? 0n : (e.value * BPS) / valueBase;
    }

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
        const settlement = settlementOf(cfg, chainId);
        const balance = await ctx.chain(chainId).read.balance(spec.address);
        const amountIn = (balance * excessBps) / e.weightBps; // excess fraction of the holding
        if (amountIn === 0n) continue;
        const proceeds = await quoteSwap(
          ctx,
          chainId,
          cfg,
          spec,
          spec.address,
          settlement.address,
          amountIn,
        );
        if (proceeds === null) {
          ctx.log(
            `rebalance: could not quote ${e.token.symbol} on chain ${chainId} — skipping this sell`,
          );
          continue;
        }
        const res = await swap(
          ctx,
          chainId,
          cfg,
          spec,
          spec.address,
          settlement.address,
          amountIn,
          effectiveSlippageBps(cfg, e.token.symbol),
        );
        if (res) {
          dispatches.push(res.dispatch);
          if (res.kind === "swap") {
            const router = routerFor(cfg, chainId, spec);
            appendLedger({
              ts: ctx.timestamp,
              kind: "trade",
              id: nextOpId(),
              side: "sell",
              symbol: e.token.symbol,
              amount: toBase(proceeds, settlement).toString(),
              chainId,
              target: router?.toLowerCase() ?? "",
            });
            sold = true;
          }
        }
      }
      if (sold) appendLedger({ ts: ctx.timestamp, kind: "rebalanced" });
    }

    // 3. Buy toward target. Two modes, chosen at onboarding:
    //    - invest (no `dca`): deploy idle USDC by buying each token's shortfall — a fresh
    //      deposit is idle USDC, so the next tick invests it across the whole basket.
    //    - dca: buy a fixed amount every period split by target weight, and rebalance-buy
    //      tokens that drift below their band between periods.
    //    Every buy is capped at `min(shortfall, remaining budget)` and decremented from the
    //    shared budget, so partial idle cash still moves every laggard toward target instead of
    //    funding the first token and starving the rest.
    const dcaDue = dca ? ctx.timestamp - lastInvestTs() >= dca.periodSec : false;
    const bridgeNeed = new Map<
      string,
      { source: number; dest: number; amount: bigint; symbols: string[] }
    >();
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

      const chainId = pickBuyChain(cfg, e.token, availableByChain);
      if (chainId !== null) {
        const available = availableByChain[chainId] ?? 0n;
        if (buyUsd > available) buyUsd = available; // partial buy — move every laggard, never starve
        if (buyUsd <= DUST_USD) continue;
        const spec = specFor(e.token, chainId);
        if (!spec) continue;
        const settlement = settlementOf(cfg, chainId);
        const res = await swap(
          ctx,
          chainId,
          cfg,
          spec,
          settlement.address,
          spec.address,
          fromBase(buyUsd, settlement), // base → settlement native units for the swap
          effectiveSlippageBps(cfg, e.token.symbol),
        );
        if (res) {
          dispatches.push(res.dispatch);
          if (res.kind === "swap") {
            const router = routerFor(cfg, chainId, spec);
            appendLedger({
              ts: ctx.timestamp,
              kind: "trade",
              id: nextOpId(),
              side: "buy",
              symbol: e.token.symbol,
              amount: buyUsd.toString(),
              chainId,
              target: router?.toLowerCase() ?? "",
            });
            availableByChain[chainId] -= buyUsd; // shared budget: later legs see less
          }
        } else {
          ctx.log(
            `could not quote ${e.token.symbol} on chain ${chainId} — liquidity too thin, a missing fee tier, or a misconfigured two-hop route; skipping this leg`,
          );
        }
        continue;
      }

      // No chain holds enough settlement currency where this token is routable. USDC chains are
      // bridged by CCTP; a chain with an Across route (Robinhood, in USDG) by Across; anything
      // else (USDT on BNB) is funded direct.
      const dest = e.token.chains[0].chainId;
      if (!bridgeableDest(cfg, dest)) {
        ctx.log(
          `chain ${dest} is funded direct (no bridge) — deposit its settlement currency to the SMA`,
        );
        continue;
      }
      if (bridgeInFlight(dest)) {
        ctx.log(`bridge to chain ${dest} in flight — waiting for it to settle`);
        continue;
      }
      // Reserve the source cash NOW, in basket order, so an earlier token's cross-chain
      // shortfall has the same priority as a later token's same-chain buy. The reservations
      // for one (source → dest) pair are pooled into ONE bridge after the loop — bridging per
      // token would let the first small leg claim the in-flight guard and strand the rest.
      const source = pickSourceChain(cfg, dest, availableByChain);
      if (source === null) {
        ctx.log(`no source USDC to bridge for ${e.token.symbol} — skipping`);
        continue;
      }
      let reserve = buyUsd;
      const sourceAvailable = availableByChain[source] ?? 0n;
      if (reserve > sourceAvailable) reserve = sourceAvailable; // partial, never all-or-nothing
      if (reserve <= DUST_USD) continue;
      availableByChain[source] -= reserve;
      const key = `${source}:${dest}`;
      const need = bridgeNeed.get(key) ?? { source, dest, amount: 0n, symbols: [] as string[] };
      need.amount += reserve;
      need.symbols.push(e.token.symbol);
      bridgeNeed.set(key, need);
    }

    // 3b. One bridge per (source → destination) pair, sized to the pooled reservations and the
    //     per-tx cap. The minted USDC funds the destination's laggards in basket order next tick;
    //     anything the cap held back follows on a later run.
    for (const need of bridgeNeed.values()) {
      const { source, dest } = need;
      let amount = need.amount;
      if (amount > cap) amount = cap;
      if (amount <= DUST_USD) continue;
      const via = bridgeVia(cfg, source, dest);
      const acrossRoute = via === "across" ? acrossRouteFor(cfg, source, dest) : null;
      let res: BridgeResult | null = null;
      if (via === "cctp") res = await bridgeUsdc(ctx, cfg, source, dest, amount);
      else if (acrossRoute) res = await bridgeAcross(ctx, cfg, acrossRoute, amount);
      if (res) {
        dispatches.push(res.dispatch);
        if (res.kind === "bridge") {
          // Intent only — `bridged` is written by reconcileTrades once the burn/deposit confirms.
          appendLedger({
            ts: ctx.timestamp,
            kind: "bridge",
            id: nextOpId(),
            via: res.via,
            source,
            dest,
            amount: amount.toString(),
            symbols: need.symbols,
            messenger: res.via === "cctp" ? cfg.bridge.messenger[String(source)] : undefined,
            target: res.target.toLowerCase(),
            outputAmount: res.outputAmount?.toString(),
          });
        }
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
      pendingBridgeUsdc: pendingBridge,
      valueBase, // the exact base the trims/buys above were decided on
      asOf: ctx.timestamp,
    });
    writeSnapshot(snapshot);

    if (cfg.report && shouldRun(ctx.timestamp, lastReportTs(), cfg.report.cadenceSec)) {
      try {
        const asOf = new Date(ctx.timestamp * 1000).toISOString().slice(0, 10);
        const { baseline, actions } = buildReportContext(readLines(ledgerPath()));
        await sendTelegramReport(composeReport(snapshot, { baseline, actions, asOf }));
        // Persist the snapshot values this report was sent with — the next report decomposes
        // its week-over-week flow against this baseline.
        appendLedger({
          ts: ctx.timestamp,
          kind: "reported",
          totalValue: snapshot.totalValue.toString(),
          investedValue: snapshot.investedValue.toString(),
          costBasis: (snapshot.costBasis ?? 0n).toString(),
          idleUsdc: snapshot.idleUsdc.toString(),
        });
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
