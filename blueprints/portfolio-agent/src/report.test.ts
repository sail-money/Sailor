/**
 * Tests for the portfolio agent's report composer, flow decomposition, and snapshot writer.
 *
 * These are pure: no chain, no account, no network. They assert the snapshot math
 * (weights against invested holdings, in-band/buy/sell classification, drift), the
 * cadence gate, the JSON serialization, the flow decomposition, and the rendered
 * three-state report text.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  type PortfolioSnapshot,
  buildReportContext,
  buildSnapshot,
  composeReport,
  formatUsd,
  shouldRun,
  statusFor,
  writeSnapshot,
} from "./report.js";

test("statusFor classifies in band, buy, and sell", () => {
  assert.equal(statusFor(4000n, 4000n, 500n), "in-band");
  assert.equal(statusFor(4500n, 4000n, 500n), "in-band"); // at the band edge, not beyond
  assert.equal(statusFor(4600n, 4000n, 500n), "sell");
  assert.equal(statusFor(3400n, 4000n, 500n), "buy");
});

test("formatUsd renders dollars from 6-decimal base units", () => {
  assert.equal(formatUsd(109_320_000n), "$109.32");
  assert.equal(formatUsd(8_560_000n), "$8.56");
  assert.equal(formatUsd(0n), "$0.00");
  assert.equal(formatUsd(-8_560_000n), "-$8.56");
});

test("shouldRun fires when the period has elapsed", () => {
  const T = 1_700_000_000;
  assert.equal(shouldRun(T, 0, 0), true); // period 0 = every run
  assert.equal(shouldRun(T, T - 100, 60), true); // elapsed
  assert.equal(shouldRun(T, T - 10, 60), false); // too soon
  assert.equal(shouldRun(T, 0, 604800), true); // never ran, real timestamp -> run
});

test("buildSnapshot values the basket and reports idle USDC separately", () => {
  const s = buildSnapshot({
    usdcTotal: 50_000_000n,
    holdings: [
      { symbol: "WETH", value: 40_000_000n, targetBps: 4000n },
      { symbol: "WBTC", value: 60_000_000n, targetBps: 6000n },
    ],
    bandBps: 500,
    asOf: 1_700_000_000,
  });
  assert.equal(s.investedValue, 100_000_000n);
  assert.equal(s.idleUsdc, 50_000_000n);
  assert.equal(s.totalValue, 150_000_000n);
  assert.equal(s.pendingBridgeUsdc, 0n);
  assert.equal(s.costBasis, null);
  assert.equal(s.asOf, 1_700_000_000);
  const weth = s.holdings.find((h) => h.symbol === "WETH");
  assert.ok(weth);
  assert.equal(weth.weightBps, 4000n); // 40% of invested holdings
  assert.equal(weth.targetBps, 4000n);
  assert.equal(weth.status, "in-band");
  assert.equal(weth.driftBps, 0n);
});

test("buildSnapshot counts in-flight bridge USDC in total value but not in idle USDC", () => {
  const s = buildSnapshot({
    usdcTotal: 50_000_000n,
    holdings: [{ symbol: "WETH", value: 40_000_000n, targetBps: 4000n }],
    bandBps: 500,
    pendingBridgeUsdc: 17_500_000n,
  });
  assert.equal(s.investedValue, 40_000_000n);
  assert.equal(s.idleUsdc, 50_000_000n); // idle stays visible balance only
  assert.equal(s.pendingBridgeUsdc, 17_500_000n);
  assert.equal(s.totalValue, 107_500_000n); // 50 + 40 + 17.5
});

test("buildSnapshot flags an overweight holding for sell and an underweight for buy", () => {
  const s = buildSnapshot({
    usdcTotal: 0n,
    holdings: [
      { symbol: "WETH", value: 70_000_000n, targetBps: 4000n },
      { symbol: "WBTC", value: 30_000_000n, targetBps: 6000n },
    ],
    bandBps: 500,
  });
  const weth = s.holdings.find((h) => h.symbol === "WETH");
  const wbtc = s.holdings.find((h) => h.symbol === "WBTC");
  assert.ok(weth && wbtc);
  assert.equal(weth.weightBps, 7000n); // 70% vs 40% target
  assert.equal(weth.status, "sell");
  assert.equal(weth.driftBps, 3000n);
  assert.equal(wbtc.weightBps, 3000n); // 30% vs 60% target
  assert.equal(wbtc.status, "buy");
  assert.equal(wbtc.driftBps, -3000n);
});

test("writeSnapshot writes bigints as decimal strings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-snapshot-test-"));
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const s = buildSnapshot({
      usdcTotal: 50_000_000n,
      holdings: [{ symbol: "WETH", value: 40_000_000n, targetBps: 4000n }],
      bandBps: 500,
    });
    writeSnapshot(s);
    const raw = fs.readFileSync(path.join(dir, ".sail", "state", "snapshot.json"), "utf-8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.totalValue, "90000000");
    assert.equal(parsed.pendingBridgeUsdc, "0");
    assert.equal(parsed.holdings[0].value, "40000000");
    // Single holding → weight is 100% vs a 40% target, so drift is +6000 bps.
    assert.equal(parsed.holdings[0].driftBps, "6000");
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Flow decomposition ─────────────────────────────────────────────────────────

function snapshot(
  over: Partial<PortfolioSnapshot> & {
    totalValue: bigint;
    investedValue: bigint;
    idleUsdc: bigint;
    costBasis: bigint;
    holdings: PortfolioSnapshot["holdings"];
  },
): PortfolioSnapshot {
  return { pendingBridgeUsdc: 0n, ...over };
}

const h = (
  symbol: string,
  value: bigint,
  weightBps: bigint,
  targetBps: bigint,
): PortfolioSnapshot["holdings"][number] => ({
  symbol,
  value,
  weightBps,
  targetBps,
  status: statusFor(weightBps, targetBps, 500n),
  driftBps: weightBps - targetBps,
});

test("buildReportContext recovers the previous baseline and trades since it", () => {
  const lines = [
    JSON.stringify({
      ts: 100,
      kind: "reported",
      totalValue: "100000000",
      investedValue: "90000000",
      costBasis: "90000000",
      idleUsdc: "10000000",
    }),
    JSON.stringify({
      ts: 110,
      kind: "bought",
      symbol: "MORPHO",
      amount: "35000000",
      txHash: "0x1",
    }),
    JSON.stringify({ ts: 120, kind: "sold", symbol: "SKY", amount: "20000000", txHash: "0x2" }),
  ];
  const { baseline, actions } = buildReportContext(lines);
  assert.ok(baseline);
  assert.equal(baseline.totalValue, 100_000_000n);
  assert.equal(baseline.investedValue, 90_000_000n);
  assert.equal(baseline.costBasis, 90_000_000n);
  assert.equal(baseline.idleUsdc, 10_000_000n);
  assert.deepEqual(actions, [
    { symbol: "MORPHO", side: "bought", amount: 35_000_000n },
    { symbol: "SKY", side: "sold", amount: 20_000_000n },
  ]);
});

test("buildReportContext returns a null baseline on the first report", () => {
  // No `reported` entry yet → null baseline, but confirmed trades are still collected
  // ("since the beginning").
  const { baseline, actions } = buildReportContext([
    JSON.stringify({ ts: 110, kind: "bought", symbol: "MORPHO", amount: "35000000" }),
  ]);
  assert.equal(baseline, null);
  assert.deepEqual(actions, [{ symbol: "MORPHO", side: "bought", amount: 35_000_000n }]);
});

// ── Three-state report ─────────────────────────────────────────────────────────

test("composeReport renders the normal state with verdict first", () => {
  // A buy + a market move, no external flow: idle fell and cost basis rose together, then
  // price moved holdings up. netFlow = 0 → "normal".
  const s = snapshot({
    totalValue: 145_000_000n,
    investedValue: 110_000_000n,
    idleUsdc: 35_000_000n,
    costBasis: 100_000_000n,
    holdings: [h("WETH", 44_000_000n, 4000n, 4000n), h("WBTC", 66_000_000n, 6000n, 6000n)],
  });
  const baseline = {
    totalValue: 140_000_000n,
    investedValue: 95_000_000n,
    costBasis: 90_000_000n,
    idleUsdc: 45_000_000n,
  };
  const r = composeReport(s, { baseline, actions: [], asOf: "Aug 14, 2026" });
  const lines = r.split("\n");
  assert.equal(lines[0], "<b>Everything is on track. Nothing needs you.</b>"); // verdict FIRST
  assert.ok(r.includes("$145.00")); // score = total value
  assert.ok(r.includes("this week")); // normal-state change breakdown
  assert.ok(r.includes("No trades this week."));
  assert.ok(r.includes("🟢 WETH"));
  assert.ok(r.includes("Nothing needs you."));
});

test("composeReport splits a deposit from market movement", () => {
  // A $500 deposit arrived and market moved +$50: totalValue rose $550, but the verdict
  // and breakdown must attribute $500 to the deposit, not a $550 "gain".
  const s = snapshot({
    totalValue: 695_000_000n,
    investedValue: 600_000_000n,
    idleUsdc: 95_000_000n,
    costBasis: 550_000_000n,
    holdings: [h("WETH", 600_000_000n, 10000n, 10000n)],
  });
  const baseline = {
    totalValue: 145_000_000n,
    investedValue: 100_000_000n,
    costBasis: 100_000_000n,
    idleUsdc: 45_000_000n,
  };
  const r = composeReport(s, { baseline, actions: [] });
  assert.ok(r.includes("$500.00 received and invested."));
  assert.ok(r.includes("$500.00 deposited"));
  assert.ok(!r.includes("$550.00")); // never a $550 gain
});

test("composeReport renders the withdrawal state", () => {
  const s = snapshot({
    totalValue: 50_000_000n,
    investedValue: 40_000_000n,
    idleUsdc: 10_000_000n,
    costBasis: 40_000_000n,
    holdings: [h("WETH", 40_000_000n, 10000n, 10000n)],
  });
  const baseline = {
    totalValue: 90_000_000n,
    investedValue: 80_000_000n,
    costBasis: 80_000_000n,
    idleUsdc: 10_000_000n,
  };
  const r = composeReport(s, { baseline, actions: [] });
  assert.ok(r.includes("$40.00 withdrawn. Everything still on track."));
  assert.ok(r.includes("$40.00 withdrawn"));
});

test("composeReport names what the agent did and flags drift on an in-band but under-target holding", () => {
  const s = snapshot({
    totalValue: 110_000_000n,
    investedValue: 100_000_000n,
    idleUsdc: 10_000_000n,
    costBasis: 100_000_000n,
    holdings: [
      h("MORPHO", 14_600_000n, 1460n, 1750n), // in-band (within ±5pp) but ~2.9pp under target
      h("cbHYPE", 30_500_000n, 3050n, 3000n),
      h("UNI", 17_900_000n, 1790n, 1750n),
      h("AAVE", 18_000_000n, 1800n, 1750n),
      h("SKY", 17_900_000n, 1790n, 1750n),
    ],
  });
  const r = composeReport(s, {
    baseline: {
      totalValue: 110_000_000n,
      investedValue: 100_000_000n,
      costBasis: 100_000_000n,
      idleUsdc: 10_000_000n,
    },
    actions: [{ symbol: "MORPHO", side: "bought", amount: 35_000_000n }],
  });
  assert.ok(r.includes("bought $35.00 of MORPHO"));
  // MORPHO is in-band but materially under target — the report surfaces the silent drift.
  assert.ok(r.includes("MORPHO"));
  assert.ok(r.includes("slightly under target"));
});

test("composeReport says not invested when holdings are empty", () => {
  const s = snapshot({
    totalValue: 50_000_000n,
    investedValue: 0n,
    idleUsdc: 50_000_000n,
    costBasis: 0n,
    holdings: [],
  });
  const r = composeReport(s, { baseline: null });
  assert.ok(r.includes("Nothing invested yet"));
});

test("composeReport renders the first-report state when there is no baseline", () => {
  const s = snapshot({
    totalValue: 50_000_000n,
    investedValue: 0n,
    idleUsdc: 50_000_000n,
    costBasis: 0n,
    holdings: [],
  });
  assert.ok(composeReport(s, { baseline: null }).includes("waiting for its first deposit"));
});
