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
2. Deploy the protocol `IPermission` (swap/supply/…). Register both in one signing session.
3. At runtime, manage the allowance instead of approving every tick: read the on-chain allowance, emit an approve dispatch ONLY when it is insufficient, approving a large amount so subsequent ticks skip it. The DCA example does exactly this — it returns the approve as its own tick's dispatch, then swaps on later ticks once the allowance is set.

This needs no batch support and works on every kernel.

## Model B — atomic batch (advanced)

Approve + action run as one `dispatchBatch` — atomic, single transaction. A batch dispatch consults **exactly one batch-aware `IBatchPermission`**, never a pair of `IPermission`s:

- The permission implements `@sail/interfaces/IBatchPermission.sol` — `evaluateBatch(Call[] calls, BatchContext ctx)` validates the WHOLE sequence (ordering, the approve's spender/amount, the action, and mandatory allowance cleanup) and `isBatchPermission()` returns true. **For the canonical `approve → swap/deposit/supply → reset` shape, a shared `ApproveAndCallBatchPermission` singleton is deployed** on Base, Arbitrum, Unichain, Sepolia, and Base Sepolia (resolve it with `node scripts/shared-template-addr.mjs ApproveAndCallBatchPermission`) — reuse it via `register` + `configure` rather than authoring one. `examples/permissions/BoundedApproveAndCallBatch.sol` remains the model for a non-standard shape you must author yourself.
- A normal `IPermission` placed in a batch is rejected by the kernel with `PermissionNotBatchAware`. You cannot assemble a batch from two narrow per-call permissions — that was the trap.
- Batch is a **selective-kernel** feature (`dispatchBatch` / `previewBatch`); conjunctive kernels have neither. Confirm the model with `sailor doctor`; details in `docs/PERMISSION_MODEL.md`.
- At runtime, return one `Dispatch` whose `calls` array is the batch. The shared `ApproveAndCallBatchPermission` requires **exactly** `[approve(spender, amount), action, approve(spender, 0)]` — the trailing reset to zero is mandatory, and the pre-batch allowance on that `(token, spender)` pair must already be zero (so never combine it with a standing approve). The runner detects `calls.length > 1` and routes through `dispatch.batch`.

**For autonomous recurring actions (a DCA or rebalancer the agent runs on its own), Model B is the default — not an advanced option.** Model A's separate approve dispatch needs the owner back in the loop every time the bounded allowance runs out, which a recurring agent cannot do; on the first tick after the allowance is consumed it stalls (or, in a simulation, is tempted to cheat the allowance in). Reach for Model A when the owner is genuinely in the loop per action anyway. For bounded swaps specifically, [`sail-template-swap`'s "Approve coverage"](../../sail-template-swap/SKILL.md) works through the choice with concrete addresses.

## Verifying each model

- **Model A:** `sailor mandate simulate` probes each `IPermission`'s single-call `evaluate()`. See `simulate-calls.md`.
- **Model B:** `simulate` does NOT cover batch permissions. Validate the exact `[approve, action]` sequence through the kernel's `previewBatch` view (no gas, no signing) — `sailor run --once` exercises this path against a registered batch permission, or call the permission's `evaluateBatch` view directly with `cast call`.

## Kernel-model corollary (conjunctive only)

On a conjunctive kernel ALL registered permissions must return true on EVERY call, so two narrow approve permissions (one per token) brick each other. Use ONE approve permission allowing all needed tokens. On selective kernels — all currently bundled chains — each dispatch names exactly one permission, so this does not apply.