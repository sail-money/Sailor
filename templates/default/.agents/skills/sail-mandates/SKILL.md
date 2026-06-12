---
name: sail-mandates
description: Author, test, deploy, simulate, and authorize Sail permission contracts (mandates) in the required order, including mandatory bounded-approve coverage for every ERC-20 approval the strategy makes. Use when creating or changing what the agent may do on-chain, or when attaching, revoking, or updating permissions.
---

# Mandate lifecycle (Stage 3)

Strict order. Attaching is the authorization — everything before it is cheap and repeatable; never reach `attach` early.

1. **Bound the strategy.** With the user, pin the exact tokens, amounts, venues, slippage, and recipients. Every bound becomes a constructor parameter or a hardcoded check in the permission.

2. **Enumerate approvals and pick the execution model.** List every ERC-20 `approve()` the strategy will make — protocol permissions never cover `approve()`, so each approval needs its own coverage. How it is covered depends on the model you choose (read `references/approvals.md` before writing any contract):
   - **Per-call (default).** Approve and act are separate single-call dispatches, each gated by its own `IPermission`. Approve a sufficient allowance once and skip it when the on-chain allowance already covers the next action (the `examples/dca/` pattern). This is what the scaffolded `IPermission` supports out of the box.
   - **Atomic batch (advanced).** Approve + action run as one `dispatchBatch`. A batch consults exactly ONE batch-aware `IBatchPermission` (`evaluateBatch`) that validates the whole sequence — NOT two narrow `IPermission`s. Use this only when atomicity matters; see `references/approvals.md`. Do not mix the models.

3. **Author.** Permission contracts live in `mandates/`. A per-call permission implements `@sail/interfaces/IPermission.sol` — `evaluate(txData, ctx)` returns true to permit a dispatch; start from `mandates/BoundedCallPermission.sol`. A batch permission implements `@sail/interfaces/IBatchPermission.sol` — `evaluateBatch(calls, ctx)` plus `isBatchPermission()` returning true; `examples/permissions/BoundedApproveAndCallBatch.sol` is the model. Both interfaces are vendored under `.sail/contracts/interfaces/`. Protocol-specific patterns are in `examples/permissions/`; kernel-model rules (selective vs conjunctive pass-through) in `docs/PERMISSION_MODEL.md`. Configure every bound via the constructor — the deploy flow expects one creation transaction to fully set up the permission.

4. **Build and test.** `forge build`, then write Foundry tests and run `forge test` BEFORE deploying anything. `test/BoundedCallPermission.t.sol` is the scaffolded example — copy it for each permission you author. Derive the cases from the strategy: every call the agent must be able to make (`evaluate` returns true) and every bound it must not cross (returns false). Do not deploy a permission with failing or missing tests.

5. **Deploy — do not attach yet.**
   ```bash
   sailor mandate deploy --contract <Name> --sma <SMA>
   ```
   The owner signs the creation transaction in the browser. Constructor args go via `--args '[...]'` or `--args-file args.json` — shell quoting rules in `references/constructor-args.md`.

6. **Simulate on-chain.** `evaluate()` now exists at a real address; probe it before the irreversible step:
   ```bash
   sailor mandate simulate --address <Name> --sma <SMA> --calls calls.json
   ```
   An off-chain `eth_call` — no gas, no signing. It reports what `evaluate()` returns per sample call and flags any target with no contract code (a wrong or wrong-chain address). The `calls.json` schema and how to design the cases: `references/simulate-calls.md`. Every `expect` must match — a mismatch exits non-zero. Simulate proves what the permission DOES; it does not guarantee the bounds are the right ones.

   `simulate` exercises the single-call `evaluate()` only. A batch-aware `IBatchPermission` is verified through `evaluateBatch` / the kernel's `previewBatch` instead — see `references/approvals.md`.

7. **Attach (authorize).**
   ```bash
   sailor mandate attach --address <Name> --sma <SMA>
   ```
   The owner signs an EIP-712 RegisterPermission in the browser; the CLI rejects the wrong wallet. **Gas: the owner only signs — the agent wallet submits the registration transaction on-chain and pays its gas.** Fund the agent wallet before attaching, or this step fails with `gas required exceeds allowance`. Only attach once forge tests pass AND simulate is clean — and attach every permission the strategy needs (per-call model: the bounded-approve permission alongside the protocol permission) in one signing session, so the strategy is runnable afterwards.

8. **Runtime.** Per-call model — the runner sends one `dispatch.single` per call; emit the approve as its own dispatch only when allowance is insufficient (see `examples/dca/`). Atomic-batch model — return one `Dispatch` whose `calls` array is `[approveCall, actionCall]`; the runner routes it through `dispatchBatch` against the batch permission. The runner chooses single vs batch by the number of calls. See the `sail-transactions` skill.

## Prerequisite — Foundry

`forge build` and `forge test` require the Foundry toolchain. If `forge` is not found:

```bash
curl -L https://foundry.paradigm.xyz | bash   # then restart shell
foundryup
```

## Clone templates — skip authoring for common shapes

`sailor mandate templates` lists deployable templates and community-deployed addresses (availability varies by chain — check `sailor capabilities`). A clone deploys and registers in one owner-signed step:

```bash
sailor mandate deploy-clone --template boundedApprove --sma <SMA> \
  --tokens <addr,...> --spenders <addr,...> --max <amount>
```

## Maintenance

- `sailor mandate list` — permissions deployed/attached from this project
- `sailor mandate update --address <Name>` — fix tracked metadata (name, source path)
- `sailor mandate revoke --address <Name> --sma <SMA>` (or `--all`) — owner-signed removal
