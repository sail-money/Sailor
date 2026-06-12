---
name: sail-transactions
description: Build and submit EVM transactions through the Sail SMA — agent dispatches, approve-plus-action batching, and owner signing events relayed through the signing station. Use when sending on-chain calls, when a CLI command waits for a browser signature, when running the agent, or when writing a custom runner.
---

# Transactions and signing

Two signature paths, never mixed:

| Path | Key | Where it signs | When |
|---|---|---|---|
| Owner actions | Owner wallet | Browser only, via the signing station | SMA deployment, permission registration and revocation |
| Agent dispatches | Agent wallet (`.sail/keys/manager.json`) | Locally, unlocked by passphrase or `SAIL_PASSPHRASE` | Every strategy transaction, within the signed mandate |

**Signing is not paying.** The owner *signs* the EIP-712 authorization for registration/revocation, but the **agent wallet submits the on-chain transaction and pays its gas** — for SMA deployment, `mandate deploy`, and `mandate attach`/`revoke` alike. So the agent wallet needs gas during *setup*, not only once the agent is running. A `gas required exceeds allowance` error on attach means the agent wallet is unfunded, not the owner.

## Owner signing events

These commands block until the owner approves in the browser (station details: `sail-servers` skill):

- `sailor account create`, `sailor account deploy-chain` — SMA deployment
- `sailor mandate deploy`, `sailor mandate deploy-clone` — permission contract creation
- `sailor mandate attach`, `sailor mandate revoke` — EIP-712 RegisterPermission / RevokePermissions
- `sailor onboard` — chains the steps above
- `sailor owner connect` — wallet connection only, no transaction

While one is pending, tell the user which wallet to connect and exactly what they are approving. The CLI rejects signatures from the wrong wallet. Never work around a signing step.

## Agent dispatches

Once the mandate is signed, dispatches need no per-transaction confirmation — the mandate is the authorization.

```bash
sailor run --once      # single tick — verify before automating
sailor run             # continuous loop
sailor session pause   # temporarily revoke dispatch rights
sailor session resume
```

The runner loads the agent from `src/agent.ts` (one `Dispatch[]` per tick), detects the kernel's dispatch model on-chain, routes each dispatch through a registered permission, signs with the agent wallet, and appends to the activity log under `.sail/`.

## Building calls — single vs batch

The runner decides by the number of calls in a `Dispatch`:

- **One call** → `dispatch.single`. The runner probes each registered `IPermission`'s `evaluate()` and uses the first that accepts the call.
- **Multiple calls** → `dispatch.batch` → kernel `dispatchBatch`. The runner finds a registered batch-aware `IBatchPermission` whose `evaluateBatch` accepts the whole sequence (validated first via `previewBatch`).

So an approve + action either runs as **two single dispatches** (default — approve only when allowance is insufficient, the `examples/dca/` pattern) or as **one batched `Dispatch` with `[approveCall, actionCall]`** authorized by a single `IBatchPermission`. These are two different mandate models — a normal `IPermission` cannot authorize a batch (`PermissionNotBatchAware`). Choose per the `sail-mandates` skill and `../sail-mandates/references/approvals.md`; do not mix them.

Batch is a selective-kernel feature; conjunctive kernels have no `dispatchBatch` and require ALL registered permissions to pass every call — see `docs/PERMISSION_MODEL.md`.

## Custom runners

Use `buildDispatchSignature` from `@sail.money/sdk` — it reads the on-chain `DISPATCH_TYPEHASH` and builds the correct typed data for the detected model. Never hand-roll the EIP-712 struct; never hardcode the dispatch model.

## Rotating the agent wallet

`sailor account rotate-signer` rotates the delegated signer (Safe-gated, owner-approved) and re-approves existing mandates; `--generate` mints a fresh key in one step.
