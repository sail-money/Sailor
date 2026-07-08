---
name: sailor-mandate-planner
description: Station 3 entry — turn a complete strategy spec into a mandate plan, routing each action to a shared permission template or to bespoke authoring. Use when the user says "build the mandate", "which template do I need", "turn my strategy into permissions", "register permissions", "what bounds does my agent need" — and structurally whenever .sail/strategy.md is complete and mandate work begins.
---

# sailor-mandate-planner — route the strategy into enforced bounds (Station 3)

This skill is a gate and a router, deliberately thin. The template registry lives in `sailor-templates`, the bespoke method in `sailor-mandates`, and the per-category routing rows in `sailor-strategy`'s references — this file tells you when to cross the gate and how to decide between them.

## Gate (fail-closed)

Read `.sail/strategy.md` first. AGENTS.md station 3: "Gate: complete `.sail/strategy.md`". If the file is missing, any completeness dimension is not concrete, or its JSON block lacks `"confirmedByUser": true` — do **not** proceed. Hand back to [`sailor-strategy`](../sailor-strategy/SKILL.md) and return once the gate holds. The completeness checklist lives there, not here.

## Routing method

1. **Enumerate the actions.** From the spec's JSON block, list each distinct action the strategy implies — every swap leg, deposit, borrow, transfer, withdrawal, and the ERC-20 approves those actions need. For each, consult the routing rows of the category reference the strategy used (`sailor-strategy/references/<category>.md`) — those rows are canonical; they are not restated here.

2. **Decide template vs bespoke, per action:**
   - **Reuse a shared template whenever it can express the bound** — register + configure, no Solidity, no per-SMA deploy. Start at [`sailor-templates`](../sailor-templates/SKILL.md) (the registry), then the matching spoke skill.
   - **Author bespoke** via [`sailor-mandates`](../sailor-mandates/SKILL.md) when the strategy needs a venue, selector, or bound the singletons cannot express.
   - Mixing templates and bespoke in one mandate is normal.
   - When in doubt, check what exists first: `sailor mandate templates --json` and `node .agents/skills/sailor-templates/catalog.mjs --chain <id>`.

3. **Present the mandate plan to the user before any deployment.** One row per action: the action → its permission (template name, or "bespoke: <what it must gate>") → the bounds it will carry (from the spec's `caps` and `riskBounds`). Include the registration-fee disclosure — fee mechanics live in [`sailor-mandates`](../sailor-mandates/SKILL.md) (Registration fee section).

## Ordering rules (enforced here, specified elsewhere)

- **Shared singletons: register ≠ configure.** Follow [`sailor-templates`](../sailor-templates/SKILL.md)'s reuse flow exactly — register, configure, then simulate; a registered-but-unconfigured template denies everything.
- **Bespoke permissions:** AGENTS.md invariant 1 — "**Deploy → simulate → register.** Registration is authorization; nothing is authorized before its bounds are proven, including proven to reject what they must reject."
- **Autonomous strategies must answer the approve-coverage question before the plan is final.** Every ERC-20 `approve()` the strategy implies needs explicit coverage — read [`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md) and pick the execution model as part of the plan, not after it.

## Handoff

Exit verifier: every permission in the plan **registered, configured, and simulate-verified** — passing its must-pass samples AND correctly rejecting its must-fail samples. Next: **Station 4 — the agent-build skill**. Dispatch mechanics reference in the interim: [`sailor-transactions`](../sailor-transactions/SKILL.md).
