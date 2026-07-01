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

> **Done:** §2, §3, §5b landed on this branch; §4 SDK path wired (live-v2 e2e + take-out-of-draft
> pending). §1 addresses landed earlier. Remaining before merge: §4 step 2–3, §7 testnet acceptance.

## 2. Rework the two-step `registerAccount` onboarding — UI  ✅ DONE (needs §7 testnet run)
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

**Done:** SDK adds `buildRegisterAccountTypedData` (kernel digest) and
`buildRegisterAccountExecTransaction` (wraps the 6-arg `registerAccount` in the Safe's
`execTransaction`; ownerSig is a real ECDSA sig, the execTransaction is authorised by the
sole-owner pre-validated blob — the two signatures kept distinct per #69). `OnboardingWizard.jsx`
two-step path rewired: owner signs the RegisterAccount digest, then submits via the Safe. Unit
tests cover both builders (18/18). Not yet exercised on a live chain — see §7.

## 3. Sync the SDK ABIs to the redeployed contracts — `packages/sdk/src/abis/*`  ✅ DONE
- `SailKernel.ts`: `registerAccount` → 6-arg. **Done.**
- `Context`/`BatchContext` carry `configEpoch` (#59): the kernel builds Context internally and
  passes it to permissions via staticcall — it is **never** an SDK-encoded argument or part of any
  signed digest, so there is nothing to update in the SDK ABIs. Verified against `dispatch`/
  `dispatchBatch` (no Context tuple arg) and `IPermission.Context` (read-only freshness tag).
- `MandateFactory` `deployAndAttach` external ABI unchanged (#58 changed only the internal salt).
- Regenerate against the relaunch build to catch anything else. (pending relaunch build)

## 4. Finish + wire the configure flow — this PR (#172)  (SDK wired; e2e pending)
Shared launch templates need `configure()` to set per-account bounds; post-#59 an
unconfigured template fails `_configCurrent` (epoch guard) → every dispatch denied.
`buildConfigureTypedData` (this PR) is the version-adaptive signer; remaining:
  1. ~~wire an actual configure submission~~ — **Done:** `SailorClient.mandate.reconfigure`
     encodes params, reads `configNonces` fresh, signs the v1/v2 Configure struct, and submits
     `template.configure(account, params, deadline, sig)`.
  2. add a live-v2 end-to-end test; (pending a deployed v2 template — unit branches covered)
  3. take this PR out of draft and merge. (pending §4.2 + §7)

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

**Verified:** the signer-op builder (`mandate.attachBatch`) reads `signerNonces[account]` fresh
via `readContract` immediately before signing (no caching / no precompute). New
`mandate.reconfigure` follows the same pattern for the template `configNonces`. OK, no change.

## 6. Already merged — verify post-relaunch
- `session pause/resume` honour `SAIL_PASSPHRASE` + `--json` (F6).
- chain-aware explorer links / Base Sepolia config (genesis F1/F5).

## 7. Acceptance test (testnet, after §1–§4)  ✅ PASSED on Base Sepolia (7/7)

**Live result (Base Sepolia, kernel `0x38b5…A6ED`):** createAccount ✓ · registerAccount via
owner-sig + `Safe.execTransaction` ✓ · #69 approved-hash ownerSig rejected ✓ · session
revoke → `active=false` ✓ · #70 signer-nonce epoch bump (`0 → 2¹²⁸+1`) ✓ · re-activate ✓.
Phase 3 (configure) is operator-set — supply the template params encoder to include it.

This run also surfaced and fixed: `session.revoke`/`activate`/`status` were `notImplemented()`
(now implemented, signer-op EIP-712 + JIT signer-nonce, awaiting receipt); and the SDK `configs`
ABI was missing `feeAsset` (a 5th field) — corrected, with the CLI consumers updated.


End-to-end: deploy SMA → `registerAccount` via owner-sig + Safe `execTransaction` →
`configure` a shared template (v2 epoch path) → dispatch within bounds → `revokeSession`
→ confirm a **dispatch** pre-signed with the pre-revoke nonce is rejected (manager/batch +
signer epoch bumps, #70) → re-activate. Also assert an `ownerSig` built as a `v==1`
approved-hash is rejected (#69) while an ECDSA owner sig succeeds.

**Harness:** `packages/sdk/e2e-acceptance.mjs` implements this sequence against the bundled
deployment registry (no hardcoded addresses). Build the SDK, then run with a funded key:

```bash
pnpm --filter @sail/sdk build
cd packages/sdk
CHAIN_ID=84532 RPC_URL=<testnet rpc> DEPLOYER_PRIVATE_KEY=0x<funded key> node e2e-acceptance.mjs
```

Phases 1 (createAccount), 2 (registerAccount-via-execTransaction + #69 guard), 4 (revoke →
stale-nonce rejection → re-activate) run against live SDK methods. **Phase 3 (configure) needs
one wiring step**: supply the params encoder that matches the deployed template's `configure()`
ABI for the chosen `knownTemplates` entry — left explicit in the harness so the operator sets
the exact bounds under test. Once a funded run passes, take PR #172 fully ready and merge.

---
_Sources: Protocol PRs #52–#59, #64, #69–#71. This file lives on the configure-signer PR so all_
_launch-gated Sailor follow-ups are tracked in one place; remove or move to an issue once_
_the relaunch is complete._
