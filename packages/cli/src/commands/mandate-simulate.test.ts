import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import {
  type CallResult,
  type SimulateMeta,
  buildSimulateJson,
  renderSimulateHuman,
  summarizeResults,
} from "./mandate-simulate.js";

// Run with: npx tsx --test packages/cli/src/commands/mandate-simulate.test.ts
//
// Covers `--summary`: a passing probe set must collapse to counts (no per-probe
// objects for the caller to read back), while any mismatch must still be
// reported in full — that entry is the only one whose detail changes what the
// calling agent does next. Plain `--json` must stay byte-identical.

const TARGET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;

const META: SimulateMeta = {
  chainId: 8453,
  permission: "0x1111111111111111111111111111111111111111" as Address,
  sma: "0x2222222222222222222222222222222222222222" as Address,
  submitter: "0x3333333333333333333333333333333333333333" as Address,
  submitterIsStandIn: false,
  blockNumber: "12345",
  blockContextStale: false,
};

/** One probe outcome; `expect` and the actual result agree unless told otherwise. */
function mkResult(index: number, expect: "pass" | "fail", actual = expect): CallResult {
  return {
    index,
    label: `probe ${index + 1}`,
    target: TARGET,
    value: "0",
    result: actual,
    reverted: false,
    expect,
    match: expect === actual,
    targetHasCode: true,
    selectorRoutes: true,
    selector: "a9059cbb",
  };
}

/** A realistic generated probe set: one must-pass plus a batch of must-fail proofs. */
const ALL_MATCH: CallResult[] = [
  mkResult(0, "pass"),
  ...Array.from({ length: 14 }, (_, i) => mkResult(i + 1, "fail")),
];

/** The same set, except probe 8 was expected to reject the call and did not. */
const WITH_MISMATCH: CallResult[] = ALL_MATCH.map((r) =>
  r.index === 7 ? mkResult(7, "fail", "pass") : r,
);

function captureLines(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test("summarizeResults: counts pass/fail and expectation matches separately", () => {
  const s = summarizeResults(WITH_MISMATCH);
  assert.equal(s.total, 15);
  assert.equal(s.passed, 2, "the must-pass probe plus the one that wrongly passed");
  assert.equal(s.failed, 13);
  assert.equal(s.checked, 15);
  assert.equal(s.matched, 14);
  assert.deepEqual(
    s.mismatches.map((r) => r.index),
    [7],
  );
});

test("--summary --json, all match: counts only, no per-probe entries", () => {
  const payload = buildSimulateJson(ALL_MATCH, META, true) as Record<string, unknown>;
  assert.equal(payload.mode, "summary");
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "ok");
  assert.equal(payload.total, 15);
  assert.equal(payload.passed, 1);
  assert.equal(payload.failed, 14);
  assert.equal(payload.matched, 15);
  assert.equal(payload.checked, 15);
  assert.equal(payload.mismatches, 0);
  assert.deepEqual(payload.results, [], "nothing to read back when everything matched");
  assert.equal(payload.resultsOmitted, 15);

  // The point of the flag: the payload is a fraction of the full one.
  const full = JSON.stringify(buildSimulateJson(ALL_MATCH, META, false));
  assert.ok(
    JSON.stringify(payload).length * 4 < full.length,
    "summary payload should be far smaller than the full one",
  );
});

test("--summary --json, one mismatch: that entry is present in FULL", () => {
  const payload = buildSimulateJson(WITH_MISMATCH, META, true) as Record<string, unknown>;
  assert.equal(payload.ok, false);
  assert.equal(payload.status, "mismatch");
  assert.equal(payload.mismatches, 1);
  assert.equal(payload.resultsOmitted, 14);

  const results = payload.results as Record<string, unknown>[];
  assert.equal(results.length, 1, "only the mismatching probe is emitted");
  const entry = results[0];
  assert.equal(entry.index, 7);
  assert.equal(entry.expect, "fail");
  assert.equal(entry.result, "pass");
  assert.equal(entry.match, false);
  // "In full" means the same per-entry shape as plain --json, field for field.
  const fromFull = (
    (buildSimulateJson(WITH_MISMATCH, META, false) as Record<string, unknown>)
      .results as Record<string, unknown>[]
  ).find((r) => r.index === 7);
  assert.deepEqual(entry, fromFull);
});

test("--json without --summary is unchanged: every probe, no summary fields", () => {
  const payload = buildSimulateJson(WITH_MISMATCH, META, false) as Record<string, unknown>;
  assert.equal((payload.results as unknown[]).length, 15);
  assert.equal(payload.mode, undefined);
  assert.equal(payload.total, undefined);
  assert.equal(payload.resultsOmitted, undefined);
  // The pre-existing envelope is intact.
  assert.equal(payload.status, "mismatch");
  assert.equal(payload.mismatches, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.spendsGas, false);
  assert.equal(payload.chainId, 8453);
  assert.equal(payload.permission, META.permission);
});

test("--summary human, all match: one-line counts, no per-probe detail", () => {
  const lines = captureLines(() => renderSimulateHuman(ALL_MATCH, META, true));
  assert.ok(lines.length <= 2, `expected a short summary, got:\n${lines.join("\n")}`);
  assert.match(lines[0], /15 probe\(s\): 1 pass, 14 fail/);
  assert.match(lines[0], /15\/15 matched/);
  assert.match(lines[1], /No mismatches/);
  assert.ok(!lines.some((l) => /target 0x/.test(l)), "no per-probe target lines");
});

test("--summary human, one mismatch: counts plus that probe's full detail", () => {
  const lines = captureLines(() => renderSimulateHuman(WITH_MISMATCH, META, true));
  const text = lines.join("\n");
  assert.match(text, /15 probe\(s\): 2 pass, 13 fail/);
  assert.match(text, /1 MISMATCH/);
  // The mismatching probe (index 7 → "[8]") is rendered with its detail lines.
  assert.match(text, /\[8\] PASS\s+probe 8\s+expected fail\s+✗ MISMATCH/);
  assert.match(text, new RegExp(`target ${TARGET}`));
  assert.match(text, /selector 0xa9059cbb routes/);
  // …and no other probe is.
  assert.equal(text.match(/target 0x/g)?.length, 1, "only the mismatch gets detail lines");
  assert.ok(!/\[1\] PASS/.test(text), "the matching must-pass probe is not printed");
});
