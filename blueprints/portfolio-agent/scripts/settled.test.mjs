// Tests for scripts/settled.mjs — the "is the portfolio settled?" decision, on in-memory
// ledger entries. Run directly with `node --test scripts/settled.test.mjs`; `npm test` picks
// them up through src/settled.test.ts.
import assert from "node:assert/strict";
import test from "node:test";
import { settledReasons } from "./settled.mjs";

const skipped = (ts = 100) => ({ ts, kind: "skipped", reason: "nothing actionable" });
const TX = `0x${"ab".repeat(32)}`;
const TX2 = `0x${"cd".repeat(32)}`;

test("a quiet tick with nothing in flight is settled", () => {
  assert.deepEqual(settledReasons([skipped()]), []);
});

test("no ledger at all is not settled", () => {
  assert.deepEqual(settledReasons([]), ["no ledger yet"]);
});

test("a last entry that is a dispatch is not settled; `reported` is not a dispatch", () => {
  assert.deepEqual(settledReasons([skipped(), { ts: 101, kind: "reported" }]), []);
  const r = settledReasons([
    skipped(),
    { ts: 101, kind: "trade", id: "op-2", side: "buy", symbol: "WETH" },
  ]);
  assert.ok(r.some((x) => x.startsWith("last tick dispatched (trade)")));
});

test("fresh runner outcomes since the tick started keep it pending (approve-only tick)", () => {
  const r = settledReasons([skipped()], ['{"type":"dispatch_executed","target":"0x1"}']);
  assert.deepEqual(r, ["1 dispatch(es) this tick"]);
  assert.deepEqual(settledReasons([skipped()], ['{"type":"tick_started"}']), []);
});

test("a CCTP burn is in flight until its txHash is minted", () => {
  const bridged = {
    ts: 10,
    kind: "bridged",
    via: "cctp",
    dest: 42161,
    amount: "175000000",
    txHash: TX,
  };
  assert.deepEqual(settledReasons([bridged, skipped(20)]), [
    "bridge of 175 USDC to chain 42161 not minted yet",
  ]);
  // A mint for a DIFFERENT burn to the same chain does not settle it (txHash is the key).
  assert.equal(
    settledReasons([bridged, { ts: 15, kind: "minted", dest: 42161, txHash: TX2 }, skipped(20)])
      .length,
    1,
  );
  assert.deepEqual(
    settledReasons([bridged, { ts: 15, kind: "minted", dest: 42161, txHash: TX }, skipped(20)]),
    [],
  );
});

test("a legacy CCTP burn without a txHash settles by the latest mint to its destination", () => {
  const legacy = { ts: 10, kind: "bridged", dest: 42161, amount: "50000000" };
  assert.equal(settledReasons([legacy, skipped(20)]).length, 1);
  assert.deepEqual(
    settledReasons([legacy, { ts: 15, kind: "minted", dest: 42161 }, skipped(20)]),
    [],
  );
});

test("an Across deposit is in flight until a `filled` entry for it exists", () => {
  const dep = {
    ts: 10,
    kind: "bridged",
    via: "across",
    source: 8453,
    dest: 4663,
    amount: "200000000",
    target: "0xspoke",
    txHash: TX,
  };
  assert.deepEqual(settledReasons([dep, skipped(20)]), [
    "across deposit of 200 to chain 4663 not filled yet",
  ]);
  // A CCTP mint to the same destination says nothing about an Across deposit.
  assert.equal(
    settledReasons([dep, { ts: 15, kind: "minted", dest: 4663, txHash: TX2 }, skipped(20)]).length,
    1,
  );
  const filled = {
    ts: 15,
    kind: "filled",
    via: "across",
    source: 8453,
    dest: 4663,
    amount: "200000000",
    depositId: "7",
    txHash: TX,
    fillTxHash: TX2,
  };
  assert.deepEqual(settledReasons([dep, filled, skipped(20)]), []);
});

test("an expired Across deposit settles once it is recorded as refunded", () => {
  const dep = {
    ts: 10,
    kind: "bridged",
    via: "across",
    source: 8453,
    dest: 4663,
    amount: "200000000",
    txHash: TX,
  };
  const refunded = {
    ts: 15,
    kind: "bridgeRefunded",
    via: "across",
    source: 8453,
    dest: 4663,
    amount: "200000000",
    depositId: "7",
    txHash: TX,
  };
  assert.deepEqual(settledReasons([dep, refunded, skipped(20)]), []);
});

test("unconfirmed swap and bridge intents keep the run pending until resolved", () => {
  const trade = { ts: 10, kind: "trade", id: "op-1", side: "buy", symbol: "WETH" };
  const bridge = { ts: 11, kind: "bridge", id: "op-2", via: "across", dest: 4663 };
  const r = settledReasons([trade, bridge, skipped(20)]);
  assert.ok(r.includes("buy WETH awaiting confirmation"));
  assert.ok(r.includes("bridge to chain 4663 awaiting confirmation"));
  const done = [
    trade,
    bridge,
    { ts: 12, kind: "bought", id: "op-1", symbol: "WETH", txHash: TX },
    { ts: 13, kind: "bridgeFailed", id: "op-2", dest: 4663, txHash: TX2 },
    skipped(20),
  ];
  assert.deepEqual(settledReasons(done), []);
});
