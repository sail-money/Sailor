---
name: sailor-mandate-planner
description: Station 3 entry — turn a complete strategy spec into a mandate plan, routing each action to a shared permission template or to bespoke authoring. Use when the user says "build the mandate", "which template do I need", "turn my strategy into permissions", "register permissions", "what bounds does my agent need" — and structurally whenever .sail/strategy.md is complete and mandate work begins.
---

# sailor-mandate-planner — route the strategy into enforced bounds (Station 3)

This skill is a gate and a router, deliberately thin. The template registry lives in `sailor-templates`, the bespoke method in `sailor-mandates`, the per-category routing rows in `sailor-strategy`'s references, and the cross-category [possibility map](../sailor-strategy/references/possibility-map.md) — this file tells you when to cross the gate, WHERE the route for each action actually comes from, and which simulation path proves it.

## Gate (fail-closed)

Read `.sail/strategy.md` first. AGENTS.md station 3: "Gate: complete `.sail/strategy.md`". If the file is missing, any completeness dimension is not concrete, its JSON block lacks `"confirmedByUser": true`, or its `"version"` is not `2` — do **not** proceed. Hand back to [`sailor-strategy`](../sailor-strategy/SKILL.md) and return once the gate holds — a pre-`version: 2` file has no resolved `actions[]` to plan from. The completeness checklist lives there, not here.

## Routing method

1. **Enumerate the actions from `actions[]` — it's already the resolved list, don't re-derive it.** The spec's JSON `actions` array is one entry per distinct action the strategy implies — every swap leg, deposit, borrow (including the collateral-supply leg, which is itself a deposit, and the repay/unwind leg if the strategy has an exit condition), transfer, and withdrawal — each already carrying its resolved `tokenIn`/`tokenOut`, `venue`, `pool` (swap actions), `caps`, and `riskBounds`. This is the producer→consumer contract with Station 2: what you configure a permission FROM is what's already in the action's `caps`/`riskBounds`, not a re-elicitation — if a value looks missing, that's a Station 2 gap, not something to infer here.

   **Check every action on that list against [`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md) — not swap alone**, and at enumeration time, not as an afterthought — a deposit, collateral-supply leg, or repay leg needs the same scrutiny as a swap, and a `route.type: "bespoke"` action is not exempt just because it has no spoke skill to remind you (see `sailor-templates`'s "Beyond the templates"). approvals.md is the single source on which actions need approve coverage and how; do not re-derive the logic here.

2. **Each action's `route` field is the input — verify it, don't re-derive from scratch.** Station 2 (`sailor-strategy` Act 2) already recorded it in `action.route: {type, name}`. For each action:
   - **`route.type: "template"`** — verify it actually holds: the named template's selector set genuinely matches this call shape (check the spoke's "What it enforces" table), and its capability limits (chain, venue family, oracle requirement) actually fit the action's `chain`/`venue`/`pool`. Holds → proceed. Doesn't → the spec was wrong; resolve it per the fallback below and say so to the user.
   - **`route.type: "bespoke"`** — verify a shared template genuinely can't express it (check `sailor-templates` — `sailor mandate templates --json` / `node .agents/skills/sailor-templates/catalog.mjs --chain <id>` — before accepting "bespoke" at face value; a spec can overreach here too).
   - **Missing `route`, or `version` < 2** (an older spec, or a gap) — resolve it now, using the same aids Station 2 uses: the matching category reference's routing rows when the action's category fits, or the [possibility map](../sailor-strategy/references/possibility-map.md) when none does — and say plainly that you resolved it here, not at Station 2.
   - Mixing templates and bespoke in one mandate is normal — a plan is N template rows + M bespoke rows, not a binary choice.

3. **Present the mandate plan to the user before any deployment.** One row per action: the action → its permission (template name, or "bespoke: <what it must gate>") → the bounds it will carry (straight from that action's `caps` and `riskBounds` — the same resolved values the user already reviewed at Station 2 exit, now feeding the permission config, not re-typed) → its simulation route (below). Include the registration-fee disclosure — fee mechanics live in [`sailor-mandates`](../sailor-mandates/SKILL.md) (Registration fee section).

   **Every bespoke row carries this disclosure:** what it wants isn't a standard template, but it's completely expressible — the coding agent authors a permission that bounds exactly this, in `contracts/`, through [`sailor-mandates`](../sailor-mandates/SKILL.md)'s authoring gates. The kernel evaluates it on every dispatch but does not verify its logic does what it claims: the operator reviews it and signs it (the protocol's own Known Limitations). If the plan has **no** bespoke rows, say nothing about Solidity.

   **Toolchain precheck (only when any row is bespoke):** before presenting the plan as approvable, verify Foundry is installed — run `forge --version`. If it is missing, do not present an approvable plan; route the user to the Foundry install one-liner in [`sailor-mandates`](../sailor-mandates/SKILL.md) ("Prerequisite — Foundry"), then rerun the check.

   **Price-band tolerance check (swap rows only) — before presenting the plan as approvable.** For every swap action, whatever route it took, check the tolerance you're about to configure — `SwapPermission`'s `maxSlippageBps` or `SwapPermissionNoOracle`'s per-pair `toleranceBps` — against the action's own resolved `pool.feeTier` (already in the strategy artifact; Uniswap V3 fee units are hundredths of a bip — divide by 100 for bps) and `riskBounds.maxSlippageBps` (the agent's own slippage). If `tolerance ≤ fee + slippage`, the band will silently reject every legitimate trade — say so to the user with the actual numbers before registering: *"At `<tolerance>` bps tolerance against a `<fee>`-bps pool fee and `<slippage>` bps of agent slippage, this permission will deny every trade — every buy will fail, silently. Set it to at least `<fee + slippage + ~150>` bps instead."* This is a recommendation, not a refusal — the user may keep a tight value knowingly; they must never hit this UNKNOWINGLY. Full reasoning and the formula: [`sailor-template-swap-no-oracle`](../sailor-template-swap-no-oracle/SKILL.md) (the "⚠️ Tolerance vs. pool fee" section).

## Simulation routing — every permission, both paths, one standard

Every permission in the plan needs a simulation path decided HERE, at planning time — not discovered mid-flow:

- **Template rows** → the parametric probe script, `scripts/probe-mandate.mjs` ([reuse-flow](../sailor-templates/references/reuse-flow.md) step 5). It derives the lean probe set from the same config blob you configure with. Two rows carry a wrinkle the script already handles: `BorrowPermission` needs `--protocol <aave|morpho|compound>`; `ApproveAndCallBatchPermission` is probed as `evaluateBatch` batch arrays, not `sailor mandate simulate`. Detail lives in reuse-flow.md — don't restate it here.
- **Bespoke rows** → agent-derived probes, following [the probe pattern in `sailor-mandates`](../sailor-mandates/references/simulate-calls.md) (one bound the contract encodes → one must-fail probe just past it, plus one representative must-pass inside every bound). This is the structurally-only option — a freshly authored contract has no schema for a script to read.

**The one standard, on either path: a simulation has passed only when its must-fail probes are PROVEN TO REJECT.** A run that only exercises the happy path is not a passed simulation, whether the permission is a template or bespoke — the must-fail proofs are the point (they're what "fail-closed" means in practice, not just in the whitepaper). The exit verifier below checks this, not just that simulate ran.

## Ordering rules (enforced here, specified elsewhere)

- **Shared singletons: register ≠ configure.** Follow [`sailor-templates`](../sailor-templates/SKILL.md)'s reuse flow exactly — register, configure, then simulate ONCE (the single safety gate, [reuse-flow](../sailor-templates/references/reuse-flow.md) step 5); a registered-but-unconfigured template denies everything. The exit-verifier below checks that this one simulation passed — it does not call for a second run.
- **Bespoke permissions:** AGENTS.md invariant 1 — "**Deploy → simulate → register.** Registration is authorization; nothing is authorized before its bounds are proven, including proven to reject what they must reject."
- **A mixed plan composes both orderings independently, per row** — a template row's register→configure→simulate and a bespoke row's deploy→simulate→register don't block or reorder each other; sequence each row by its own kind, not by a single mandate-wide order.
- **Every plan must answer the approve-coverage question before it is final** — not only for swap, for every action that needs one (step 1 above). Read [`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md) and pick the execution model as part of the plan, not after it.

## Handoff

Once every row in the plan is registered, configured, and simulate-verified, sign the mandate — **once, for the whole plan, not per row**:

```bash
sailor mandate sign
```

This is the closing act of Station 3, not maintenance: it reviews the full set of permissions now tracked for the SMA (reconciled against on-chain truth), discloses any outstanding registration fee, takes one confirmation from the user, and writes `.sail/mandate.json` — the file `sailor run` hard-requires (absent it, `run`/`run --once` refuses with "Run `sailor mandate sign` first"). Run it after the last row's simulation passes, never before — signing reviews what's already registered, it doesn't register anything new on its own (though it will register any tracked-but-unregistered permission it finds, disclosing the fee first).

Exit verifier: every permission in the plan **registered, configured, and simulate-verified** — passing its must-pass samples AND correctly rejecting its must-fail samples (the standard above — must-fail proven, not just run) — **AND the mandate signed** (`.sail/mandate.json` written by `sailor mandate sign`). Next: **Station 4 — the agent-build skill**. Dispatch mechanics reference in the interim: [`sailor-transactions`](../sailor-transactions/SKILL.md).
