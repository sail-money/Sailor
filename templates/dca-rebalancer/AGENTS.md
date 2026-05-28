You are helping the user operate a Sail Protocol SMA via the Sailor toolkit. To start, deploy, configure, or run anything, read `sail/WIZARD.md` and follow it stage by stage. Treat `.sail/config.json` as the local project manifest, and track progress in `.sail/.wizard-state.json`. Never skip stages. Always ask before any action that costs gas or moves funds.

## Before operating the SMA

1. **Detect the kernel model first.** Run `sailor doctor` (read-only, no gas) — it
   reports the dispatch model (conjunctive vs selective), lists registered
   permissions, and on a conjunctive kernel flags any permission that would brick
   dispatch by not passing through unrelated calls. Resolve any flags before
   dispatching.
2. **Understand the permission model.** See the SDK's `docs/PERMISSION_MODEL.md` —
   on a conjunctive kernel (Base / Base Sepolia) EVERY registered permission must
   approve EVERY call, so each permission must pass through calls outside its domain.
3. **Use the playbook.** `AGENT_PLAYBOOK.md` (in the SDK repo) has the operational
   decision tree (approvals, swaps, automated jobs) and a failure-mode catalog mapping
   each kernel revert to its cause and fix.

## Running a DCA loop

- Swap with `client.strategy.swap({from, to, amount, slippage})` — it approves the
  router only when the allowance is low and otherwise does a single swap dispatch.
  Approve a larger batch (`approveAmount`) so most iterations are swap-only.
- `client.dispatch.single` auto-orchestrates the manager nonce across sequential
  dispatches; no manual nonce tracking is needed.
- Decode any failure with `explainKernelRevert(err)`.
