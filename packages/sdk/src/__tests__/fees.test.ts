import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, PublicClient } from "viem";
import {
  RegistrationFeeError,
  assertFeeAffordable,
  describeMandateFee,
  estimateMandateRegistrationFee,
  feeShortfall,
  readPermissionRegistrationFee,
} from "../fees.js";

// Run with: npx tsx --test packages/sdk/src/fees.test.ts

const GOVERNANCE = "0x7A478118715791728BDE3bc7A4D7ECfdEB89C6EC" as Address;
const PERM_A = "0x1111111111111111111111111111111111111111" as Address;
const PERM_B = "0x2222222222222222222222222222222222222222" as Address;
const PERM_C = "0x3333333333333333333333333333333333333333" as Address;

const TEST_FEE = 10_000_000_000_000n; // 0.00001 ETH
const PROD_FEE = 500_000_000_000_000n; // 0.0005 ETH

/**
 * Stub a governance whose flat permissionRegistrationFee() is `fee`. Reading any
 * other (abandoned bytecode-model) view throws — proving the SDK never falls back
 * to a variable formula.
 */
function flatGovernanceClient(fee: bigint): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      assert.equal(functionName, "permissionRegistrationFee");
      return fee;
    },
    // If anything still tried the bytecode model, this would be called; fail loud.
    getBytecode: async () => {
      throw new Error("getBytecode must NOT be used — the fee is flat, not size-based");
    },
  } as unknown as PublicClient;
}

test("readPermissionRegistrationFee: reads the live flat value (not hardcoded)", async () => {
  assert.equal(await readPermissionRegistrationFee(flatGovernanceClient(TEST_FEE), GOVERNANCE), TEST_FEE);
  assert.equal(await readPermissionRegistrationFee(flatGovernanceClient(PROD_FEE), GOVERNANCE), PROD_FEE);
});

test("estimateMandateRegistrationFee: total = flat fee × N, uniform per permission", async () => {
  const est = await estimateMandateRegistrationFee(flatGovernanceClient(TEST_FEE), GOVERNANCE, [
    PERM_A,
    PERM_B,
    PERM_C,
  ]);
  assert.equal(est.totalWei, TEST_FEE * 3n);
  assert.equal(est.perPermission.length, 3);
  // Every permission is charged the SAME flat fee — no bytecode variation.
  for (const p of est.perPermission) assert.equal(p.feeWei, TEST_FEE);
});

test("estimateMandateRegistrationFee: total scales linearly with N (flat model)", async () => {
  const pc = flatGovernanceClient(PROD_FEE);
  assert.equal((await estimateMandateRegistrationFee(pc, GOVERNANCE, [])).totalWei, 0n);
  assert.equal((await estimateMandateRegistrationFee(pc, GOVERNANCE, [PERM_A])).totalWei, PROD_FEE);
  assert.equal(
    (await estimateMandateRegistrationFee(pc, GOVERNANCE, [PERM_A, PERM_B])).totalWei,
    PROD_FEE * 2n,
  );
});

test("describeMandateFee: flat 'N × fee' breakdown", async () => {
  const est = await estimateMandateRegistrationFee(flatGovernanceClient(TEST_FEE), GOVERNANCE, [
    PERM_A,
    PERM_B,
    PERM_C,
  ]);
  assert.equal(describeMandateFee(est), "Registration fee: 0.00003 ETH (3 permissions × 0.00001 ETH)");
});

test("describeMandateFee: singular for one permission", async () => {
  const est = await estimateMandateRegistrationFee(flatGovernanceClient(TEST_FEE), GOVERNANCE, [PERM_A]);
  assert.equal(describeMandateFee(est), "Registration fee: 0.00001 ETH (1 permission × 0.00001 ETH)");
});

test("describeMandateFee: zero permissions does not say 'N × fee'", () => {
  assert.equal(
    describeMandateFee({ totalWei: 0n, perPermission: [] }),
    "Registration fee: 0 ETH (no new permissions to register)",
  );
});

test("describeMandateFee: labels with the passed symbol, not a hardcoded ETH", async () => {
  const est = await estimateMandateRegistrationFee(flatGovernanceClient(TEST_FEE), GOVERNANCE, [
    PERM_A,
    PERM_B,
  ]);
  assert.equal(
    describeMandateFee(est, "BNB"),
    "Registration fee: 0.00002 BNB (2 permissions × 0.00001 BNB)",
  );
  assert.equal(
    describeMandateFee(est, "HYPE"),
    "Registration fee: 0.00002 HYPE (2 permissions × 0.00001 HYPE)",
  );
});

test("assertFeeAffordable: error message uses the passed symbol", () => {
  assert.throws(
    () => assertFeeAffordable(0n, TEST_FEE, "BNB"),
    (err) => err instanceof RegistrationFeeError && /BNB/.test(err.message) && !/ETH/.test(err.message),
  );
});

test("disclosure, preflight, tx value and activity record are ONE number", async () => {
  // The estimate's totalWei is the single value every consumer derives from:
  //  - tx value / activity record use estimate.totalWei directly,
  //  - the disclosure renders it,
  //  - the preflight checks against it.
  const est = await estimateMandateRegistrationFee(flatGovernanceClient(TEST_FEE), GOVERNANCE, [
    PERM_A,
    PERM_B,
  ]);
  const txValue = est.totalWei; // what attachMandate sends and records
  assert.equal(txValue, TEST_FEE * 2n);
  assert.ok(describeMandateFee(est).includes("0.00002 ETH"), "disclosure shows the same total");
  // Preflight passes at exactly the total and fails just below it — same number.
  assert.doesNotThrow(() => assertFeeAffordable(txValue, est.totalWei));
  assert.throws(() => assertFeeAffordable(txValue - 1n, est.totalWei), RegistrationFeeError);
});

test("feeShortfall: 0 when affordable, positive shortfall otherwise", () => {
  assert.equal(feeShortfall(30_000_000_000_000n, 30_000_000_000_000n), 0n);
  assert.equal(feeShortfall(1n, 30_000_000_000_000n), 30_000_000_000_000n - 1n);
});

test("assertFeeAffordable: throws a TYPED RegistrationFeeError when short", () => {
  let caught: unknown;
  try {
    assertFeeAffordable(0n, 30_000_000_000_000n);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof RegistrationFeeError, "must be a RegistrationFeeError instance");
  assert.equal((caught as RegistrationFeeError).requiredWei, 30_000_000_000_000n);
  assert.equal((caught as RegistrationFeeError).balanceWei, 0n);
});
