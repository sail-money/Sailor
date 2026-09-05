/**
 * Decision-logic tests for the portfolio agent runtime.
 *
 * These test the agent's "brain" against a mocked chain context: no RPC, no
 * account, no money. Prices are mocked 1:1 (a token's USDC value equals its raw
 * balance) so weight math is deterministic; the assertions verify *what the agent
 * decides to do* (sell, buy, bridge, skip), not price accuracy.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decodeFunctionData } from "viem";
import { agent } from "./agent.js";

// ── Addresses (valid 40-hex, all distinct) ────────────────────────────────────

const ADDR = (hex: string) => `0x${hex.repeat(40)}` as `0x${string}`;
const MAX_UINT = 2n ** 256n - 1n; // mock default allowance — "already approved, swap directly"
const USDC_BASE = ADDR("a");
const USDC_ARB = ADDR("b");
const WETH_BASE = ADDR("c");
const WETH_ARB = ADDR("d");
const WBTC_BASE = ADDR("e");
const ROUTER_BASE = ADDR("f");
const ROUTER_ARB = ADDR("1");
const QUOTER_BASE = ADDR("2");
const QUOTER_ARB = ADDR("3");
const MSG_BASE = ADDR("4");
const MSG_ARB = ADDR("5");
const XMIT_BASE = ADDR("7");
const XMIT_ARB = ADDR("8");
const SAFE = ADDR("6");
const USDG_RH = ADDR("9"); // Robinhood settlement currency (18 decimals)
// The stock test runs on its own chain (4663) in isolation, so these reuse hex digits freely.
const NVDA_RH = ADDR("a"); // a tokenized stock on Robinhood
const ROUTER_RH = ADDR("b");
const QUOTER_RH = ADDR("c");
const NVDA_BASE = ADDR("9"); // a Coinbase tokenized stock (NVDAc) on Base, settled in USDC
const ZAMA_BASE = ADDR("0"); // a two-hop token (USDC → WETH → ZAMA) on Base
// Aerodrome Slipstream (uppercase hex, distinct from the lowercase single-char set).
const CBHYPE_BASE = ADDR("C"); // cbHYPE on Base — real USDC pool is on Aerodrome (tickSpacing 200)
const AERO_ROUTER = ADDR("A"); // Aerodrome Slipstream SwapRouter (Base)
const AERO_QUOTER = ADDR("B"); // Aerodrome Slipstream QuoterV2 (Base)

// ── ABI fragments for decoding calldata ───────────────────────────────────────

const EXACT_INPUT = [
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

const APPROVE = [
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

const DEPOSIT_FOR_BURN = [
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

// ── Configs ───────────────────────────────────────────────────────────────────

function twoTokenConfig() {
  return {
    chains: [8453, 42161],
    settlement: {
      8453: { symbol: "USDC", address: USDC_BASE, decimals: 6 },
      42161: { symbol: "USDC", address: USDC_ARB, decimals: 6 },
    },
    router: { 8453: ROUTER_BASE, 42161: ROUTER_ARB },
    quoter: { 8453: QUOTER_BASE, 42161: QUOTER_ARB },
    bridge: {
      messenger: { 8453: MSG_BASE, 42161: MSG_ARB },
      transmitter: { 8453: XMIT_BASE, 42161: XMIT_ARB },
      domains: { 8453: 6, 42161: 3 },
      maxPerTxUsd: 1000,
    },
    basket: [
      {
        symbol: "WETH",
        weight: 0.4,
        chains: [
          { chainId: 8453, address: WETH_BASE, decimals: 18, feeTier: 3000 },
          { chainId: 42161, address: WETH_ARB, decimals: 18, feeTier: 3000 },
        ],
      },
      {
        symbol: "WBTC",
        weight: 0.6,
        chains: [{ chainId: 8453, address: WBTC_BASE, decimals: 8, feeTier: 3000 }],
      },
    ],
    rebalanceBandBps: 500,
    maxSlippageBps: 100,
  };
}

/** Single token (WETH) routable only on Arbitrum, USDC only on Base → forces a bridge. */
function bridgeConfig() {
  return {
    chains: [8453, 42161],
    settlement: {
      8453: { symbol: "USDC", address: USDC_BASE, decimals: 6 },
      42161: { symbol: "USDC", address: USDC_ARB, decimals: 6 },
    },
    router: { 8453: ROUTER_BASE, 42161: ROUTER_ARB },
    quoter: { 8453: QUOTER_BASE, 42161: QUOTER_ARB },
    bridge: {
      messenger: { 8453: MSG_BASE, 42161: MSG_ARB },
      transmitter: { 8453: XMIT_BASE, 42161: XMIT_ARB },
      domains: { 8453: 6, 42161: 3 },
      maxPerTxUsd: 1000,
    },
    basket: [
      {
        symbol: "WETH",
        weight: 1.0,
        chains: [{ chainId: 42161, address: WETH_ARB, decimals: 18, feeTier: 3000 }],
      },
    ],
    rebalanceBandBps: 500,
    maxSlippageBps: 100,
  };
}

/** Two-token basket with a cadence DCA of $500/week. */
function dcaConfig() {
  return { ...twoTokenConfig(), dca: { amountUsd: 500, periodSec: 604800 } };
}

/** A basket holding a tokenized stock (NVDA) on Robinhood, settled in USDG (18 decimals). */
function stockConfig() {
  return {
    chains: [4663],
    settlement: {
      4663: { symbol: "USDG", address: USDG_RH, decimals: 18 },
    },
    router: { 4663: ROUTER_RH },
    quoter: { 4663: QUOTER_RH },
    bridge: {
      messenger: {},
      transmitter: {},
      domains: {}, // Robinhood has no CCTP — funded direct, never bridged
      maxPerTxUsd: 1000,
    },
    basket: [
      {
        symbol: "NVDA",
        weight: 1.0,
        chains: [{ chainId: 4663, address: NVDA_RH, decimals: 18, feeTier: 500 }],
      },
    ],
    rebalanceBandBps: 500,
    maxSlippageBps: 100,
  };
}

/** A basket holding a Coinbase tokenized stock (NVDAc) on Base, settled in USDC (6 decimals). */
function baseStockConfig() {
  return {
    chains: [8453],
    settlement: {
      8453: { symbol: "USDC", address: USDC_BASE, decimals: 6 },
    },
    router: { 8453: ROUTER_BASE },
    quoter: { 8453: QUOTER_BASE },
    bridge: {
      messenger: {},
      transmitter: {},
      domains: {}, // Base-only here; the token is bought with idle USDC, no bridge needed
      maxPerTxUsd: 1000,
    },
    basket: [
      {
        symbol: "NVDAc",
        weight: 1.0,
        chains: [{ chainId: 8453, address: NVDA_BASE, decimals: 18, feeTier: 500 }],
      },
    ],
    rebalanceBandBps: 500,
    maxSlippageBps: 100,
  };
}

/** A single two-hop token (USDC → WETH → ZAMA) on Base. */
function twoHopConfig() {
  return {
    chains: [8453],
    settlement: { 8453: { symbol: "USDC", address: USDC_BASE, decimals: 6 } },
    router: { 8453: ROUTER_BASE },
    quoter: { 8453: QUOTER_BASE },
    bridge: { messenger: {}, transmitter: {}, domains: {}, maxPerTxUsd: 1000 },
    basket: [
      {
        symbol: "ZAMA",
        weight: 1.0,
        chains: [
          {
            chainId: 8453,
            address: ZAMA_BASE,
            decimals: 18,
            feeTier: 3000, // hub → token leg
            via: { address: WETH_BASE, feeTier: 500 }, // settlement → hub leg
          },
        ],
      },
    ],
    rebalanceBandBps: 500,
    maxSlippageBps: 100,
  };
}

/** Two-token basket where ZAMA is two-hop and can be driven overweight to force a sell. */
function twoHopSellConfig() {
  return {
    chains: [8453],
    settlement: { 8453: { symbol: "USDC", address: USDC_BASE, decimals: 6 } },
    router: { 8453: ROUTER_BASE },
    quoter: { 8453: QUOTER_BASE },
    bridge: { messenger: {}, transmitter: {}, domains: {}, maxPerTxUsd: 1000 },
    basket: [
      {
        symbol: "ZAMA",
        weight: 0.5,
        chains: [
          { chainId: 8453, address: ZAMA_BASE, decimals: 18, feeTier: 3000, via: { address: WETH_BASE, feeTier: 500 } },
        ],
      },
      {
        symbol: "WETH",
        weight: 0.5,
        chains: [{ chainId: 8453, address: WETH_BASE, decimals: 18, feeTier: 3000 }],
      },
    ],
    rebalanceBandBps: 500,
    maxSlippageBps: 100,
  };
}

/** cbHYPE on Base, whose only real USDC pool is on Aerodrome Slipstream (tickSpacing 200). */
function aeroConfig() {
  return {
    chains: [8453],
    settlement: { 8453: { symbol: "USDC", address: USDC_BASE, decimals: 6 } },
    router: { 8453: ROUTER_BASE },
    quoter: { 8453: QUOTER_BASE },
    aerodrome: { router: { 8453: AERO_ROUTER }, quoter: { 8453: AERO_QUOTER } },
    bridge: { messenger: {}, transmitter: {}, domains: {}, maxPerTxUsd: 1000 },
    basket: [
      {
        symbol: "cbHYPE",
        weight: 1.0,
        chains: [
          { chainId: 8453, address: CBHYPE_BASE, decimals: 18, dex: "aerodrome" as const, tickSpacing: 200, feeTier: 0 },
        ],
      },
    ],
    rebalanceBandBps: 500,
    maxSlippageBps: 100,
  };
}

// ── Mock context ──────────────────────────────────────────────────────────────

type Balances = Record<string, bigint>; // key `${chainId}:${token.toLowerCase()}`
type Allowances = Record<string, bigint>; // key `${chainId}:${token}:${spender}`

function makeCtx(
  opts: {
    timestamp?: number;
    balances?: Balances;
    allowances?: Allowances;
  } = {},
) {
  const balances = opts.balances ?? {};
  const allowances = opts.allowances ?? {};

  const ctx = {
    safe: SAFE,
    account: SAFE,
    chainId: 8453,
    blockNumber: 1_000_000n,
    timestamp: opts.timestamp ?? 0,
    log: () => {},
    chain: (chainId: number) => ({
      chainId,
      publicClient: {
        // 1:1 price: echo the input amount back as the output amount. Multi-hop quote
        // args are [path, amountIn], so the amount is args[1].
        simulateContract: async ({ args }: { args: unknown[] }) => ({
          result: [args[1], 0n, 0, 0n],
        }),
      },
      read: {
        balance: async (token: string) => balances[`${chainId}:${token.toLowerCase()}`] ?? 0n,
        // Default: unlimited allowance, so swap tests exercise the swap path directly.
        // Approve-path tests set an explicit (small) allowance to force the approve branch.
        allowance: async (token: string, _owner: string, spender: string) =>
          allowances[`${chainId}:${token.toLowerCase()}:${spender.toLowerCase()}`] ?? MAX_UINT,
        decimals: async () => 18,
      },
      dispatch: (intent: { calls: { target: string; value: bigint; data: string }[] }) => ({
        txHash: "0x" as const,
        calls: intent.calls,
        success: true,
        gasUsed: 0n,
      }),
    }),
  };

  return ctx as unknown as Parameters<typeof agent.tick>[0];
}

// ── Test harness ──────────────────────────────────────────────────────────────

async function run(
  config: import("./agent.js").PortfolioConfig,
  ctx: ReturnType<typeof makeCtx>,
  ledger?: string,
  activity?: string,
): Promise<ReturnType<typeof agent.tick> extends Promise<infer T> ? T : never> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-agent-test-"));
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".sail", "portfolio.json"), JSON.stringify(config));
  if (ledger !== undefined) {
    fs.mkdirSync(path.join(dir, ".sail", "memory"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".sail", "memory", "ledger.jsonl"), ledger);
  }
  if (activity !== undefined) {
    fs.writeFileSync(path.join(dir, ".sail", "activity.jsonl"), activity);
  }
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await agent.tick(ctx);
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Parse a Uniswap V3 path (tokenIn|fee|via?|fee|tokenOut) back into its tokens. */
function parsePath(path: string): { tokenIn: string; tokenOut: string; via?: string } {
  const hex = path.slice(2).toLowerCase();
  const tokenIn = `0x${hex.slice(0, 40)}`;
  const afterIn = hex.slice(46); // tokenIn(40) + fee(6)
  if (afterIn.length === 40) return { tokenIn, tokenOut: `0x${afterIn}` }; // single hop
  const via = `0x${afterIn.slice(0, 40)}`;
  const afterVia = afterIn.slice(46); // via(40) + fee(6)
  return { tokenIn, via, tokenOut: `0x${afterVia}` };
}

function swapArgs(call: { data: string }) {
  const d = decodeFunctionData({ abi: EXACT_INPUT, data: call.data as `0x${string}` });
  const params = d.args[0] as unknown as {
    path: string;
    recipient: string;
    deadline: bigint;
    amountIn: bigint;
    amountOutMinimum: bigint;
  };
  const { tokenIn, tokenOut, via } = parsePath(params.path);
  return { ...params, tokenIn, tokenOut, via };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("portfolio empty → no dispatches", async () => {
  const dispatches = await run(twoTokenConfig(), makeCtx({ timestamp: 0 }));
  assert.equal(dispatches.length, 0);
});

test("balanced and no idle USDC → no dispatches", async () => {
  const dispatches = await run(
    twoTokenConfig(),
    makeCtx({
      timestamp: 0,
      balances: {
        [`8453:${WETH_BASE}`]: 40_000_000n,
        [`8453:${WBTC_BASE}`]: 60_000_000n,
      },
    }),
  );
  assert.equal(dispatches.length, 0);
});

test("sells an overweight token (token → USDC)", async () => {
  const dispatches = await run(
    twoTokenConfig(),
    makeCtx({
      timestamp: 0,
      balances: { [`8453:${WETH_BASE}`]: 100_000_000n }, // WETH at 100%, target 40%
    }),
  );
  assert.equal(dispatches.length, 1);
  const call = dispatches[0].calls[0];
  assert.equal(call.target.toLowerCase(), ROUTER_BASE.toLowerCase());
  const a = swapArgs(call);
  assert.equal(a.tokenIn.toLowerCase(), WETH_BASE.toLowerCase());
  assert.equal(a.tokenOut.toLowerCase(), USDC_BASE.toLowerCase());
});

test("deploys a USDC deposit across the whole basket", async () => {
  const dispatches = await run(
    twoTokenConfig(),
    makeCtx({
      timestamp: 0,
      balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n }, // all USDC, both tokens 0%
    }),
  );
  assert.equal(dispatches.length, 2); // WETH and WBTC each get their target share
  for (const d of dispatches) {
    const call = d.calls[0];
    assert.equal(call.target.toLowerCase(), ROUTER_BASE.toLowerCase());
    const a = swapArgs(call);
    assert.equal(a.tokenIn.toLowerCase(), USDC_BASE.toLowerCase());
  }
});

const T0 = 1_700_000_000; // realistic unix timestamp so 0-defaults don't trip the in-flight guard
const acted = (ts = T0 - 1000) =>
  `${JSON.stringify({ ts, kind: "acted", outcome: "confirmed" })}\n`;

test("DCA mode buys a fixed amount per period, not all idle USDC", async () => {
  const dispatches = await run(
    dcaConfig(),
    makeCtx({ timestamp: T0, balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n } }),
  );
  assert.equal(dispatches.length, 2);
  const amounts = dispatches
    .map((d) => swapArgs(d.calls[0]).amountIn)
    .sort((a, b) => (a < b ? -1 : 1));
  // $500 split 40/60 → $200 WETH, $300 WBTC, leaving the rest of the $1000 idle.
  assert.deepEqual(amounts, [200_000_000n, 300_000_000n]);
});

test("DCA mode leaves idle USDC untouched between periods", async () => {
  const invested = JSON.stringify({ ts: T0 - 100, kind: "invested" });
  const dispatches = await run(
    dcaConfig(),
    makeCtx({
      timestamp: T0,
      balances: {
        [`8453:${WETH_BASE}`]: 40_000_000n,
        [`8453:${WBTC_BASE}`]: 60_000_000n,
        [`8453:${USDC_BASE}`]: 1_000_000_000n,
      },
    }),
    `${invested}\n`,
  );
  assert.equal(dispatches.length, 0);
});

test("bridges USDC when the token's chain holds none → approve first", async () => {
  const dispatches = await run(
    bridgeConfig(),
    makeCtx({
      timestamp: T0,
      balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n },
      allowances: { [`8453:${USDC_BASE}:${MSG_BASE}`]: 0n }, // short → approve first
    }),
    acted(),
  );
  assert.equal(dispatches.length, 1);
  const call = dispatches[0].calls[0];
  assert.equal(call.target.toLowerCase(), USDC_BASE.toLowerCase()); // approve on USDC
  const d = decodeFunctionData({ abi: APPROVE, data: call.data as `0x${string}` });
  assert.equal(d.functionName, "approve");
  const [spender] = d.args;
  assert.equal(spender.toLowerCase(), MSG_BASE.toLowerCase());
});

test("bridges with sufficient allowance → depositForBurn to messenger", async () => {
  const dispatches = await run(
    bridgeConfig(),
    makeCtx({
      timestamp: T0,
      balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n },
      allowances: { [`8453:${USDC_BASE}:${MSG_BASE}`]: 1_000_000_000_000n },
    }),
    acted(),
  );
  assert.equal(dispatches.length, 1);
  const call = dispatches[0].calls[0];
  assert.equal(call.target.toLowerCase(), MSG_BASE.toLowerCase());
  const d = decodeFunctionData({ abi: DEPOSIT_FOR_BURN, data: call.data as `0x${string}` });
  assert.equal(d.functionName, "depositForBurn");
  const [amount, domain, mintRecipient, burnToken] = d.args;
  assert.equal(amount, 1_000_000_000n);
  assert.equal(domain, 3); // Arbitrum CCTP domain
  assert.equal(burnToken.toLowerCase(), USDC_BASE.toLowerCase());
  // Self-recipient: the SMA's own address left-padded to bytes32.
  assert.equal(mintRecipient, `0x${"0".repeat(24)}${SAFE.slice(2)}`);
});

test("in-flight bridge guard → no re-bridge while mint pending", async () => {
  const bridged = JSON.stringify({ ts: T0 - 500, kind: "bridged", source: 8453, dest: 42161 });
  const dispatches = await run(
    bridgeConfig(),
    makeCtx({ timestamp: T0, balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n } }),
    `${acted()}${bridged}\n`,
  );
  assert.equal(dispatches.length, 0);
});

test("completes a pending burn's mint half even when the portfolio is empty", async () => {
  const BRIDGE_TX = `0x${"ab".repeat(32)}`;
  const bridged = JSON.stringify({
    ts: T0 - 600,
    kind: "bridged",
    source: 8453,
    dest: 42161,
    amount: "1000000",
    messenger: MSG_BASE,
  });
  const activity = `${JSON.stringify({
    ts: "2026-08-20T00:00:00Z",
    actor: "agent",
    type: "dispatch_executed",
    target: MSG_BASE,
    chainId: 8453,
    txHash: BRIDGE_TX,
    safe: SAFE,
  })}\n`;

  // Stub Iris: return the signed message + attestation for the burn.
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ messages: [{ message: "0xdeadbeef", attestation: "0xcafebabe" }] }),
  })) as unknown as typeof fetch;
  try {
    // Empty portfolio (no USDC, no holdings) — the mint must still complete.
    const dispatches = await run(bridgeConfig(), makeCtx({ timestamp: T0 }), `${bridged}\n`, activity);
    assert.equal(dispatches.length, 1);
    const call = dispatches[0].calls[0];
    assert.equal(call.target.toLowerCase(), XMIT_ARB.toLowerCase());
    const d = decodeFunctionData({ abi: RECEIVE_MESSAGE_ABI, data: call.data as `0x${string}` });
    assert.equal(d.functionName, "receiveMessage");
    const [message, attestation] = d.args;
    assert.equal(message, "0xdeadbeef");
    assert.equal(attestation, "0xcafebabe");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("stock on Robinhood: buys with USDG against the stock, no bridge attempted", async () => {
  // Fund USDG (18 decimals) on Robinhood. The mock echoes 1:1, so a $500 buy of NVDA
  // against USDG produces a swap with tokenIn = USDG and the amount in 18-decimal units.
  const dispatches = await run(
    stockConfig(),
    makeCtx({
      timestamp: T0,
      balances: { [`4663:${USDG_RH}`]: 500_000_000_000_000_000_000n }, // 500 USDG (18 dec)
    }),
  );
  assert.equal(dispatches.length, 1);
  const call = dispatches[0].calls[0];
  assert.equal(call.target.toLowerCase(), ROUTER_RH.toLowerCase());
  const args = swapArgs(call);
  assert.equal(args.tokenIn.toLowerCase(), USDG_RH.toLowerCase());
  assert.equal(args.tokenOut.toLowerCase(), NVDA_RH.toLowerCase());
  // $500 → 500 * 1e18 native units for the 18-decimal settlement currency.
  assert.equal(args.amountIn, 500_000_000_000_000_000_000n);
});

test("stock on Robinhood with no USDG → no bridge, no dispatch (funded direct)", async () => {
  // No USDG balance on Robinhood, and Robinhood has no CCTP domain — the agent must skip,
  // not attempt to bridge USDC there.
  const dispatches = await run(stockConfig(), makeCtx({ timestamp: T0 }));
  assert.equal(dispatches.length, 0);
});

test("stock on Base (NVDAc) settles in USDC — buys with USDC, no USDG leg", async () => {
  // Coinbase tokenized stocks live on Base and settle in USDC, so they buy like any other
  // Base asset: tokenIn = USDC (6 decimals), no second currency, no bridge.
  const dispatches = await run(
    baseStockConfig(),
    makeCtx({
      timestamp: T0,
      balances: { [`8453:${USDC_BASE}`]: 500_000_000n }, // 500 USDC (6 dec)
    }),
  );
  assert.equal(dispatches.length, 1);
  const call = dispatches[0].calls[0];
  assert.equal(call.target.toLowerCase(), ROUTER_BASE.toLowerCase());
  const args = swapArgs(call);
  assert.equal(args.tokenIn.toLowerCase(), USDC_BASE.toLowerCase());
  assert.equal(args.tokenOut.toLowerCase(), NVDA_BASE.toLowerCase());
  assert.equal(args.amountIn, 500_000_000n); // $500 in 6-decimal units
});

test("rebalance cadence: trims only after the period elapses", async () => {
  const config = { ...twoTokenConfig(), rebalancePeriodSec: 604800 };
  const recent = JSON.stringify({ ts: T0 - 100, kind: "rebalanced" });
  const dispatches = await run(
    config,
    makeCtx({ timestamp: T0, balances: { [`8453:${WETH_BASE}`]: 100_000_000n } }),
    `${recent}\n`,
  );
  assert.equal(dispatches.length, 0);
});

test("rebalance cadence: trims when the period has elapsed", async () => {
  const config = { ...twoTokenConfig(), rebalancePeriodSec: 604800 };
  const dispatches = await run(
    config,
    makeCtx({ timestamp: T0, balances: { [`8453:${WETH_BASE}`]: 100_000_000n } }),
  );
  assert.equal(dispatches.length, 1);
});

test("records cost basis only after the runner confirms the buy (Bug 2)", async () => {
  // A buy is now written as a pending `trade` intent and confirmed to `bought` only when the
  // runner records `dispatch_executed`. On the first tick nothing is confirmed, so cost basis
  // is zero; once the activity log carries the execution, the next tick records the buy.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-cost-test-"));
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".sail", "portfolio.json"), JSON.stringify(twoTokenConfig()));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const activity = `${JSON.stringify({
      ts: "2026-08-20T00:00:00Z",
      actor: "agent",
      type: "dispatch_executed",
      target: ROUTER_BASE,
      chainId: 8453,
      txHash: `0x${"cd".repeat(32)}`,
      safe: SAFE,
    })}\n${JSON.stringify({
      ts: "2026-08-20T00:00:01Z",
      actor: "agent",
      type: "dispatch_executed",
      target: ROUTER_BASE,
      chainId: 8453,
      txHash: `0x${"ce".repeat(32)}`,
      safe: SAFE,
    })}\n`;
    fs.writeFileSync(path.join(dir, ".sail", "activity.jsonl"), activity);

    // First tick: $1000 USDC is queued as two pending buys, but nothing is confirmed yet.
    await agent.tick(
      makeCtx({ timestamp: T0, balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n } }),
    );
    const before = JSON.parse(
      fs.readFileSync(path.join(dir, ".sail", "state", "snapshot.json"), "utf-8"),
    );
    assert.equal(before.costBasis, "0");

    // Second tick: the runner's dispatch_executed records now confirm both buys.
    await agent.tick(
      makeCtx({
        timestamp: T0 + 60,
        balances: {
          [`8453:${WETH_BASE}`]: 40_000_000n,
          [`8453:${WBTC_BASE}`]: 60_000_000n,
        },
      }),
    );
    const after = JSON.parse(
      fs.readFileSync(path.join(dir, ".sail", "state", "snapshot.json"), "utf-8"),
    );
    assert.equal(after.costBasis, "1000000000");
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("agent-managed approve: emits an approve when the router allowance is short", async () => {
  const dispatches = await run(
    twoTokenConfig(),
    makeCtx({
      timestamp: T0,
      balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n },
      // No allowance to the router → the agent must grant it first, not swap.
      allowances: { [`8453:${USDC_BASE}:${ROUTER_BASE}`]: 0n },
    }),
  );
  assert.ok(dispatches.length >= 1);
  // Every dispatch must be an approve to the router (target = USDC token, not the router),
  // because the allowance is short. The swap happens on a later tick once it clears.
  for (const d of dispatches) {
    const call = d.calls[0];
    assert.equal(call.target.toLowerCase(), USDC_BASE.toLowerCase());
    const dec = decodeFunctionData({ abi: APPROVE, data: call.data as `0x${string}` });
    const spender = (dec.args as readonly unknown[])[0] as string;
    assert.equal(spender.toLowerCase(), ROUTER_BASE.toLowerCase());
  }
});

test("skips the approve when the router allowance is already sufficient", async () => {
  const dispatches = await run(
    twoTokenConfig(),
    makeCtx({
      timestamp: T0,
      balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n },
      // A generous existing allowance → the agent swaps directly, no approve first.
      allowances: { [`8453:${USDC_BASE}:${ROUTER_BASE}`]: 1_000_000_000_000_000n },
    }),
  );
  assert.ok(dispatches.length > 0);
  for (const d of dispatches) {
    const call = d.calls[0];
    assert.equal(call.target.toLowerCase(), ROUTER_BASE.toLowerCase());
  }
});

test("two-hop asset buys through the hub (USDC → WETH → token)", async () => {
  const dispatches = await run(
    twoHopConfig(),
    makeCtx({ timestamp: T0, balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n } }),
  );
  assert.equal(dispatches.length, 1);
  const a = swapArgs(dispatches[0].calls[0]);
  assert.equal(a.tokenIn.toLowerCase(), USDC_BASE.toLowerCase());
  assert.equal(a.via!.toLowerCase(), WETH_BASE.toLowerCase());
  assert.equal(a.tokenOut.toLowerCase(), ZAMA_BASE.toLowerCase());
});

test("two-hop asset values and sells back through the hub (token → WETH → USDC)", async () => {
  // ZAMA at 100% (overweight vs 50% target) forces a trim; the reverse path must route
  // through WETH back to USDC, proving the two-hop valuation + sell both work.
  const dispatches = await run(
    twoHopSellConfig(),
    makeCtx({ timestamp: T0, balances: { [`8453:${ZAMA_BASE}`]: 100_000_000n } }),
  );
  assert.equal(dispatches.length, 1);
  const a = swapArgs(dispatches[0].calls[0]);
  assert.equal(a.tokenIn.toLowerCase(), ZAMA_BASE.toLowerCase());
  assert.equal(a.via!.toLowerCase(), WETH_BASE.toLowerCase());
  assert.equal(a.tokenOut.toLowerCase(), USDC_BASE.toLowerCase());
});

test("two-hop asset without via degrades to a direct swap, never a guessed hop", async () => {
  // If a two-hop token's `via` is missing from the config, the runtime treats it as a
  // direct single-hop swap (no hop is ever invented). A genuinely broken leg (e.g. a
  // feeTier 0 placeholder) reverts at quote time and is skipped with a log, not guessed.
  const cfg = twoHopConfig();
  delete (cfg.basket[0].chains[0] as { via?: unknown }).via;
  const dispatches = await run(
    cfg,
    makeCtx({ timestamp: T0, balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n } }),
  );
  assert.equal(dispatches.length, 1);
  const a = swapArgs(dispatches[0].calls[0]);
  assert.equal(a.tokenIn.toLowerCase(), USDC_BASE.toLowerCase());
  assert.equal(a.via, undefined); // no invented middle hop
  assert.equal(a.tokenOut.toLowerCase(), ZAMA_BASE.toLowerCase());
});

test("aerodrome asset routes through the Aerodrome router with a tickSpacing path", async () => {
  const dispatches = await run(
    aeroConfig(),
    makeCtx({ timestamp: T0, balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n } }),
  );
  assert.equal(dispatches.length, 1);
  const call = dispatches[0].calls[0];
  // The dispatch must target the Aerodrome Slipstream router, not Uniswap V3.
  assert.equal(call.target.toLowerCase(), AERO_ROUTER.toLowerCase());
  const a = swapArgs(call);
  // Direct single hop: USDC → cbHYPE, no invented intermediate.
  assert.equal(a.tokenIn.toLowerCase(), USDC_BASE.toLowerCase());
  assert.equal(a.tokenOut.toLowerCase(), CBHYPE_BASE.toLowerCase());
  assert.equal(a.via, undefined);
  // The path's 24-bit hop field is the tickSpacing (200 = 0x0000c8), not a fee.
  assert.match(a.path.toLowerCase(), /0000c8/);
});

test("counts in-flight bridge USDC in total value (Bug 1)", async () => {
  // $175 burned for a bridge but not yet minted on the destination. It must count toward
  // total value, or buys sized during the flight window undershoot target by $175.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-pending-bridge-test-"));
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".sail", "portfolio.json"), JSON.stringify(twoTokenConfig()));
  fs.mkdirSync(path.join(dir, ".sail", "memory"), { recursive: true });
  const bridged = JSON.stringify({ ts: T0 - 500, kind: "bridged", source: 8453, dest: 42161, amount: "175000000", messenger: MSG_BASE });
  fs.writeFileSync(path.join(dir, ".sail", "memory", "ledger.jsonl"), `${bridged}\n`);
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await agent.tick(makeCtx({ timestamp: T0, balances: { [`8453:${USDC_BASE}`]: 825_000_000n } }));
    const snap = JSON.parse(fs.readFileSync(path.join(dir, ".sail", "state", "snapshot.json"), "utf-8"));
    // 825 idle + 0 invested + 175 in flight = 1000.
    assert.equal(snap.totalValue, "1000000000");
    assert.equal(snap.pendingBridgeUsdc, "175000000");
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buys the partial shortfall when idle cash is below target (Bug 3)", async () => {
  // WBTC is $500 short, only $100 idle USDC sits on the chain. The agent must buy the
  // $100 it can (partial), not skip the token and park the cash.
  const cfg = {
    ...twoTokenConfig(),
    rebalancePeriodSec: 604800, // gate the WETH sell so it doesn't interfere
    basket: [
      { symbol: "WETH", weight: 0.5, chains: [{ chainId: 8453, address: WETH_BASE, decimals: 18, feeTier: 3000 }] },
      { symbol: "WBTC", weight: 0.5, chains: [{ chainId: 8453, address: WBTC_BASE, decimals: 8, feeTier: 3000 }] },
    ],
  };
  const recent = JSON.stringify({ ts: T0 - 100, kind: "rebalanced" });
  const dispatches = await run(
    cfg,
    makeCtx({
      timestamp: T0,
      balances: { [`8453:${WETH_BASE}`]: 900_000_000n, [`8453:${USDC_BASE}`]: 100_000_000n },
    }),
    `${recent}\n`,
  );
  // WETH is overweight (gated from selling); WBTC is under by $500 and gets a $100 partial buy.
  assert.equal(dispatches.length, 1);
  const a = swapArgs(dispatches[0].calls[0]);
  assert.equal(a.tokenOut.toLowerCase(), WBTC_BASE.toLowerCase());
  assert.equal(a.amountIn, 100_000_000n);
});

test("shares the spend budget across legs so one tick never over-dispatches (Bug 4)", async () => {
  // Two under-target tokens ($60 each), $100 idle USDC. Without a shared budget each leg
  // re-reads the full $100 and queues $60+$60=$120 > holdings. With the budget, the second
  // leg is capped to $40.
  const cfg = {
    chains: [8453],
    settlement: { 8453: { symbol: "USDC", address: USDC_BASE, decimals: 6 } },
    router: { 8453: ROUTER_BASE },
    quoter: { 8453: QUOTER_BASE },
    bridge: { messenger: {}, transmitter: {}, domains: {}, maxPerTxUsd: 1000 },
    basket: [
      { symbol: "A", weight: 0.4, chains: [{ chainId: 8453, address: WETH_BASE, decimals: 18, feeTier: 3000 }] },
      { symbol: "B", weight: 0.3, chains: [{ chainId: 8453, address: WBTC_BASE, decimals: 8, feeTier: 3000 }] },
      { symbol: "C", weight: 0.3, chains: [{ chainId: 8453, address: ZAMA_BASE, decimals: 18, feeTier: 3000 }] },
    ],
    rebalanceBandBps: 500,
    maxSlippageBps: 100,
    rebalancePeriodSec: 604800, // gate the overweight A sell
  };
  const recent = JSON.stringify({ ts: T0 - 100, kind: "rebalanced" });
  const dispatches = await run(
    cfg,
    makeCtx({
      timestamp: T0,
      balances: { [`8453:${WETH_BASE}`]: 100_000_000n, [`8453:${USDC_BASE}`]: 100_000_000n },
    }),
    `${recent}\n`,
  );
  // B and C each short $60; A is overweight (gated). Budget $100 → $60 + $40, never $120.
  assert.equal(dispatches.length, 2);
  const amounts = dispatches.map((d) => swapArgs(d.calls[0]).amountIn).sort((a, b) => (a < b ? -1 : 1));
  assert.deepEqual(amounts, [40_000_000n, 60_000_000n]);
});

test("records minted only once the destination actually holds USDC (not on emit)", async () => {
  const BRIDGE_TX = `0x${"ab".repeat(32)}`;
  const bridged = JSON.stringify({ ts: T0 - 600, kind: "bridged", source: 8453, dest: 42161, amount: "1000000", messenger: MSG_BASE });
  const activity = `${JSON.stringify({
    ts: "2026-08-20T00:00:00Z",
    actor: "agent",
    type: "dispatch_executed",
    target: MSG_BASE,
    chainId: 8453,
    txHash: BRIDGE_TX,
    safe: SAFE,
  })}\n`;

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ messages: [{ message: "0xdeadbeef", attestation: "0xcafebabe" }] }),
  })) as unknown as typeof fetch;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-mint-confirm-test-"));
    fs.mkdirSync(path.join(dir, ".sail", "memory"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".sail", "portfolio.json"), JSON.stringify(bridgeConfig()));
    fs.writeFileSync(path.join(dir, ".sail", "memory", "ledger.jsonl"), `${bridged}\n`);
    fs.writeFileSync(path.join(dir, ".sail", "activity.jsonl"), activity);
    const prev = process.cwd();
    process.chdir(dir);
    try {
      // Destination balance is still 0 → receiveMessage is emitted, but minted is NOT written.
      await agent.tick(makeCtx({ timestamp: T0 }));
      const ledger1 = fs.readFileSync(path.join(dir, ".sail", "memory", "ledger.jsonl"), "utf-8");
      assert.ok(!ledger1.includes('"minted"'));
      assert.ok(ledger1.includes('"bridged"'));

      // Destination balance > 0 → the mint is recorded and the emit is skipped.
      await agent.tick(
        makeCtx({ timestamp: T0 + 60, balances: { [`42161:${USDC_ARB}`]: 1_000_000n } }),
      );
      const ledger2 = fs.readFileSync(path.join(dir, ".sail", "memory", "ledger.jsonl"), "utf-8");
      assert.ok(ledger2.includes('"minted"'));
    } finally {
      process.chdir(prev);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("reverted swap is not recorded as bought and widens slippage on retry (Bug 2)", async () => {
  // A pending buy whose dispatch_reverted must NOT become a `bought` (cost basis stays clean)
  // and the next attempt must widen the slippage floor.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-revert-test-"));
  fs.mkdirSync(path.join(dir, ".sail", "memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".sail", "portfolio.json"), JSON.stringify(twoTokenConfig()));
  // A pending buy intent that the runner reported as reverted.
  const intent = JSON.stringify({ ts: T0 - 60, kind: "trade", id: "op-1", side: "buy", symbol: "WETH", amount: "400000000", chainId: 8453, target: ROUTER_BASE.toLowerCase() });
  const activity = `${JSON.stringify({
    ts: "2026-08-20T00:00:00Z",
    actor: "agent",
    type: "dispatch_reverted",
    target: ROUTER_BASE,
    chainId: 8453,
    txHash: `0x${"dd".repeat(32)}`,
    safe: SAFE,
  })}\n`;
  fs.writeFileSync(path.join(dir, ".sail", "memory", "ledger.jsonl"), `${intent}\n`);
  fs.writeFileSync(path.join(dir, ".sail", "activity.jsonl"), activity);
  const prev = process.cwd();
  process.chdir(dir);
  try {
    // Idle USDC re-appears (the revert returned it); WETH is still short, so the agent retries.
    const dispatches = await agent.tick(
      makeCtx({ timestamp: T0, balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n } }),
    );
    const ledger = fs.readFileSync(path.join(dir, ".sail", "memory", "ledger.jsonl"), "utf-8");
    // The reverted intent was resolved as a failure, never a bought.
    assert.ok(ledger.includes('"tradeFailed"'));
    assert.ok(!ledger.includes('"bought"'));
    // The retry queued a fresh buy, with a widened slippage floor (100 + 25 = 125 bps).
    assert.ok(dispatches.length >= 1);
    const retry = dispatches.find((d) => d.calls[0].target.toLowerCase() === ROUTER_BASE.toLowerCase());
    assert.ok(retry);
    const a = swapArgs(retry.calls[0]);
    // Mock quotes 1:1, so amountOutMinimum = amountIn * (1 − 125/10000).
    assert.equal(a.amountOutMinimum, (a.amountIn * 9875n) / 10_000n);
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
