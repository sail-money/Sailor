import assert from "node:assert/strict";
import { test } from "node:test";
import { type MandateFeeEstimate, RegistrationFeeError } from "@sail/sdk";
import type { Address } from "viem";
import { registrationGate } from "./registration-fee.js";

// Run with: npx tsx --test packages/cli/src/lib/registration-fee.test.ts
// (requires `pnpm --filter @sail/sdk build` first so @sail/sdk resolves.)

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const TEST_FEE = 10_000_000_000_000n; // 0.00001 ETH per permission

/** A uniform (flat-governance) estimate for `count` permissions. */
function uniformEstimate(count: number): MandateFeeEstimate {
  const perPermission = Array.from({ length: count }, (_, i) => ({
    permission: i % 2 === 0 ? A : B,
    feeWei: TEST_FEE,
  }));
  return { totalWei: TEST_FEE * BigInt(count), perPermission };
}

test("registrationGate: discloses the summed total and count before signing", () => {
  const gate = registrationGate({ estimate: uniformEstimate(3) });
  assert.equal(gate.totalFeeWei, 30_000_000_000_000n);
  assert.equal(gate.permissionCount, 3);
  assert.equal(gate.disclosure, "Registration fee: 0.00003 ETH (3 permissions × 0.00001 ETH)");
});

test("registrationGate: passes preflight when the agent can pay", () => {
  const gate = registrationGate({
    estimate: uniformEstimate(2),
    agentBalanceWei: 1_000_000_000_000_000n, // ample
  });
  assert.equal(gate.totalFeeWei, 20_000_000_000_000n);
});

test("registrationGate: rejects via a TYPED error BEFORE signing when underfunded", () => {
  let caught;
  try {
    registrationGate({
      estimate: uniformEstimate(3), // needs 0.00003 ETH
      agentBalanceWei: 20_000_000_000_000n, // only covers 2 of 3
    });
  } catch (err) {
    caught = err;
  }
  // Typed, not string-matched — re-wording the message can't disable the block.
  assert.ok(caught instanceof RegistrationFeeError);
  assert.equal(caught.requiredWei, 30_000_000_000_000n);
});

test("registrationGate: discloses the flat fee × N total", () => {
  // Flat model: every permission is charged the same governance scalar.
  const gate = registrationGate({ estimate: uniformEstimate(2) });
  assert.equal(gate.totalFeeWei, 20_000_000_000_000n);
  assert.equal(gate.disclosure, "Registration fee: 0.00002 ETH (2 permissions × 0.00001 ETH)");
});
