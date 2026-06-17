import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, PublicClient } from "viem";
import {
  assertRegistrationFeeAffordable,
  describeRegistrationFee,
  readPermissionRegistrationFee,
  registrationFeeShortfall,
  totalRegistrationFee,
} from "./fees.js";

// Run with: npx tsx --test packages/sdk/src/fees.test.ts
// (the SDK's `test` script globs src/**/*.test.ts via tsx --test.)

const GOVERNANCE = "0x7A478118715791728BDE3bc7A4D7ECfdEB89C6EC" as Address;

// Per-permission fees the same code must surface unchanged: the test deployment
// (0.00001 ETH) and a higher prod-like value (0.0005 ETH). Nothing is hardcoded:
// every figure below derives from whatever the chain returns.
const TEST_FEE = 10_000_000_000_000n; // 0.00001 ETH
const PROD_FEE = 500_000_000_000_000n; // 0.0005 ETH

/** Minimal PublicClient stub whose `permissionRegistrationFee` read is fixed. */
function clientReturning(fee: bigint): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      assert.equal(functionName, "permissionRegistrationFee");
      return fee;
    },
  } as unknown as PublicClient;
}

test("totalRegistrationFee: fee × N for several N", () => {
  assert.equal(totalRegistrationFee(TEST_FEE, 0), 0n);
  assert.equal(totalRegistrationFee(TEST_FEE, 1), TEST_FEE);
  assert.equal(totalRegistrationFee(TEST_FEE, 3), 30_000_000_000_000n);
  assert.equal(totalRegistrationFee(TEST_FEE, 5), 50_000_000_000_000n);
  assert.equal(totalRegistrationFee(PROD_FEE, 4), 2_000_000_000_000_000n);
});

test("totalRegistrationFee: rejects invalid counts", () => {
  assert.throws(() => totalRegistrationFee(TEST_FEE, -1), /non-negative integer/);
  assert.throws(() => totalRegistrationFee(TEST_FEE, 1.5), /non-negative integer/);
});

test("describeRegistrationFee: factual cost copy, singular vs plural", () => {
  assert.equal(
    describeRegistrationFee(TEST_FEE, 3),
    "Registration fee: 0.00003 ETH (3 permissions × 0.00001 ETH)",
  );
  assert.equal(
    describeRegistrationFee(TEST_FEE, 1),
    "Registration fee: 0.00001 ETH (1 permission × 0.00001 ETH)",
  );
});

test("readPermissionRegistrationFee: reads the live value, not a constant", async () => {
  // Two different chains return two different fees; the same call surfaces both.
  const testValue = await readPermissionRegistrationFee(clientReturning(TEST_FEE), GOVERNANCE);
  const prodValue = await readPermissionRegistrationFee(clientReturning(PROD_FEE), GOVERNANCE);
  assert.equal(testValue, TEST_FEE);
  assert.equal(prodValue, PROD_FEE);
  assert.notEqual(testValue, prodValue);

  // And both render correctly downstream — proving nothing is hardcoded.
  assert.equal(
    describeRegistrationFee(testValue, 2),
    "Registration fee: 0.00002 ETH (2 permissions × 0.00001 ETH)",
  );
  assert.equal(
    describeRegistrationFee(prodValue, 2),
    "Registration fee: 0.001 ETH (2 permissions × 0.0005 ETH)",
  );
});

test("registrationFeeShortfall: 0 when affordable, positive shortfall otherwise", () => {
  // Exactly enough for 3 permissions.
  assert.equal(registrationFeeShortfall(30_000_000_000_000n, TEST_FEE, 3), 0n);
  // More than enough.
  assert.equal(registrationFeeShortfall(1_000_000_000_000_000n, TEST_FEE, 3), 0n);
  // Short by one permission's worth.
  assert.equal(registrationFeeShortfall(20_000_000_000_000n, TEST_FEE, 3), 10_000_000_000_000n);
});

test("assertRegistrationFeeAffordable: passes when sufficient", () => {
  assert.doesNotThrow(() => assertRegistrationFeeAffordable(30_000_000_000_000n, TEST_FEE, 3));
  assert.doesNotThrow(() => assertRegistrationFeeAffordable(TEST_FEE, TEST_FEE, 1));
});

test("assertRegistrationFeeAffordable: rejects when balance < total fee", () => {
  assert.throws(
    () => assertRegistrationFeeAffordable(0n, TEST_FEE, 3),
    /Insufficient ETH for the 0.00003 ETH registration fee/,
  );
  assert.throws(
    () => assertRegistrationFeeAffordable(20_000_000_000_000n, TEST_FEE, 3),
    /Insufficient ETH for the 0.00003 ETH registration fee/,
  );
});
