import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress } from "viem";
import { type StrategyRunFailure, assertNoStrategyFailures, runtimeActivityEvent } from "./run.js";

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
      assert.match(error.message, /2 strategy execution\(s\) failed/);
      assert.match(error.message, /dcaBase: executable missing/);
      assert.match(error.message, /yieldArb: runtime unavailable/);
      return true;
    },
  );
});
