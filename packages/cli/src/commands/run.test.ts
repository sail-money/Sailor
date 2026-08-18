import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress } from "viem";
import { type StrategyRunFailure, assertDispatchChainAllowed, assertNoStrategyFailures, runtimeActivityEvent } from "./run.js";

const SAFE = getAddress("0x00000000000000000000000000000000000000AA");

test("runtimeActivityEvent pins activity to the executing SMA, chain, and strategy", () => {
  const event = runtimeActivityEvent(
    {
      type: "dispatch_executed",
      safe: "0x00000000000000000000000000000000000000BB",
      chainId: 1,
      strategy: "wrong",
    },
    SAFE,
    8453,
    "dcaBase",
  );

  assert.deepEqual(event, {
    type: "dispatch_executed",
    safe: SAFE,
    chainId: 8453,
    strategy: "dcaBase",
  });
});

test("assertDispatchChainAllowed rejects a tag outside the run filter", () => {
  assert.doesNotThrow(() => assertDispatchChainAllowed(8453, [8453, 42161], SAFE));
  assert.throws(
    () => assertDispatchChainAllowed(10, [8453, 42161], SAFE),
    /outside SMA .* runnable set: 8453, 42161/,
  );
});

test("assertNoStrategyFailures leaves a successful --once cycle alone", () => {
  assert.doesNotThrow(() => assertNoStrategyFailures([]));
});

test("assertNoStrategyFailures makes --once surface every fatal strategy error", () => {
  const failures: StrategyRunFailure[] = [
    { strategy: "dcaBase", error: new Error("executable missing") },
    { strategy: "yieldArb", error: new Error("runtime unavailable") },
  ];

  assert.throws(
    () => assertNoStrategyFailures(failures),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(
        error.errors.map((e: Error) => e.message),
        ["executable missing", "runtime unavailable"],
      );
      assert.match(error.message, /2 strategy execution\(s\) failed/);
      assert.match(error.message, /dcaBase: executable missing/);
      assert.match(error.message, /yieldArb: runtime unavailable/);
      return true;
    },
  );
});
