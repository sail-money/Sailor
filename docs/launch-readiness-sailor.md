# Sailor launch-readiness — gated on the Protocol relaunch

The Octane-hardening batch (Protocol `main`: PRs #52–#59, #64, #69–#71) changes contract
**addresses**, one kernel **function signature**, and a template EIP-712 **schema**.
None of it is live yet (fresh launch, no deployed accounts), but the Sailor side
must be updated **in lockstep with the relaunch deploy**. This is the consolidated
to-do; items are ordered by blast radius.

## 1. Refresh deployment addresses — `packages/sdk/src/deployments.ts`  ✅ DONE
PR #64 adds a `_setupEnabler` arg to the `SailKernel` constructor → the **kernel
address changes**, and because `MandateFactory(_kernel)` and
`StandardFeePolicy(..., _kernel, ...)` take the kernel in their constructors, the
**factory and fee-policy addresses move too**. Update the `CREATE2_*` constants
(kernel, mandateFactory, feePolicy) + add the `SafeModuleEnabler` address, per chain,
from the relaunch manifests. Governance/timelock don't depend on the kernel — verify
they're unchanged. Re-confirm the same-address-across-chains property still holds.

**Done:** `deployments.ts` refreshed to the final relaunch manifests (CREATE2 global salt,
factory `0x4e59…4956C`). Kernel `0x38b5…A6ED`, MandateFactory `0x6d2C…B8Fc`, StandardFeePolicy
`0x1087…A04b`, SafeModuleEnabler `0x7897…fE1F`, Governance `0x4315…4356`, Timelock `0xC1E5…A7b6`
— all identical on every chain. Treasury (`0x7b37…872f`) split out from the deployer EOA
(`0xB01d…15B6`). Coverage expanded to all **11** launch chains (added Optimism, BSC, World,
HyperEVM, MegaETH). The seven shared templates are populated in each chain's `knownTemplates`.

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
**#69 constraint on the `ownerSig`:** the kernel now rejects the Safe `v==1`
approved-hash shortcut (`ApprovedHashSignatureNotAllowed`). Build the `ownerSig` as a
real **EOA ECDSA** signature over the digest, or — for contract / nested-Safe owners —
the Safe **`v==0`** contract-signature path, for which `checkSignatures` is given the
EIP-712 preimage (`0x1901 ‖ domainSeparator ‖ structHash`) as `data`. Do **not** use
`buildApprovedHashSignature` for this `ownerSig`. (Its existing use in
`buildSetManagerExecTransaction` — a Safe `execTransaction` signature, not the kernel
`checkSignatures` arg — is unaffected.)

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
Dormant until standalone clone templates are redeployed and re-added to
`deployments.ts` `standaloneTemplates`. No action unless that path is part of launch
(the launch set is shared multi-tenant). **Before re-enabling**, the local
`predictCloneAddress` mirror at `packages/cli/src/commands/mandate-contracts.ts:430`
(called ~:572) must be corrected to match the on-chain salt:
- **#71** changed the salt to `keccak256(abi.encode(msg.sender, account, salt,
  keccak256(initData)))` — the mirror must fold `keccak256(initData)` too, or it will
  predict the wrong clone address and `registerPermission` will fail.
- Fix the pre-existing field-count divergence in the same mirror at the same time, and
  thread `initData` through the call site (:572) and any SDK helper.
The kernel ABI is unchanged by #71 (the salt lives entirely in the untrusted factory),
so no SDK ABI edit is required — only the address-prediction mirror.

## 5b. Read signer nonces just-in-time after a revoke  (#70 — verify, likely already OK)
`revokeSession` now advances `signerNonces` by a full **epoch** (`nonce + 1 +
NONCE_EPOCH_INCREMENT`), not `+1`, so the kill switch invalidates any signer op
pre-signed before the revoke. Signer ops verify the nonce by **exact equality**, so the
SDK/CLI must read `signerNonces[account]` **fresh on-chain immediately before signing**
each signer op (RevokeSession/ActivateSession/RegisterPermission/etc.) and never cache or
precompute "current + 1". Confirm the signer-op builders read live nonce; this is the
expected pattern already, so this is a verification item, not a known break.

## 6. Already merged — verify post-relaunch
- `session pause/resume` honour `SAIL_PASSPHRASE` + `--json` (F6).
- chain-aware explorer links / Base Sepolia config (genesis F1/F5).

## 7. Acceptance test (testnet, after §1–§4)
End-to-end: deploy SMA → `registerAccount` via owner-sig + Safe `execTransaction` →
`configure` a shared template (v2 epoch path) → dispatch within bounds → `revokeSession`
→ confirm both a **dispatch** and an **`ActivateSession`** pre-signed before the revoke
are rejected (manager/batch + signer epoch bumps, #70) → re-activate by signing the
fresh signer nonce. If the registerAccount rework (§2) is in scope, also assert an
`ownerSig` built as a `v==1` approved-hash is rejected (#69) while an ECDSA owner sig
succeeds. Run the full Sailor suite against the relaunch addresses.

---
_Sources: Protocol PRs #52–#59, #64, #69–#71. This file lives on the configure-signer PR so all_
_launch-gated Sailor follow-ups are tracked in one place; remove or move to an issue once_
_the relaunch is complete._
