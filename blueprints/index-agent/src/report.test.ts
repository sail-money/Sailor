/**
 * Tests for the index agent's report composer and snapshot writer.
 *
 * These are pure: no chain, no account, no network. They assert the snapshot
 * math (weights against invested holdings, in-band/buy/sell classification),
 * the cadence gate, the JSON serialization, and the rendered report text.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  type PortfolioSnapshot,
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
  assert.equal(s.costBasis, null);
  assert.equal(s.asOf, 1_700_000_000);
  const weth = s.holdings.find((h) => h.symbol === "WETH");
  assert.ok(weth);
  assert.equal(weth.weightBps, 4000n); // 40% of invested holdings
  assert.equal(weth.targetBps, 4000n);
  assert.equal(weth.status, "in-band");
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
  assert.equal(wbtc.weightBps, 3000n); // 30% vs 60% target
  assert.equal(wbtc.status, "buy");
});

test("writeSnapshot writes bigints as decimal strings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "index-snapshot-test-"));
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
    assert.equal(parsed.holdings[0].value, "40000000");
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("composeReport renders a readable report with unrealized P&L", () => {
  const s: PortfolioSnapshot = {
    totalValue: 150_000_000n,
    investedValue: 100_000_000n,
    idleUsdc: 50_000_000n,
    costBasis: 90_000_000n,
    holdings: [
      { symbol: "WETH", value: 40_000_000n, weightBps: 4000n, targetBps: 4000n, status: "in-band" },
      { symbol: "WBTC", value: 60_000_000n, weightBps: 6000n, targetBps: 6000n, status: "in-band" },
    ],
  };
  const r = composeReport(s, { asOf: "Aug 14, 2026" });
  assert.ok(r.includes("Portfolio value   $150.00"));
  assert.ok(r.includes("Idle USDC         $50.00"));
  assert.ok(r.includes("Unrealized        +$10.00 (+11.11%)"));
  assert.ok(r.includes("WETH   40.0% · target 40.0% · in band"));
  assert.ok(r.includes("All holdings in band. Nothing to rebalance."));
});

test("composeReport names out-of-band holdings", () => {
  const s: PortfolioSnapshot = {
    totalValue: 100_000_000n,
    investedValue: 100_000_000n,
    idleUsdc: 0n,
    costBasis: null,
    holdings: [
      { symbol: "WETH", value: 60_000_000n, weightBps: 6000n, targetBps: 4000n, status: "sell" },
      { symbol: "WBTC", value: 40_000_000n, weightBps: 4000n, targetBps: 6000n, status: "buy" },
    ],
  };
  const r = composeReport(s);
  assert.ok(r.includes("1 over target (sell)"));
  assert.ok(r.includes("1 under target (buy)"));
});

test("composeReport says not invested when holdings are empty", () => {
  const s: PortfolioSnapshot = {
    totalValue: 50_000_000n,
    investedValue: 0n,
    idleUsdc: 50_000_000n,
    costBasis: null,
    holdings: [],
  };
  assert.ok(composeReport(s).includes("Nothing invested yet"));
});
