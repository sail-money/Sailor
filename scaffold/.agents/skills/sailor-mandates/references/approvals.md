# ERC-20 approve coverage

## The rule

Protocol permissions (supply, swap, deposit, stake, repay, …) do NOT cover ERC-20 `approve()`. The kernel evaluates the approve as its own call: an agent that calls `approve()` without authorizing coverage for it is rejected, and the tick fails. This is not specific to any one action kind — **any call whose selector pulls an ERC-20 from the SMA via `transferFrom` needs its own approve covered**, whether or not a shared template exists for the action itself. Deposit, swap, and a borrow position's repay leg all pull via allowance; `borrow()` and `withdraw()`/`transfer()` do not (they push funds *to* the SMA, or move tokens the SMA already unconditionally owns) — check the venue's own calldata, don't assume from the action's category.

**Repay has no shared template today.** Unlike deposit/swap/borrow, there is no `RepayPermission` singleton in `Protocol/contracts/templates/` — a borrow/looping strategy's unwind leg is bespoke via [`sailor-mandates`](../SKILL.md) (Gate 2 still applies: enumerate the repay's approve need and pick a model before authoring). Do not assume `sailor-template-borrow` or `sailor-template-deposit` cover it; neither does.

There are two ways to cover and execute an approve + action. Pick ONE; they are not mixable.

## Model A — per-call (default, simplest)

Approve and action are **separate single-call dispatches**, each gated by its own `IPermission`. This is what the scaffolded `IPermission` interface and the `sailor-agent-build` skeleton use.

1. Deploy a bounded-approve `IPermission` covering the `(token, spender, max amount)` triple — a clone where available:
   ```bash
   sailor mandate deploy-clone --template boundedApprove --sma <SMA> \
     --tokens <token,...> --spenders <spender,...> --max <amount>
   ```
   or a custom `IPermission` that bounds the approve's spender and amount.

   > **⚠️ `boundedApprove` is not deployed on any chain today — this command currently errors.**
   > `deploy-clone` only works against a clone *implementation* already recorded in the SDK's
   > `standaloneTemplates` registry, and no `boundedApprove` implementation has been published
   > there yet (verify live with `sailor mandate templates --json` — an empty `community` array
   > confirms it). Running the command above fails with `deploy-clone is unavailable on chain
   > <id>: no clone templates are deployed against this kernel`. Until a `boundedApprove`
   > implementation ships, use a custom `IPermission` deployed directly with `sailor mandate
   > deploy` instead — same bound (token/spender/max-amount), just not a reusable clone. This
   > does not block Model A generally, only the "clone where available" shortcut in this step.
2. Deploy the protocol `IPermission` (swap/supply/…). Register both in one signing session.
3. At runtime, manage the allowance instead of approving every tick: read the on-chain allowance, emit an approve dispatch ONLY when it is insufficient, approving a large amount so subsequent ticks skip it. The DCA example does exactly this — it returns the approve as its own tick's dispatch, then swaps on later ticks once the allowance is set.

This needs no batch support and works on every kernel.

## Model B — atomic batch (advanced)

Approve + action run as one `dispatchBatch` — atomic, single transaction. A batch dispatch consults **exactly one batch-aware `IBatchPermission`**, never a pair of `IPermission`s:

- The permission implements `@sail/interfaces/IBatchPermission.sol` — `evaluateBatch(Call[] calls, BatchContext ctx)` validates the WHOLE sequence (ordering, the approve's spender/amount, the action, and mandatory allowance cleanup) and `isBatchPermission()` returns true. **For the canonical `approve → swap/deposit/supply → reset` shape, a shared `ApproveAndCallBatchPermission` singleton is deployed on every supported chain** (per `sailor-templates/deployed.json` — resolve it with `node scripts/shared-template-addr.mjs ApproveAndCallBatchPermission`) — reuse it via `register` + `configure` rather than authoring one. For a non-standard shape you must author yourself, extend the `contracts/` scaffold — see [references/authoring-patterns.md](authoring-patterns.md) for the batch-permission gotchas (fund-destination binding, amount-match offset correctness, and simulate's single-call-only coverage).
- A normal `IPermission` placed in a batch is rejected by the kernel with `PermissionNotBatchAware`. You cannot assemble a batch from two narrow per-call permissions — that was the trap.
- Batch is a **selective-kernel** feature (`dispatchBatch` / `previewBatch`); conjunctive kernels have neither. Confirm the model with `sailor doctor`; details in `docs/PERMISSION_MODEL.md`.
- At runtime, return one `Dispatch` whose `calls` array is the batch. The shared `ApproveAndCallBatchPermission` requires **exactly** `[approve(spender, amount), action, approve(spender, 0)]` — the trailing reset to zero is mandatory, and the pre-batch allowance on that `(token, spender)` pair must already be zero (so never combine it with a standing approve). The runner detects `calls.length > 1` and routes through `dispatch.batch`.

**For autonomous recurring actions (a DCA or rebalancer the agent runs on its own), Model B is the default — not an advanced option — for every action EXCEPT swaps.** Model A's separate approve dispatch needs the owner back in the loop every time the bounded allowance runs out, which a recurring agent cannot do; on the first tick after the allowance is consumed it stalls (or, in a simulation, is tempted to cheat the allowance in). Reach for Model A when the owner is genuinely in the loop per action anyway. **Swaps are the one action where this default flips — see "Swaps are a special case" below.**

## Swaps are a special case

Every other action Model B brackets (deposit, borrow, transfer-style consuming calls) has its whole bound expressed inside the batch's own approve/consume/reset shape: amount cap, allowlisted target+selector, recipient pin — nothing about "price" is missing because none of those actions have a price dimension the batch needs to check. A swap does: `SwapPermission` and `SwapPermissionNoOracle` each decode `amountOutMinimum` from the swap call and reject anything below an oracle- or pool-implied floor — but `ApproveAndCallBatchPermission.evaluateBatch()` has no output-token allowlist and no min-out/slippage check at all. Route a swap through the batch and that floor is never verified on-chain: the agent's embedded `amountOutMinimum` is a courtesy to the router, not a kernel-enforced bound.

**So for swaps, the default is single-dispatch** through `SwapPermission` / `SwapPermissionNoOracle` — the model that actually evaluates the price floor on every call. That leaves one separate question: **who grants the router's allowance, and how** — a different axis from the price-floor question above, not a fallback from it.

**The agent grants its own allowance (featured — the default for autonomous operation).** This is Model A, applied to the swap's approve exactly like every other action above: deploy a small bespoke `IPermission` that bounds a standalone ERC-20 `approve()` — target == the token, selector == `approve`, `spender` ∈ the router allowlist, `value == 0`, and, the user's choice, either no amount ceiling or a per-call cap. Register it alongside `SwapPermission`/`SwapPermissionNoOracle` in the same signing session (Gate 7 of [`sailor-mandates`](../SKILL.md)). At runtime the agent reads `allowance(SMA, router)` before the swap and, when it's insufficient, emits its own `approve()` dispatch first — a normal Model A single-call dispatch, gated by the permission it already registered, needing no one else's signature. A full worked example (`BoundedErc20Approve`) is in [authoring-patterns.md](authoring-patterns.md) — one of the simplest bespoke permissions to write, and the natural companion to any swap mandate.

**Why unlimited is safe, not reckless — and why size no longer decides who's in the loop.** Neither `SwapPermission` nor `SwapPermissionNoOracle`'s `evaluate()` reads the ERC-20 allowance at all — the router allowlist, the per-tx cap (`amountIn ≤ maxAmountPerTx`), the recipient pin, and the min-out/price floor are all decoded purely from the dispatched call's own arguments and the account's configured bounds. Allowance size cannot widen what any single swap is allowed to do; it only gates whether the router *can* pull tokens at all. That means the size choice — **standing** (`type(uint256).max`, approved once, rarely revisited) or **bounded-per-trade** (just enough for the next few trades, re-approved once it runs low) — is not a safety question, and, now that the approve is agent-emitted under a registered permission, it is not an availability question either: the agent re-approves itself, on its own tick, whenever the allowance it's watching runs low. **The agent never stalls waiting for a top-up, at any size.** A bounded-per-trade cap is a strictly tighter allowance with the same on-chain floor, at the cost of one extra self-issued dispatch now and then — not a worse default traded for availability, since availability was never at stake once the agent (not the owner) does the re-approving.

**Owner-set standing approval (kept — a legitimate, simpler alternative, not the default).** A user who would rather skip authoring a bespoke permission at all can still have the owner sign a one-time `approve(router, type(uint256).max)` directly on the Safe — an owner-signed transaction independent of the kernel/mandate system, no permission evaluated for the approve itself (Sailor has no CLI/UI command for this; the owner does it through their own Safe interface). Revocable in one transaction at any time. It remains a real, valid choice for an owner who doesn't mind the one manual step — it is simply no longer *the* way an autonomous swap mandate gets its allowance, and the golden path never requires it.

**Correcting the stall argument.** A bounded allowance only stalls a swap agent when *the owner* is the one who has to top it up — that cost is real, but it belongs to the owner-set model above, not to bounded allowances in general. When the approve is agent-emitted under a registered permission (the featured case above), the agent tops itself up on the same loop that would otherwise stall, and nobody is waiting on anybody. Don't read "bounded ⇒ stalls" as a blanket argument against bounded swap allowances — it only holds when the owner is the one expected to do the re-approving.

The atomic batch remains correct and available for swaps when the user deliberately wants zero standing allowance more than an on-chain-checked price floor — say so to the user in exactly those terms, never as "the batch also protects your price," because it does not.

## Verifying each model

- **Model A:** `sailor mandate simulate` probes each `IPermission`'s single-call `evaluate()`. See `simulate-calls.md`.
- **Model B:** `simulate` does NOT cover batch permissions. Validate the exact `[approve, action]` sequence through the kernel's `previewBatch` view (no gas, no signing) — `sailor run --once` exercises this path against a registered batch permission, or call the permission's `evaluateBatch` view directly with `cast call`.

## Kernel-model corollary (conjunctive only)

On a conjunctive kernel ALL registered permissions must return true on EVERY call, so two narrow approve permissions (one per token) brick each other. Use ONE approve permission allowing all needed tokens. On selective kernels — all currently bundled chains — each dispatch names exactly one permission, so this does not apply.