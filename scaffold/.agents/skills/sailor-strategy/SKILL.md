---
name: sailor-strategy
description: Station 2 AND the single skill for creating or configuring a strategy — turn the user's intent into a complete, concrete strategy spec at .sail/strategy.md, then wire the executable to run. THE skill to call whenever the user wants to create or configure a strategy, reached by normal navigation OR by direct intent. Use when the user says "I want to DCA", "earn yield on my USDC", "stake my ETH", "rebalance my portfolio", "pay contributors weekly", "invest", "what should my agent do", "create a strategy", "add a strategy", "configure a strategy", "new strategy", "wire up a strategy", "new executable", or asks to define, plan, or change their strategy — and whenever .sail/strategy.md is missing or incomplete while mandate work is being requested. Elicits the intent in the user's own financial terms, then every completeness dimension (chains, tokens, venues, amounts, caps, cadence, risk bounds, exit condition); routing to templates or bespoke follows the intent, never leads it. Every token is resolved (address + decimals + liquidity) before it enters the spec.
---

# sailor-strategy — make the strategy concrete (Station 2)

## Precondition (fail-closed)

Station 2 requires Station 1 complete. Run `sailor doctor` — if it is not green (RPC connected, chain-id matches, keys present, gas funded), hand back to [`sailor-onboarding`](../sailor-onboarding/SKILL.md) and return here once it passes.

Then read `.sail/strategy.md`. If it exists, every dimension in the completeness gate below is concrete, its JSON block has `"confirmedByUser": true`, AND `"version": 3` — this station is already done: confirm the existing spec with the user instead of re-eliciting. An older `version` predates the resolved-artifact schema below — `version: 1` never captured addresses/pools; `version: 2` captured those but never asked the per-action exit-path question — either way, treat it as incomplete and re-run Act 2/3 to backfill the current shape. If it exists but is incomplete, resume from the gaps only.

## Role

You are an interviewer and a scribe, not an investment advisor. Never recommend what to invest in, never predict returns, never rank assets or venues by expected performance. The user decides WHAT; this station makes it CONCRETE; the protocol makes it SAFE.

## Creating a strategy — the flow (standalone or in-navigation)

This skill is **THE** entry point for creating or configuring a strategy — whether the user arrived by normal navigation (this is Station 2) or jumped straight in ("create a strategy", "add a strategy", "wire up a new executable"). The flow is the same either way; each step maps to the command that performs it. Steps 1–3 and 5–6 settle the **intent** (the three acts below → `.sail/strategy.md`); steps 4, 7–8 are the **execution config** that wires an executable to run — the model, `.sail/strategies/strategies.json`, and the full `sailor strategy` CLI live in [references/execution-config.md](references/execution-config.md).

**Strategy creation is an anytime action.** It is reachable by direct intent at any point in a session — "create a strategy", "add a strategy", "wire up a new executable" — and is **not** gated behind reaching Station 2 in sequence. It self-bootstraps: if there is no SMA yet, it jumps to [`sailor-onboarding`](../sailor-onboarding/SKILL.md) to create and verify one (doctor-green), then returns here and continues. You never turn the user away for arriving "out of order."

**Requirements to create a strategy — gather these before running `sailor strategy create`:**

- **name** — 2–3 words, unique.
- **SMA** — the account address the strategy operates (step 1; bootstrap via `sailor-onboarding` if none).
- **executable** — the runnable script; default **`agent`** (`src/strategy/agent.ts`, falling back to legacy `src/agent.ts`).
- **description** — a concise line for the dashboard.
- **chain(s)** — required only in **per-chain** mode (the `--chains` list); omitted for cross-chain.
- **all per-chain environment variables** — every value the executable reads via `ctx.env`, set per chain (step 4).

1. **Which SMA?** One → use it; several → let the user pick. **None, or the user wants a new one** → jump to [`../sailor-onboarding/SKILL.md`](../sailor-onboarding/SKILL.md) to create and verify it (doctor-green), then return here. → `--sma <address>`.
2. **What should it do?** Elicit the intent in the user's own financial terms and route it — via the category references and any project recipes (see "The category contract" below). This is Acts 1–3.
3. **Which chains, and which mode?** Same logic on every listed chain → **per-chain** (`--chains <ids>`; the executable is replayed once per chain). Chains the executable drives itself (reads on one, acts on another) → **cross-chain** (omit `--chains`).
4. **Per-chain env.** Any value the executable reads per chain lives in `.sail/env/<chain-slug>.json` — **shared across every strategy in the project**, reached via `ctx.env`. `sailor strategy env set <chain> KEY=value` **creates that env file** (one per chain, e.g. `base.json`) and sets the key; set every variable the executable reads before the first run. → `sailor strategy env set <chain> KEY=value`.
5. **A concise description** for the dashboard. → `--description "<text>"`.
6. **A 2–3 word name.** → `sailor strategy create <name>`.
7. **Active by default.** `create` makes the strategy active immediately; pass `--inactive` to create it paused, then `sailor strategy activate|deactivate <name>` to toggle.
8. **Run the `sailor strategy` commands** to persist the config (`create`, `env set`, …).

**When each step fires.** Jumping in directly to wire an executable that already exists, you run the commands now. In the station journey, the intent (steps 1–3, 5–6) is fixed *here* and persisted to `.sail/strategy.md`; the executable is written at Station 4, so the `strategies.json` wiring (steps 4, 7–8, per [references/execution-config.md](references/execution-config.md)) is performed there. Either path, this skill owns the flow — then it hands to **Station 3** ([`../sailor-mandate-planner/SKILL.md`](../sailor-mandate-planner/SKILL.md)).

## The pre-specified fast path (first-class, not a deviation)

When the user's message already specifies the strategy fully or nearly ("DCA $50/day USDC→WETH on Base, 1% slippage, run till I stop"), RECEIVE it instead of eliciting: parse what was given, validate it against the completeness gate below, ask for the genuinely missing dimensions in ONE compact message (never one-per-turn), then go straight to Act 3. **Never ask for what the user already said.** A partial opener ("daily DCA on Arbitrum and Base") gets the same treatment for the dimensions it did state.

## The three acts

### Act 1 — ORIENT

The user's financial intent leads; enforcement routing follows. If the opening message already names an intent, acknowledge it and move on (near-complete → the fast path above). For the user who doesn't know where to start, offer the doors as conversation-starters — examples of intent, not a menu to be forced into:

- **Trading** — spot, DCA, rebalancing → [references/trading.md](references/trading.md)
- **Yield** — lending, borrowing, liquidity providing, staking, looping → [references/yield.md](references/yield.md)
- **Payments & treasury** — transfers, scheduled moves, operational flows → [references/payments.md](references/payments.md)

…or anything else on-chain — these are common shapes, not the boundary. Permissions are arbitrary Solidity; if it's on-chain, it can be bounded. An intent that matches no door is normal, not an exception: it takes exactly the same path — intent in the user's terms → completeness → routing.

### Act 2 — SPECIFY

Elicit in the user's financial vocabulary — accumulate, earn, provide liquidity, take leverage, hedge, automate a flow, act on a condition. The mapping to enforcement (which template, or bespoke) is your step, done AFTER the intent is clear — never make the user speak in templates.

**Routing aids — consult, never force.** When a category reference fits the intent, use it: its archetypes pre-fill structural defaults, and its routing rows are Station 3's canon for that category. **Read categories from two places:** the **three core recipes** shipped with Sailor — `references/trading.md`, `references/yield.md`, `references/payments.md` (they ship in this skill's `references/` and are refreshed by `sailor update`) — AND any **project recipes** in `.sail/recipes/*.md` (project-specific categories you add, which persist across `sailor update`). Consult both, and treat a matching project recipe exactly like a core one (it conforms to the same three-part contract below). When none fits — or the intent is exotic or unclear — consult [references/possibility-map.md](references/possibility-map.md): it maps financial goals to the bound shapes that enforce them, and routes each action to a template or to bespoke authoring. **Lazy-loading rule: a plain DCA / deposit / payment never loads the map.** Defaults from any aid are **structural only** (cadences, band widths, caps as a fraction of allocated capital, conservative LTV): never an invented venue or token address, never an asset recommendation.

**Routing is per-action, whatever the category.** An action a shared template can express routes to that template; one it cannot routes to bespoke authoring at Station 3 — the protocol working as designed, not a detour. A `category: "custom"` strategy still gets the full completeness gate, and its actions still route individually: a custom strategy with a plain swap leg uses the swap template for that leg. Establish each action's route during this act — Act 3's disclosures count on it. **When intent is ambiguous between readings, ask — never resolve ambiguity toward the reading that is easier to build.**

Fill the dimensions by **infer-then-confirm**: extract everything the user's words already imply, draft the spec with each inference marked as such, and ask only about the genuine gaps — batched into few questions, never an interrogation.

**Resolve every token before it enters the spec.** Run [`sailor-token-resolve`](../sailor-token-resolve/SKILL.md) for each token: on-chain address, decimals, and where the liquidity lives. No symbol is ever written into the spec unresolved. **Carry the resolution forward, don't discard it.** `sailor-token-resolve`'s output already carries the token address/decimals, the chosen venue, the pool address, its fee tier, and its observed liquidity — hold onto that output per action; Act 3 writes it into the artifact verbatim. Never re-resolve at write time, and never let a resolved value fall back to "USDC→WETH" prose with the addresses dropped.

**Ask the exit-path question, per position-opening action, batched with the rest.** Every action that builds a position over time — an accumulate-direction swap, a deposit, a borrow — gets one explicit question: who unwinds it? **Agent-managed** (a swap-out, withdraw, or repay leg lives in the mandate itself, alongside the entry) or **owner-managed** (the user exits manually, whenever they choose — the sovereign Safe exit always works regardless of mandate or agent state; see [`sailor-operate`](../sailor-operate/SKILL.md))? Frame it as capability, never a requirement: "I'll exit manually" is a complete, correct answer the instant the user says it explicitly — the failure this closes is the question never being asked, not the user declining to build an exit leg. Record the answer in the action's `exitPath` (see Spec format below); never leave it silently absent. This is a separate question from **Exit condition** below — that's *when* the strategy stops accumulating; `exitPath` is *how* the position it already built gets unwound.

### Act 3 — CONFIRM

Render the full spec, walk the completeness checklist below with the user, get their explicit confirmation, then write `.sail/strategy.md`.

**The confirmation surface is the resolved artifact, not a paraphrase.** What the user reviews before approving must show every resolved concrete value per action — token addresses, decimals, venue/router address, pool address + fee tier, the cap in both human terms and base units, direction (tokenIn→tokenOut, explicit, never implied by list order) — as one scannable table, the same shape that gets persisted (see "Spec format" below): "here is exactly what your agent will be bounded to do, in concrete terms — confirm this is right." This composes with, and does not replace, the disclosures below.

**Persist AND say where.** Immediately after confirmation, write `.sail/strategy.md` in the format below, then tell the user in one line: "Saved to `.sail/strategy.md` — the full resolved detail (addresses, pools, caps) lives there if you want to check it, or edit it directly; I'll pick up your changes and re-confirm them next time either station runs." Resolution and persistence happen regardless of whether the strategy arrived via full elicitation or the pre-specified fast path — the fast path still resolves every token and still writes the artifact; it only skips the back-and-forth, never the resolution or the write.

**Disclose bespoke Solidity before the user approves.** Using the per-action routes established in Act 2 (from the category reference's routing rows, or the possibility map), count how many of the spec's actions map to a shared template vs. bespoke authoring. If any action is bespoke (M > 0), the confirmation summary must say so plainly before they approve:

> This strategy uses <N> shared template(s) and <M> custom permission(s) that your coding agent will author in Solidity — compiled and tested in `contracts/`, reviewed and signed by you.

**When M > 0, say what that work actually is — once, here, plainly, as capability, not warning:** authoring a permission against a venue's real interface is genuinely deeper work than configuring a template. A venue can have multiple deployed generations or forks (Uniswap V3 vs V4, a fork's own variant, …), the SDK or docs you'd naturally reach for can drift from what's actually deployed, and a shape mismatch at this layer often fails as a bare revert with no explanation rather than a helpful error. None of that is a reason not to proceed — bespoke is the protocol working as designed (`sailor-mandates`) — it's why the authoring flow simulates against the real venue before every register, and why [`sailor-mandates/references/dark-reverts.md`](../sailor-mandates/references/dark-reverts.md) (the diagnostic ladder) and its sibling `venue-cookbook.md` (the field-derived integration patterns) exist: worth reading before authoring against an exotic or multi-generation venue, not after the first unexplained revert. Compiling and testing that Solidity needs Foundry (`forge`) installed — the one extra tool the bespoke path calls for; the install one-liner (which the coding agent can usually run itself) lives in [`sailor-mandates`](../sailor-mandates/SKILL.md)'s "Prerequisite — Foundry".

Show this line **only when M > 0**. A fully template-backed strategy (M = 0) says nothing about Solidity — most strategies never touch it.

**Disclose approve-coverage impact before the user approves.** Check the spec's actions against [`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md) (the owner of which actions need approve coverage and why). If any need one, say so plainly, without the execution-model detail (per-call vs. atomic batch is decided at Station 3, not here):

> <N> action(s) in this strategy will also need an ERC-20 approval covered — the mandate will end up with more permissions than there are actions, not a 1:1 count.

Show this line only when at least one action needs approve coverage; say nothing about it otherwise.

**Disclose cadence enforcement before the user approves.** If the spec has a cadence (anything other than "no cadence"), state in one line that the schedule or trigger is enforced by the agent's own logic, not by the onchain kernel — the kernel has no notion of time or frequency, only of what each dispatch is allowed to do:

> Cadence ("<cadence value>") is enforced by your agent's code, not by the mandate — the kernel checks each dispatch against its bounds but has no concept of schedule; if the agent stops running, nothing fires.

## Completeness gate (fail-closed — the station does not exit until every dimension is concrete)

| Dimension | Concrete means |
|---|---|
| Chains | Named chain IDs, each doctor-green. If the strategy needs a chain this project isn't configured for, loop back to Station 1 to add it before proceeding. |
| Tokens | Resolved address + decimals, per chain, per action — from `sailor-token-resolve`, never from memory. Direction (which is tokenIn, which is tokenOut) explicit per action, never implied by list order. |
| Venues/protocols | The exact DEX/router, lending market, vault, or recipient set — named and address-resolved, per action. A swap action also carries the pool address, fee tier, and observed liquidity `sailor-token-resolve` reported. |
| Route | Per action: which shared template it maps to, or "bespoke" — established in Act 2, carried into the artifact so Station 3 verifies rather than re-derives. |
| Amounts & caps | Per-tx cap AND total or per-period exposure, per action, in BOTH the token's base units and human terms (e.g. "25 USDC" and its base-units form). |
| Cadence | Event-driven or scheduled — and the actual schedule or trigger. |
| Risk bounds | Category-specific (slippage floor, LTV ceiling, tolerance band, …) — the reference file's extension dimensions, per action where they vary by pair/market. |
| Exit condition | When the strategy *stops* — the trigger or schedule that ends accumulation. "No exit condition — runs until revoked" is acceptable ONLY if the user says it explicitly. Distinct from Exit path below. |
| Exit path (per position-opening action) | *How* the position that action builds gets unwound — agent-managed, owner-managed, or explicitly declined. Recorded per action in `exitPath`; never silently absent. Applies to accumulate-direction swaps, deposits, and borrows — not to actions that are themselves an exit (withdraw/transfer/repay legs). |
| Provenance | When each token/pool was resolved, and against which RPC per chain — so a stale artifact (a pool that's moved, a resolution from weeks ago) is detectable before it's trusted. |

## Spec format — `.sail/strategy.md`

Human-readable markdown (title, category, archetype, one-paragraph intent in the user's own words, a strategy-wide dimensions table, and an **Actions** table — one row per action, the resolved detail: route, direction with addresses, venue/pool, caps in both forms, risk bounds, exit path) plus **one** fenced ```json block carrying the machine form. Later stations read the JSON; the markdown is for humans. The two are the same data in two shapes — never let them drift (the JSON is regenerated from the same resolved values the table renders, not typed separately).

Every action carries its own `tokenIn`/`tokenOut`/`venue`/`pool`/`caps`/`riskBounds` — a strategy is one or more actions, and two actions (even the "same" swap on two chains, as in a multi-chain DCA) never share one entry, because their addresses differ per chain. Position-opening actions also carry `exitPath` (see below).

```json
{
  "category": "trading | yield | payments | custom",
  "archetype": "<archetype id or 'custom'>",
  "chains": [<chainId>, ...],
  "actions": [
    {
      "id": "<short id, e.g. 'swap-base'>",
      "kind": "swap | deposit | borrow | transfer | withdraw | custom",
      "chain": <chainId>,
      "route": { "type": "template | bespoke", "name": "<TemplateName, or null if bespoke>" },
      "tokenIn": { "symbol": "", "address": "0x…", "decimals": 0 },
      "tokenOut": { "symbol": "", "address": "0x…", "decimals": 0 },
      "venue": { "name": "", "address": "0x…" },
      "pool": { "address": "0x…", "feeTier": 0, "observedLiquidityUsd": 0 },
      "recipients": ["0x…", "..."],
      "caps": {
        "perTx": { "baseUnits": "<string>", "human": "<e.g. '25 USDC'>" },
        "...": "one entry per elicited period (perDay, perMonth, …), same {baseUnits, human} shape"
      },
      "riskBounds": { "...": "action-specific, e.g. maxSlippageBps, maxLtvBps" },
      "exitPath": { "managedBy": "agent | owner | none-declined", "actionIds": ["<paired exit action id(s) — agent-managed only>"] }
    }
  ],
  "cadence": "<event-driven trigger or schedule>",
  "exitCondition": "<when it stops accumulating>",
  "provenance": {
    "resolvedAt": "<ISO 8601 UTC, e.g. '2026-07-10T21:14:00Z'>",
    "chains": { "<chainId>": { "rpc": "<label — which RPC endpoint/provider resolved this chain>" } }
  },
  "confirmedByUser": true,
  "version": 3
}
```

`tokenOut`/`venue`/`pool` are swap-shaped fields — omit them on an action whose `kind` doesn't have them (a `transfer` action has `tokenIn` + `recipients`, no `tokenOut`/`pool`; a `withdraw` action has `tokenIn` + `venue` and carries NO `recipients` — the proceeds are pinned to the SMA; a `deposit`/`borrow` action has `tokenIn` + `venue`, no `pool` unless the market itself is a pool). Never emit an empty placeholder for a field that doesn't apply — omit the key. `exitPath` follows the same rule: only position-opening actions (accumulate-direction swap, deposit, borrow) carry it; an action that is itself an exit leg (withdraw/transfer/repay) omits it. `actionIds` is populated only when `managedBy: "agent"` — it names the id(s) of the paired exit action(s) already representable in `actions[]` today (a reverse-direction `kind: "swap"` row, a `kind: "withdraw"` row, or the repay/unwind leg); `owner` and `none-declined` carry no `actionIds`.

`version: 3` is the resolved-artifact schema in this section (per-action `actions[]`, `provenance`, `exitPath`). A file written under `version: 2` (no `exitPath` — the exit-path question was never asked) or `version: 1` (flat top-level `tokens`/`venues`/`caps`, no per-action route/pool/provenance) predates it — see the precondition above.

A complete worked example (a two-chain DCA with real Base/Arbitrum addresses) is in [references/trading.md](references/trading.md).

## The category contract

There are two kinds of category file, same contract for both. The **three core recipes** — `references/trading.md`, `references/yield.md`, `references/payments.md` — ship with Sailor in this skill's `references/` and are refreshed by `sailor update`. **Project recipes** live in `.sail/recipes/<category>.md`, are specific to one project, and persist across `sailor update` (the updater never touches `.sail/`). A category file of either kind must contain exactly three things:

1. **2–3 archetypes**, each with pre-filled structural defaults for most dimensions.
2. **Extension dimensions** — the category-specific rows appended to the core completeness gate.
3. **Template routing** — which live template skill (or bespoke authoring) each action of the category maps to, with capability limits stated from the template's own schema.

**Copy-me skeleton** — paste into a new category file and fill in the three required sections:

```markdown
# <Category> — archetypes, extension dimensions, routing

A routing aid consulted when the intent fits this category — not the boundary of what can be built.

## Archetypes
### <Archetype name> — <one-line description>
Defaults: <structural only — cadences, band widths, caps as a fraction of allocated capital, conservative LTV>. The user supplies: <the fields the user must name>.

## Extension dimensions (append to the core gate)
| Dimension | Concrete means |
|---|---|
| <name> | <what "concrete" means for it> |

## Routing (Station 3 reads this)
| Action | Route |
|---|---|
| <action> | <template skill, or "bespoke via sailor-mandates"> |
```

**Adding a category to Sailor — two audiences:**

- **PROJECT (for the user):** drop a conforming `<name>.md` into [`.sail/recipes/`](../../../.sail/recipes/README.md) per the contract above. It **survives `sailor update`**, needs **no skill edit and no navigator door line**, and is read automatically alongside the built-ins (see the method in Act 2). This is the normal way to teach one project a new category. If there is a new category to add not in the skill, add it here with a descriptive name.
- **SAILOR (a maintainer, shipping it to everyone):** add a built-in in the repo — one conforming `references/<name>.md` here + one door line in the `sailor-navigator` skill's "What can be built here" list + one routing row in the mandate planner — shipped to every project via `sailor update`.

([references/possibility-map.md](references/possibility-map.md) is not a category reference — it is the cross-category routing aid and follows its own format.)

## Handoff

Exit verifier: every dimension concrete (including each position-opening action's `exitPath`), user explicitly confirmed, `.sail/strategy.md` written with `"confirmedByUser": true` and `"version": 3` — the resolved summary presented to the user AND persisted, not just the latter. Next: **Station 3 — [`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)**, which routes each action of the spec to a shared template or bespoke authoring.
