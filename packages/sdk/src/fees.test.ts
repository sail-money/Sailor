import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, PublicClient } from "viem";
import {
  RegistrationFeeError,
  assertFeeAffordable,
  describeMandateFee,
  estimateMandateRegistrationFee,
  estimatePermissionFee,
  feeShortfall,
} from "./fees.js";

// Run with: npx tsx --test packages/sdk/src/fees.test.ts
// (the SDK's `test` script globs *.test.ts via tsx --test.)

const GOVERNANCE = "0x7A478118715791728BDE3bc7A4D7ECfdEB89C6EC" as Address;
const PERM_A = "0x1111111111111111111111111111111111111111" as Address;
const PERM_B = "0x2222222222222222222222222222222222222222" as Address;

const TEST_FEE = 10_000_000_000_000n; // 0.00001 ETH
const PROD_FEE = 500_000_000_000_000n; // 0.0005 ETH

/**
 * Stub a PublicClient for a FLAT-fee governance: the legacy views revert, so
 * estimatePermissionFee falls back to the flat permissionRegistrationFee — i.e.
 * every permission is charged `fee`, uniformly.
 */
function flatGovernanceClient(fee: bigint): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "permissionRegistrationFee") return fee;
      throw new Error(`legacy view ${functionName} not present`);
    },
    getBytecode: async () => "0x",
  } as unknown as PublicClient;
}

/**
 * Stub a LEGACY-fee governance: fee = min(baseFee,cap) + min(byteLen*rate,cap),
 * so the per-permission fee VARIES with each permission's bytecode length. Here
 * baseFee=1000, rate=2/byte, cap huge; PERM_A has 1 byte, PERM_B has 10 bytes.
 */
function legacyGovernanceClient(): PublicClient {
  const bytecodeByAddr: Record<string, string> = {
    [PERM_A.toLowerCase()]: "0xaa", // 1 byte
    [PERM_B.toLowerCase()]: "0xaabbccddeeff00112233", // 10 bytes
  };
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "baseFee") return 1000n;
      if (functionName === "complexityRate") return 2n;
      if (functionName === "MAX_PERMISSION_FEE_WEI") return 1_000_000_000_000_000n;
      throw new Error(`unexpected view ${functionName}`);
    },
    getBytecode: async ({ address }: { address: Address }) => bytecodeByAddr[address.toLowerCase()],
  } as unknown as PublicClient;
}

test("estimatePermissionFee: reads the live flat value (not hardcoded)", async () => {
  assert.equal(await estimatePermissionFee(flatGovernanceClient(TEST_FEE), GOVERNANCE, PERM_A), TEST_FEE);
  assert.equal(await estimatePermissionFee(flatGovernanceClient(PROD_FEE), GOVERNANCE, PERM_A), PROD_FEE);
});

test("estimatePermissionFee: legacy model varies per permission bytecode", async () => {
  const pc = legacyGovernanceClient();
  // baseFee 1000 + byteLen*2
  assert.equal(await estimatePermissionFee(pc, GOVERNANCE, PERM_A), 1000n + 1n * 2n);
  assert.equal(await estimatePermissionFee(pc, GOVERNANCE, PERM_B), 1000n + 10n * 2n);
});

test("estimateMandateRegistrationFee: total is the SUM of per-permission charges (flat)", async () => {
  const est = await estimateMandateRegistrationFee(flatGovernanceClient(TEST_FEE), GOVERNANCE, [
    PERM_A,
    PERM_B,
  ]);
  assert.equal(est.totalWei, TEST_FEE * 2n);
  assert.equal(est.perPermission.length, 2);
  assert.equal(est.perPermission[0].feeWei, TEST_FEE);
  assert.equal(est.perPermission[1].feeWei, TEST_FEE);
});

test("estimateMandateRegistrationFee: sums DIFFERING per-permission fees (legacy)", async () => {
  const est = await estimateMandateRegistrationFee(legacyGovernanceClient(), GOVERNANCE, [PERM_A, PERM_B]);
  assert.equal(est.perPermission[0].feeWei, 1002n);
  assert.equal(est.perPermission[1].feeWei, 1020n);
  assert.equal(est.totalWei, 2022n); // NOT a flat value × 2
});

test("describeMandateFee: uniform fees show the N × fee breakdown", async () => {
  const est = await estimateMandateRegistrationFee(flatGovernanceClient(TEST_FEE), GOVERNANCE, [
    PERM_A,
    PERM_B,
    PERM_A,
  ]);
  assert.equal(
    describeMandateFee(est),
    "Registration fee: 0.00003 ETH (3 permissions × 0.00001 ETH)",
  );
});

test("describeMandateFee: non-uniform fees state the true total without a fake rate", async () => {
  const est = await estimateMandateRegistrationFee(legacyGovernanceClient(), GOVERNANCE, [PERM_A, PERM_B]);
  assert.equal(describeMandateFee(est), "Registration fee: 0.000000000000002022 ETH for 2 permissions");
});

test("describeMandateFee: zero permissions does not say 'N × fee'", () => {
  assert.equal(
    describeMandateFee({ totalWei: 0n, perPermission: [] }),
    "Registration fee: 0 ETH (no new permissions to register)",
  );
});

test("feeShortfall: 0 when affordable, positive shortfall otherwise", () => {
  assert.equal(feeShortfall(30_000_000_000_000n, 30_000_000_000_000n), 0n);
  assert.equal(feeShortfall(1n, 30_000_000_000_000n), 30_000_000_000_000n - 1n);
});

test("assertFeeAffordable: passes when sufficient", () => {
  assert.doesNotThrow(() => assertFeeAffordable(30_000_000_000_000n, 30_000_000_000_000n));
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
  // The block must key off the TYPE, not the message wording.
  assert.match((caught as Error).message, /registration fee/i);
});
