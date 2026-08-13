---
name: sailor-strategy
description: Turn the user's intent into a complete, concrete strategy spec (one file per strategy) and wire it to an executable. Use when the user wants to create or change a strategy: I want to DCA, earn yield, rebalance, or what should my agent do.
station: strategy
---

# sailor-strategy — make the strategy concrete

## What this owns

Turn the user's intent into a complete, concrete strategy. Two artifacts, both owned here:

- the **spec** — one `.sail/strategies/<name>.md` per strategy (the financial intent),
- the **execution config** — `.sail/strategies/strategies.json` (what runs it), derived from the spec.

It does not own the mandate (that is `sailor-mandate-planner`), and it is not an investment advisor.
You are an interviewer and a scribe: never recommend what to invest in, never predict returns, never
rank assets or venues. The user decides WHAT; this skill makes it CONCRETE; the protocol makes it SAFE.

## When to use

- The user wants to create or change a strategy: "I want to DCA", "earn yield", "rebalance",
  "pay contributors weekly", "what should my agent do".
- A spec exists but is incomplete or predates the current schema (see Precondition).
- Direct intent at any point in a session — "create a strategy" is not gated behind reaching
  Station 2 in sequence; if there is no SMA yet, bootstrap via `sailor-onboarding` and return.

Not here: turning a complete spec into permissions — that is `sailor-mandate-planner`.

## Precondition (fail-closed)

Station 1 must be complete. Run `sailor doctor` — if it is not green (RPC connected, chain-id
matches, keys present, gas funded), hand back to `sailor-onboarding` and return once it passes.

Then read `.sail/strategies/*.md`. For each spec: if every completeness dimension is concrete, its
JSON block has `"confirmedByUser": true`, and `"version": 3` — that strategy is done; confirm the
existing spec with the user instead of re-eliciting. An older `version` predates the resolved-artifact
schema (`1` = never captured addresses/pools; `2` = never asked the per-action `exitPath` question) —
treat it as incomplete and backfill. If a spec exists but is incomplete, resume from its gaps only.

## Steps

**One strategy, or several?** Default to **one** — almost always right. Split only when intents
genuinely warrant independent execution (separate cadences, unrelated portfolios or venues, separate
SMAs). Keep interdependent moves in the SAME strategy; never merge two strategies into one spec.

Gather these before running the commands: **name** (2–3 word camelCase, = the spec filename and the
`--strategy` selector), **SMA** (bootstrap via `sailor-onboarding` if none), **executable** (default
`agent` = `src/agent.ts`), **description** (one line for the dashboard), **chain(s)** (per-chain mode
only), and **per-chain env** (every value the executable reads via `ctx.env`).

1. **Which SMA?** One → use it; several → the user picks; none → `sailor-onboarding`, then return.
   → `--sma <address>`.
2. **What should it do?** Elicit intent in the user's financial terms and route it (Acts 1–3 below).
3. **Which chains, which mode?** Same logic on each chain → **per-chain** (`--chains`); the
   executable drives chains itself → **cross-chain** (omit).
4. **Per-chain env.** `sailor strategy env set <chain> KEY=value` (writes `.sail/env/<chain-slug>.json`,
   shared across every strategy in the project).
5. **A concise description.** → `--description "<text>"`.
6. **The camelCase name.** → `sailor strategy create <name>`.
7. **Active by default.** `create` activates immediately; `--inactive` defers, then
   `sailor strategy activate|deactivate <name>`.
8. **Run the `sailor strategy` commands** to persist (`create`, `env set`).

Per strategy: settle and persist the intent first (steps 1–3, 5–6 → `.sail/strategies/<name>.md`),
then register it (steps 4, 7–8 → `strategies.json`), derived from the spec. The full `sailor strategy`
CLI and the `strategies.json` model live in [references/execution-config.md](references/execution-config.md).

## The pre-specified fast path

If the user already specified the strategy ("DCA $50/day USDC→WETH on Base, 1% slippage, run till I
stop"), RECEIVE it: parse, validate against the completeness gate, ask only the genuinely missing
dimensions in ONE compact message (never one per turn), then go straight to Act 3. Never ask for what
they already said.

## The three acts

### Act 1 — ORIENT

If the opening message already names an intent, acknowledge it and move on (near-complete → the fast
path). If not, offer the doors as conversation-starters — examples of intent, not a menu:

- **Trading** — spot, DCA, rebalancing → [references/trading.md](references/trading.md)
- **Yield** — lending, borrowing, LP, staking, looping → [references/yield.md](references/yield.md)
- **Payments & treasury** — transfers, scheduled moves, operational flows → [references/payments.md](references/payments.md)

…or anything else on-chain. These are common shapes, not the boundary. An intent matching no door takes
the same path: intent in the user's terms → completeness → routing.

### Act 2 — SPECIFY

Elicit in the user's financial vocabulary. The mapping to enforcement (which template, or bespoke) is
your step, done AFTER the intent is clear — never make the user speak in templates.

**Routing aids — consult, never force.** Category references (the core `references/*.md`, and any
project `.sail/recipes/*.md`) pre-fill structural defaults; the [possibility map](references/possibility-map.md)
routes goals to bound shapes when none fits. A plain DCA / deposit / payment never loads the map.
Defaults are **structural only** (cadences, band widths, caps, conservative LTV) — never an invented
venue, token address, or asset recommendation.

**Routing is per-action, whatever the category.** A `category: "custom"` strategy still gets the full
gate, and its actions route individually. When intent is ambiguous between readings, ask — never resolve
toward the reading that is easier to build.

**Infer-then-confirm.** Extract what the user's words already imply, draft the spec with each inference
marked as such, ask only about the genuine gaps — batched into few questions.

**Resolve every token before it enters the spec.** Run `sailor-token-resolve` per token, and carry its
output (address, decimals, venue, pool, fee tier, observed liquidity) forward into the artifact
verbatim. Never re-resolve at write time, never let a resolved value fall back to "USDC→WETH" prose.

**Ask the exit-path question** for every position-opening action (accumulate swap, deposit, borrow):
who unwinds it? **Agent-managed** (an exit leg lives in the mandate) or **owner-managed** (the user
exits manually). "I'll exit manually" is a complete answer — the failure this closes is the question
never being asked, not the user declining. Record it per action in `exitPath`; never leave it silently
absent. Distinct from the exit *condition* (when accumulation stops) — `exitPath` is *how* the built
position is unwound.

### Act 3 — CONFIRM

Render the full spec summary, walk the completeness gate with the user, get explicit confirmation, then
write `.sail/strategies/<name>.md`.

**The confirmation surface is the resolved artifact, not a paraphrase.** Show every resolved value per
action (addresses, decimals, venue, pool + fee tier, caps in base units and human terms, direction) as
one scannable table — the same shape that gets persisted. Then tell the user where it is saved, in one
line.

**Disclose before approval, each only when it applies:**

- **Bespoke Solidity (M > 0):** "This strategy uses <N> shared template(s) and <M> custom permission(s)
  your coding agent will author in Solidity — compiled and tested in `contracts/`, reviewed and signed
  by you." Say plainly that bespoke is deeper work (multi-generation venues, ABI drift, bare reverts);
  the authoring flow simulates against the real venue first, and `sailor-mandates`'s dark-reverts ladder
  and venue-cookbook exist for exactly this. It needs Foundry (`forge`). Say nothing when M = 0.
- **Approve coverage (any action needs one):** "<N> action(s) will also need an ERC-20 approval covered
  — the mandate will have more permissions than actions, not a 1:1 count." (See
  [`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md).)
- **Cadence (when not "no cadence"):** "Cadence is enforced by your agent's code, not by the mandate —
  the kernel has no notion of schedule; if the agent stops running, nothing fires."
- **Risk (every position-opening action):** run `sailor-risk` and state plainly any risk that can cross a
  bound the user set. Reported, never recommended — the user decides.

## Completeness gate (fail-closed — do not exit until every dimension is concrete)

| Dimension | Concrete means |
|---|---|
| Chains | Named chain IDs, each doctor-green. A missing chain → loop back to Station 1. |
| Tokens | Resolved address + decimals, per chain, per action, from `sailor-token-resolve`. Direction (tokenIn/tokenOut) explicit per action. |
| Venues/protocols | The exact DEX/router, lending market, vault, or recipients — address-resolved. Swaps also carry pool + fee tier + observed liquidity. |
| Route | Per action: which template, or "bespoke" — established in Act 2, carried into the artifact. |
| Amounts & caps | Per-tx cap AND total or per-period exposure, per action, in base units and human terms. |
| Cadence | Event-driven or scheduled — and the actual schedule or trigger. |
| Risk bounds | Category-specific (slippage floor, LTV ceiling, tolerance band), per action where they vary. |
| Exit condition | When the strategy stops accumulating. "Runs until revoked" only if the user says so explicitly. |
| Exit path | Per position-opening action: agent-managed, owner-managed, or declined. Never silently absent. |
| Provenance | When each token/pool was resolved, against which RPC per chain — so a stale artifact is detectable. |

## Spec format

One `.sail/strategies/<name>.md` per strategy — human-readable markdown plus one fenced JSON block.
**Copy and fill [references/strategy-template.md](references/strategy-template.md)** — it carries the
full JSON schema, the field-shape rules (which fields are swap-shaped and omit-able), and the version
notes. The markdown and JSON are the same data in two shapes; never let them drift. A complete worked
example (a two-chain DCA) is in [references/trading.md](references/trading.md).

## The category contract

A category file (a core `references/<category>.md`, or a project `.sail/recipes/<category>.md`) must
contain exactly three things: 2–3 archetypes with structural defaults, extension dimensions appended to
the core gate, and template routing. The full contract, the copy-me skeleton, and the two ways to add a
category (project vs. maintainer) live in [references/category-contract.md](references/category-contract.md).

## Handoff

Exit verifier: every dimension concrete (including each position-opening action's `exitPath`), the user
explicitly confirmed, `.sail/strategies/<name>.md` written with `"confirmedByUser": true` and
`"version": 3`, AND `strategies.json` created via `sailor strategy create`. Next: `sailor-mandate-planner`,
which routes each action of the spec to a shared template or bespoke authoring.

## Pitfalls

- **Do not re-elicit a complete spec.** If it is already `version: 3` and confirmed, confirm it — never
  redo Acts 1–3.
- **Never drop resolved values.** A token resolved once must carry its address/decimals/pool into the
  artifact; re-resolving at write time risks drift.
- **The exit-path question is the one that gets skipped.** It closes "the position cannot be unwound,"
  not "the user declined to build an exit leg."
- **Do not resolve ambiguity toward the easier build.** If two readings of intent differ, ask.
- **The JSON and the table are one datum.** Regenerate one from the other's values, never type them
  separately.
