import assert from "node:assert/strict";
import { test } from "node:test";
import { registrationGate } from "./registration-fee.js";

// Run with: npx tsx --test packages/cli/src/lib/registration-fee.test.ts
// (the CLI has no wired `test` script — same convention as the SDK's colocated
// tests. Requires `pnpm --filter @sail/sdk build` first so @sail/sdk resolves.)

const TEST_FEE = 10_000_000_000_000n; // 0.00001 ETH per permission

test("registrationGate: discloses fee × N and total before signing", () => {
  const gate = registrationGate({ perPermissionFeeWei: TEST_FEE, permissionCount: 3 });
  assert.equal(gate.totalFeeWei, 30_000_000_000_000n);
  assert.equal(gate.permissionCount, 3);
  assert.equal(gate.disclosure, "Registration fee: 0.00003 ETH (3 permissions × 0.00001 ETH)");
});

test("registrationGate: passes preflight when the agent can pay", () => {
  const gate = registrationGate({
    perPermissionFeeWei: TEST_FEE,
    permissionCount: 2,
    agentBalanceWei: 1_000_000_000_000_000n, // 0.001 ETH — ample
  });
  assert.equal(gate.totalFeeWei, 20_000_000_000_000n);
});

test("registrationGate: rejects (throws) BEFORE signing when balance < total fee", () => {
  // The gate is called before any signature is requested, so an underfunded
  // agent surfaces a clear error rather than a wasted signature / on-chain revert.
  assert.throws(
    () =>
      registrationGate({
        perPermissionFeeWei: TEST_FEE,
        permissionCount: 3,
        agentBalanceWei: 20_000_000_000_000n, // only covers 2 of 3
      }),
    /Insufficient ETH for the 0.00003 ETH registration fee/,
  );
});
