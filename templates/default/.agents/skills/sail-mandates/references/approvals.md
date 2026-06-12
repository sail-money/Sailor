# ERC-20 approve coverage

## The rule

Protocol permissions (supply, swap, deposit, stake, …) do NOT cover ERC-20 `approve()`. The kernel evaluates the approve as its own call: an agent that calls `approve()` without authorizing coverage for it is rejected, and the tick fails.

There are two ways to cover and execute an approve + action. Pick ONE; they are not mixable.

## Model A — per-call (default, simplest)

Approve and action are **separate single-call dispatches**, each gated by its own `IPermission`. This is what the scaffolded `IPermission` interface and the `examples/dca/` agent use.

1. Deploy a bounded-approve `IPermission` covering the `(token, spender, max amount)` triple — a clone where available:
   ```bash
   sailor mandate deploy-clone --template boundedApprove --sma <SMA> \
     --tokens <token,...> --spenders <spender,...> --max <amount>
   ```
   or a custom `IPermission` that bounds the approve's spender and amount.
2. Deploy the protocol `IPermission` (swap/supply/…). Attach both in one signing session.
3. At runtime, manage the allowance instead of approving every tick: read the on-chain allowance, emit an approve dispatch ONLY when it is insufficient, approving a large amount so subsequent ticks skip it. The DCA example does exactly this — it returns the approve as its own tick's dispatch, then swaps on later ticks once the allowance is set.

This needs no batch support and works on every kernel.

## Model B — atomic batch (advanced)

Approve + action run as one `dispatchBatch` — atomic, single transaction. A batch dispatch consults **exactly one batch-aware `IBatchPermission`**, never a pair of `IPermission`s:

- The permission implements `@sail/interfaces/IBatchPermission.sol` — `evaluateBatch(Call[] calls, BatchContext ctx)` validates the WHOLE sequence (ordering, the approve's spender/amount, the action, and mandatory allowance cleanup) and `isBatchPermission()` returns true. `examples/permissions/BoundedApproveAndCallBatch.sol` is the model.
- A normal `IPermission` placed in a batch is rejected by the kernel with `PermissionNotBatchAware`. You cannot assemble a batch from two narrow per-call permissions — that was the trap.
- Batch is a **selective-kernel** feature (`dispatchBatch` / `previewBatch`); conjunctive kernels have neither. Confirm the model with `sailor doctor`; details in `docs/PERMISSION_MODEL.md`.
- At runtime, return one `Dispatch` whose `calls` array is `[approveCall, actionCall]`; the runner detects `calls.length > 1` and routes through `dispatch.batch`.

Use Model B only when atomicity genuinely matters (e.g. the approve must not be observable between calls). Otherwise prefer Model A — less contract to author and test.

## Verifying each model

- **Model A:** `sailor mandate simulate` probes each `IPermission`'s single-call `evaluate()`. See `simulate-calls.md`.
- **Model B:** `simulate` does NOT cover batch permissions. Validate the exact `[approve, action]` sequence through the kernel's `previewBatch` view (no gas, no signing) — `sailor run --once` exercises this path against a registered batch permission, or call the permission's `evaluateBatch` view directly with `cast call`.

## Kernel-model corollary (conjunctive only)

On a conjunctive kernel ALL registered permissions must return true on EVERY call, so two narrow approve permissions (one per token) brick each other. Use ONE approve permission allowing all needed tokens. On selective kernels — all currently bundled chains — each dispatch names exactly one permission, so this does not apply.