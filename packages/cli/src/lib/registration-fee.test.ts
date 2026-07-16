import assert from "node:assert/strict";
import { test } from "node:test";
import { type MandateFeeEstimate, RegistrationFeeError } from "@sail/sdk";
import type { Address } from "viem";
import { estimateRegistrationGasBudgetWei, registrationGate } from "./registration-fee.js";

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

test("registrationGate: rejects a wallet that covers the fee but not fee + gas (INC-2)", () => {
  const gasBudgetWei = 5_000_000_000_000n;
  let caught: unknown;
  try {
    registrationGate({
      estimate: uniformEstimate(1), // fee = 0.00001 ETH
      agentBalanceWei: 10_000_000_000_000n, // EXACTLY the fee, nothing for gas
      gasBudgetWei,
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof RegistrationFeeError, "a fee-only balance must fail the fee+gas gate");
  assert.equal((caught as RegistrationFeeError).requiredWei, 10_000_000_000_000n + gasBudgetWei);

  // The same balance is fine once it also covers the gas budget.
  assert.doesNotThrow(() =>
    registrationGate({
      estimate: uniformEstimate(1),
      agentBalanceWei: 10_000_000_000_000n + gasBudgetWei,
      gasBudgetWei,
    }),
  );
});

test("estimateRegistrationGasBudgetWei: scales with permission count at the live gas price", async () => {
  const gasPrice = 1_000_000_000n; // 1 gwei
  const client = { getGasPrice: async () => gasPrice };
  const one = await estimateRegistrationGasBudgetWei(client, 1);
  const five = await estimateRegistrationGasBudgetWei(client, 5);
  assert.ok(one > 0n, "a single registration has a non-zero gas budget");
  assert.ok(five > one, "more permissions ⇒ a larger gas budget");
  // Budget is gasUnits × price, so it tracks the price linearly.
  const dearer = { getGasPrice: async () => gasPrice * 3n };
  assert.equal(await estimateRegistrationGasBudgetWei(dearer, 1), one * 3n);
});
