/**
 * Decision-logic tests for the index agent runtime.
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

// ── ABI fragments for decoding calldata ───────────────────────────────────────

const EXACT_INPUT_SINGLE = [
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
        // 1:1 price: echo the input amount back as the output amount.
        simulateContract: async ({ args }: { args: { amountIn: bigint }[] }) => ({
          result: [args[0].amountIn, 0n, 0, 0n],
        }),
      },
      read: {
        balance: async (token: string) => balances[`${chainId}:${token.toLowerCase()}`] ?? 0n,
        allowance: async (token: string, _owner: string, spender: string) =>
          allowances[`${chainId}:${token.toLowerCase()}:${spender.toLowerCase()}`] ?? 0n,
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
  config: import("./agent.js").IndexConfig,
  ctx: ReturnType<typeof makeCtx>,
  ledger?: string,
  activity?: string,
): Promise<ReturnType<typeof agent.tick> extends Promise<infer T> ? T : never> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "index-agent-test-"));
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".sail", "index.json"), JSON.stringify(config));
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

function swapArgs(call: { data: string }) {
  const d = decodeFunctionData({ abi: EXACT_INPUT_SINGLE, data: call.data as `0x${string}` });
  return d.args[0] as unknown as {
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    recipient: string;
  };
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
    makeCtx({ timestamp: T0, balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n } }),
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

test("records cost basis in the snapshot on a buy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "index-cost-test-"));
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".sail", "index.json"), JSON.stringify(twoTokenConfig()));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await agent.tick(
      makeCtx({ timestamp: T0, balances: { [`8453:${USDC_BASE}`]: 1_000_000_000n } }),
    );
    const raw = fs.readFileSync(path.join(dir, ".sail", "state", "snapshot.json"), "utf-8");
    const snap = JSON.parse(raw);
    // $1000 USDC deployed across the basket -> cost basis $1000.
    assert.equal(snap.costBasis, "1000000000");
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
