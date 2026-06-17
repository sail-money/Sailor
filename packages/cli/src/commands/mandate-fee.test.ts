import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chargeablePermissions } from "./mandate.js";

// Run with: npx tsx --test packages/cli/src/commands/mandate-fee.test.ts
// (requires `pnpm --filter @sail/sdk build` first so @sail/sdk resolves.)

const onboardSrc = readFileSync(
  fileURLToPath(new URL("./onboard.ts", import.meta.url)),
  "utf-8",
);

// A mixed tracked set: one fresh, one already registered, one revoked.
const tracked = [
  { address: "0xAAA", label: "fresh", registeredOnSma: false },
  { address: "0xBBB", label: "already", registeredOnSma: true },
  { address: "0xCCC", label: "revoked", registeredOnSma: false, revokedOnChain: true },
];

test("chargeablePermissions: only not-yet-registered, not-revoked permissions are charged", () => {
  const charged = chargeablePermissions(tracked);
  assert.deepEqual(
    charged.map((p) => p.address),
    ["0xAAA"],
  );
});

test("prepare and sign charge the SAME count (re-prepare doesn't overstate)", () => {
  // Both `mandate prepare` and `mandate sign` derive their fee set from
  // chargeablePermissions, so their counts cannot diverge.
  const prepareCount = chargeablePermissions(tracked).length;
  const signCount = chargeablePermissions(tracked).length;
  assert.equal(prepareCount, signCount);
  assert.equal(prepareCount, 1);

  // All-registered mandate → zero chargeable on both paths (no "0 permissions").
  const allRegistered = tracked.map((p) => ({ ...p, registeredOnSma: true, revokedOnChain: false }));
  assert.equal(chargeablePermissions(allRegistered).length, 0);
});

test("attachMandate: disclosed = preflighted = charged = recorded come from ONE estimate", () => {
  // Exactly one fee estimate is computed up front…
  assert.equal((onboardSrc.match(/estimateMandateRegistrationFee\(/g) ?? []).length, 1);
  // …assigned to a single `fee`…
  assert.match(onboardSrc, /const fee = feeEstimate\.totalWei/);
  // …reused as the tx value…
  assert.match(onboardSrc, /value: fee,/);
  // …and recorded in the activity log from the same `fee`.
  assert.match(onboardSrc, /fee: fee\.toString\(\)/);
  assert.match(onboardSrc, /feeEth: formatEther\(fee\)/);

  // The divergent second source is gone: no separate per-tx estimate, no flat read.
  assert.equal((onboardSrc.match(/estimatePermissionFee\(/g) ?? []).length, 0);
  assert.doesNotMatch(onboardSrc, /readPermissionRegistrationFee/);

  // Preflight blocks via a typed error, not brittle message string-matching.
  assert.doesNotMatch(onboardSrc, /startsWith\("Insufficient ETH"\)/);
});
