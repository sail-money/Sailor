import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchGasLimit } from "../client.js";

test("dispatchGasLimit: the estimate with a 30% margin", async () => {
  const gas = await dispatchGasLimit(async () => 148_080n);
  assert.equal(gas, 192_504n);
});

test("dispatchGasLimit: integer math never rounds below the estimate", async () => {
  for (const estimate of [1n, 7n, 21_000n, 999_999n]) {
    const gas = await dispatchGasLimit(async () => estimate);
    assert.ok(gas >= estimate, `${gas} < ${estimate}`);
    assert.ok(gas <= (estimate * 13n) / 10n + 1n);
  }
});

test("dispatchGasLimit: a throwing estimate falls back to the 2,000,000 pin", async () => {
  const gas = await dispatchGasLimit(async () => {
    throw new Error("execution reverted: InvalidManagerSignature");
  });
  assert.equal(gas, 2_000_000n);
});

test("dispatchGasLimit: a synchronous throw inside the estimate also falls back", async () => {
  const gas = await dispatchGasLimit(() => {
    throw new Error("rpc unreachable");
  });
  assert.equal(gas, 2_000_000n);
});
