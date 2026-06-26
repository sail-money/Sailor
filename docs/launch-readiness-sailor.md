# Sailor launch-readiness — gated on the Protocol relaunch

The Octane-hardening batch (Protocol `main`: PRs #52–#59 + #64) changes contract
**addresses**, one kernel **function signature**, and a template EIP-712 **schema**.
None of it is live yet (fresh launch, no deployed accounts), but the Sailor side
must be updated **in lockstep with the relaunch deploy**. This is the consolidated
to-do; items are ordered by blast radius.

## 1. Refresh deployment addresses — `packages/sdk/src/deployments.ts`  (BLOCKER)
PR #64 adds a `_setupEnabler` arg to the `SailKernel` constructor → the **kernel
address changes**, and because `MandateFactory(_kernel)` and
`StandardFeePolicy(..., _kernel, ...)` take the kernel in their constructors, the
**factory and fee-policy addresses move too**. Update the `CREATE2_*` constants
(kernel, mandateFactory, feePolicy) + add the `SafeModuleEnabler` address, per chain,
from the relaunch manifests. Governance/timelock don't depend on the kernel — verify
they're unchanged. Re-confirm the same-address-across-chains property still holds.

## 2. Rework the two-step `registerAccount` onboarding — UI  (BLOCKER, behaviour change)
`OnboardingWizard.jsx` (~L682) sends `registerAccount(permissionSigner, manager,
feePolicy)` (3-arg ABI) **from the owner EOA**. Post-#53 `registerAccount` is
`registerAccount(permissionSigner, manager, feePolicy, feeAsset, deadline, ownerSig)`
and requires: `msg.sender == the Safe` (trusted-proxy codehash), a Safe **owner
signature** over the `RegisterAccount` EIP-712 digest (verified via `checkSignatures`),
`nonce() >= 1`, and the trusted-singleton pin. So the two-step path must:
  1. use the 6-arg ABI;
  2. build the `RegisterAccount` digest and collect the owner signature;
  3. submit via the **Safe's `execTransaction`** (so `msg.sender == Safe`), not the owner EOA.
Prefer the single-tx `createAccount` path wherever possible — it registers via the
internal `_registerAccount` and is unaffected by #53.

## 3. Sync the SDK ABIs to the redeployed contracts — `packages/sdk/src/abis/*`  (BLOCKER)
- `SailKernel.ts`: `registerAccount` → 6-arg (see §2).
- `Context`/`BatchContext` now carry `configEpoch` (#59) — update anywhere the SDK
  encodes/decodes them.
- `MandateFactory` `deployAndAttach` external ABI is unchanged (#58 changed only the
  internal salt) — no ABI edit, but see §5.
- Regenerate against the relaunch build to catch anything else.

## 4. Finish + wire the configure flow — this PR (#172)  (BLOCKER for shared templates)
Shared launch templates need `configure()` to set per-account bounds; post-#59 an
unconfigured template fails `_configCurrent` (epoch guard) → every dispatch denied.
`buildConfigureTypedData` (this PR) is the version-adaptive signer; remaining:
  1. wire an actual configure submission (CLI/UI → `MandateFactory.attach` `configureSig`,
     or `configureDirect`);
  2. add a live-v2 end-to-end test;
  3. take this PR out of draft and merge.

## 5. Re-activate `deploy-clone` when standalone clone templates redeploy  (only if used)
`predictCloneAddress` already uses the 3-arg `(submitter, account, salt)` salt
(merged, Sailor #170) to match Protocol #58. Dormant until standalone clone templates
are redeployed and re-added to `deployments.ts` `standaloneTemplates`. No action unless
that path is part of launch (the launch set is shared multi-tenant).

## 6. Already merged — verify post-relaunch
- `session pause/resume` honour `SAIL_PASSPHRASE` + `--json` (F6).
- chain-aware explorer links / Base Sepolia config (genesis F1/F5).

## 7. Acceptance test (testnet, after §1–§4)
End-to-end: deploy SMA → `registerAccount` via owner-sig + Safe `execTransaction` →
`configure` a shared template (v2 epoch path) → dispatch within bounds → revoke →
confirm a dispatch pre-signed before the revoke is rejected (epoch bump). Run the full
Sailor suite against the relaunch addresses.

---
_Sources: Protocol PRs #52–#59, #64. This file lives on the configure-signer PR so all_
_launch-gated Sailor follow-ups are tracked in one place; remove or move to an issue once_
_the relaunch is complete._
