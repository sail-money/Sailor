---
name: sailor-strategy
description: Station 2 — turn the user's intent into a complete, concrete strategy spec at .sail/strategy.md. Use when the user says "I want to DCA", "earn yield on my USDC", "stake my ETH", "rebalance my portfolio", "pay contributors weekly", "invest", "what should my agent do", or asks to define, plan, or change their strategy — and whenever .sail/strategy.md is missing or incomplete while mandate work is being requested. Elicits the intent in the user's own financial terms, then every completeness dimension (chains, tokens, venues, amounts, caps, cadence, risk bounds, exit condition); routing to templates or bespoke follows the intent, never leads it. Every token is resolved (address + decimals + liquidity) before it enters the spec.
---

# sailor-strategy — make the strategy concrete (Station 2)

## Precondition (fail-closed)

Station 2 requires Station 1 complete. Run `sailor doctor` — if it is not green (RPC connected, chain-id matches, keys present, gas funded), hand back to [`sailor-onboarding`](../sailor-onboarding/SKILL.md) and return here once it passes.

Then read `.sail/strategy.md`. If it exists, every dimension in the completeness gate below is concrete, its JSON block has `"confirmedByUser": true`, AND `"version": 2` — this station is already done: confirm the existing spec with the user instead of re-eliciting. An older `version` (or none) predates the resolved-artifact schema below — its addresses/pools were never captured, so treat it as incomplete and re-run Act 2/3 to backfill the current shape. If it exists but is incomplete, resume from the gaps only.

## Role

You are an interviewer and a scribe, not an investment advisor. Never recommend what to invest in, never predict returns, never rank assets or venues by expected performance. You ARE a DeFi specialist on mechanics and safe usage — how venues work, what a bound protects against, where trust assumptions live — and you say so freely; the advisor line forbids opinions on merits, never expertise on safety. The user decides WHAT; this station makes it CONCRETE; the protocol makes it SAFE.

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

**Routing aids — consult, never force.** When a category reference fits the intent, use it: its archetypes pre-fill structural defaults, and its routing rows are Station 3's canon for that category. When none fits — or the intent is exotic or unclear — consult [references/possibility-map.md](references/possibility-map.md): it maps financial goals to the bound shapes that enforce them, and routes each action to a template or to bespoke authoring. **Lazy-loading rule: a plain DCA / deposit / payment never loads the map.** Defaults from any aid are **structural only** (cadences, band widths, caps as a fraction of allocated capital, conservative LTV): never an invented venue or token address, never an asset recommendation.

**Routing is per-action, whatever the category.** An action a shared template can express routes to that template; one it cannot routes to bespoke authoring at Station 3 — the protocol working as designed, not a detour. A `category: "custom"` strategy still gets the full completeness gate, and its actions still route individually: a custom strategy with a plain swap leg uses the swap template for that leg. Establish each action's route during this act — Act 3's disclosures count on it. **When intent is ambiguous between readings, ask — never resolve ambiguity toward the reading that is easier to build.**

Fill the dimensions by **infer-then-confirm**: extract everything the user's words already imply, draft the spec with each inference marked as such, and ask only about the genuine gaps — batched into few questions, never an interrogation.

**Resolve every token before it enters the spec.** Run [`sailor-token-resolve`](../sailor-token-resolve/SKILL.md) for each token: on-chain address, decimals, and where the liquidity lives. No symbol is ever written into the spec unresolved. **Carry the resolution forward, don't discard it.** `sailor-token-resolve`'s output already carries the token address/decimals, the chosen venue, the pool address, its fee tier, and its observed liquidity — hold onto that output per action; Act 3 writes it into the artifact verbatim. Never re-resolve at write time, and never let a resolved value fall back to "USDC→WETH" prose with the addresses dropped.

### Act 3 — CONFIRM

Render the full spec, walk the completeness checklist below with the user, get their explicit confirmation, then write `.sail/strategy.md`.

**The confirmation surface is the resolved artifact, not a paraphrase.** What the user reviews before approving must show every resolved concrete value per action — token addresses, decimals, venue/router address, pool address + fee tier, the cap in both human terms and base units, direction (tokenIn→tokenOut, explicit, never implied by list order) — as one scannable table, the same shape that gets persisted (see "Spec format" below). This is the trust artifact: "here is exactly what your agent will be bounded to do, in concrete terms — confirm this is right." Showing only the human-level intent ("USDC→WETH, $25/day") without the resolved addresses is not a complete Act 3 render, whether or not the user asked for the addresses explicitly. This composes with, and does not replace, the disclosures below.

**Persist AND say where.** Immediately after confirmation, write `.sail/strategy.md` in the format below, then tell the user in one line: "Saved to `.sail/strategy.md` — the full resolved detail (addresses, pools, caps) lives there if you want to check it later." Resolution and persistence happen regardless of whether the strategy arrived via full elicitation or the pre-specified fast path — the fast path still resolves every token and still writes the artifact; it only skips the back-and-forth, never the resolution or the write.

**Disclose bespoke Solidity before the user approves.** Using the per-action routes established in Act 2 (from the category reference's routing rows, or the possibility map), count how many of the spec's actions map to a shared template vs. bespoke authoring. If any action is bespoke (M > 0), the confirmation summary must say so plainly before they approve:

> This strategy uses <N> shared template(s) and <M> custom permission(s) that your coding agent will author in Solidity — compiled and tested in `contracts/`, reviewed and signed by you.

Show this line **only when M > 0**. A fully template-backed strategy (M = 0) says nothing about Solidity — most strategies never touch it.

**Disclose approve-coverage impact before the user approves.** Check the spec's actions against [`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md) — protocol permissions never cover the ERC-20 `approve()` their call depends on. If any action needs one, say so plainly, without the execution-model detail (per-call vs. atomic batch is decided at Station 3, not here):

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
| Exit condition | When the strategy stops or unwinds, and where funds go. "No exit condition — runs until revoked" is acceptable ONLY if the user says it explicitly. |
| Provenance | When each token/pool was resolved, and against which RPC per chain — so a stale artifact (a pool that's moved, a resolution from weeks ago) is detectable before it's trusted. |

## Spec format — `.sail/strategy.md`

Human-readable markdown (title, category, archetype, one-paragraph intent in the user's own words, a strategy-wide dimensions table, and an **Actions** table — one row per action, the resolved detail: route, direction with addresses, venue/pool, caps in both forms, risk bounds) plus **one** fenced ```json block carrying the machine form. Later stations read the JSON; the markdown is for humans. The two are the same data in two shapes — never let them drift (the JSON is regenerated from the same resolved values the table renders, not typed separately).

Every action carries its own `tokenIn`/`tokenOut`/`venue`/`pool`/`caps`/`riskBounds` — a strategy is one or more actions, and two actions (even the "same" swap on two chains, as in a multi-chain DCA) never share one entry, because their addresses differ per chain.

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
      "riskBounds": { "...": "action-specific, e.g. maxSlippageBps, maxLtvBps" }
    }
  ],
  "cadence": "<event-driven trigger or schedule>",
  "exitCondition": "<when it stops/unwinds and where funds go>",
  "provenance": {
    "resolvedAt": "<ISO 8601 UTC, e.g. '2026-07-10T21:14:00Z'>",
    "chains": { "<chainId>": { "rpc": "<label — which RPC endpoint/provider resolved this chain>" } }
  },
  "confirmedByUser": true,
  "version": 2
}
```

`tokenOut`/`venue`/`pool` are swap-shaped fields — omit them on an action whose `kind` doesn't have them (a `transfer`/`withdraw` action has `tokenIn` + `recipients`, no `tokenOut`/`pool`; a `deposit`/`borrow` action has `tokenIn` + `venue`, no `pool` unless the market itself is a pool). Never emit an empty placeholder for a field that doesn't apply — omit the key.

`version: 2` is the resolved-artifact schema in this section (per-action `actions[]`, `provenance`). A file written under `version: 1` (flat top-level `tokens`/`venues`/`caps`, no per-action route/pool/provenance) predates it — see the precondition above.

A complete worked example (small DCA with real Unichain addresses) is in [references/trading.md](references/trading.md).

## The category contract

Every `references/<category>.md` must contain exactly three things:

1. **2–3 archetypes**, each with pre-filled structural defaults for most dimensions.
2. **Extension dimensions** — the category-specific rows appended to the core completeness gate.
3. **Template routing** — which live template skill (or bespoke authoring) each action of the category maps to, with capability limits stated from the template's own schema.

Adding a category to Sailor = one door line in `AGENTS.md` + one conforming reference file here + one routing row in the mandate planner. Nothing else changes. ([references/possibility-map.md](references/possibility-map.md) is not a category reference — it is the cross-category routing aid and follows its own format.)

## Handoff

Exit verifier: every dimension concrete, user explicitly confirmed, `.sail/strategy.md` written with `"confirmedByUser": true` and `"version": 2` — the resolved summary presented to the user AND persisted, not just the latter. Next: **Station 3 — [`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)**, which routes each action of the spec to a shared template or bespoke authoring.
