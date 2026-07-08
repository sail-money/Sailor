---
name: sail-strategy
description: Station 2 — turn the user's intent into a complete, concrete strategy spec at .sail/strategy.md. Use when the user says "I want to DCA", "earn yield on my USDC", "rebalance my portfolio", "pay contributors weekly", "invest", "what should my agent do", or asks to define, plan, or change their strategy — and whenever .sail/strategy.md is missing or incomplete while mandate work is being requested. Elicits category → archetype → every completeness dimension (chains, tokens, venues, amounts, caps, cadence, risk bounds, exit condition); every token is resolved (address + decimals + liquidity) before it enters the spec.
---

# sail-strategy — make the strategy concrete (Station 2)

## Precondition (fail-closed)

Station 2 requires Station 1 complete. Run `sailor doctor` — if it is not green (RPC connected, chain-id matches, keys present, gas funded), hand back to [`sail-onboarding`](../sail-onboarding/SKILL.md) and return here once it passes.

Then read `.sail/strategy.md`. If it exists, every dimension in the completeness gate below is concrete, and its JSON block has `"confirmedByUser": true` — this station is already done: confirm the existing spec with the user instead of re-eliciting. If it exists but is incomplete, resume from the gaps only.

## Role

You are an interviewer and a scribe, not an investment advisor. Never recommend what to invest in, never predict returns, never rank assets or venues by expected performance. The user decides WHAT; this station makes it CONCRETE; the protocol makes it SAFE.

## The three acts

### Act 1 — ORIENT

Present the three doors — but skip the menu entirely if the user's opening message already names a category or archetype; never ask what was already said:

- **Trading** — spot, DCA, rebalancing → [references/trading.md](references/trading.md)
- **Yield** — lending, borrowing, liquidity providing, looping → [references/yield.md](references/yield.md)
- **Payments & treasury** — transfers, scheduled moves, operational flows → [references/payments.md](references/payments.md)

…or anything else on-chain — permissions are arbitrary Solidity; if it's on-chain, it can be bounded. A strategy outside the three doors is welcome: it still gets a complete spec here, and routes to bespoke mandate authoring at Station 3.

### Act 2 — SPECIFY

Load the matching reference file and offer its archetypes — an archetype pre-fills structural defaults for most dimensions. Defaults are **structural only** (cadences, band widths, caps as a fraction of allocated capital, conservative LTV): never an invented venue or token address, never an asset recommendation. Wherever a real address is needed, resolve it or elicit it.

Fill the dimensions by **infer-then-confirm**: extract everything the user's words already imply, draft the spec with each inference marked as such, and ask only about the genuine gaps — batched into few questions, never an interrogation.

**Resolve every token before it enters the spec.** Run [`sail-token-resolve`](../sail-token-resolve/SKILL.md) for each token: on-chain address, decimals, and where the liquidity lives. No symbol is ever written into the spec unresolved.

### Act 3 — CONFIRM

Render the full spec, walk the completeness checklist below with the user, get their explicit confirmation, then write `.sail/strategy.md`.

## Completeness gate (fail-closed — the station does not exit until every dimension is concrete)

| Dimension | Concrete means |
|---|---|
| Chains | Named chain IDs, each doctor-green. If the strategy needs a chain this project isn't configured for, loop back to Station 1 to add it before proceeding. |
| Tokens | Resolved address + decimals, per chain — from `sail-token-resolve`, never from memory. |
| Venues/protocols | The exact DEX/router, lending market, vault, or recipient set — named and address-resolved. |
| Amounts & caps | Per-tx cap AND total or per-period exposure, in the token's base units. |
| Cadence | Event-driven or scheduled — and the actual schedule or trigger. |
| Risk bounds | Category-specific (slippage floor, LTV ceiling, tolerance band, …) — the reference file's extension dimensions. |
| Exit condition | When the strategy stops or unwinds, and where funds go. "No exit condition — runs until revoked" is acceptable ONLY if the user says it explicitly. |

## Spec format — `.sail/strategy.md`

Human-readable markdown (title, category, archetype, one-paragraph intent in the user's own words, the dimensions as a table) plus **one** fenced ```json block carrying the machine form. Later stations read the JSON; the markdown is for humans.

```json
{
  "category": "trading | yield | payments | custom",
  "archetype": "<archetype id or 'custom'>",
  "chains": [<chainId>, ...],
  "tokens": [{ "symbol": "", "address": "0x…", "decimals": 0, "chain": 0 }],
  "venues": [{ "name": "", "address": "0x…", "chain": 0 }],
  "caps": { "perTx": "<base units>", "...": "per-period exposures as elicited" },
  "cadence": "<event-driven trigger or schedule>",
  "riskBounds": { "...": "category-specific, e.g. maxSlippageBps, maxLtvBps" },
  "exitCondition": "<when it stops/unwinds and where funds go>",
  "confirmedByUser": true,
  "version": 1
}
```

A complete worked example (small DCA with real Unichain addresses) is in [references/trading.md](references/trading.md).

## The category contract

Every `references/<category>.md` must contain exactly three things:

1. **2–3 archetypes**, each with pre-filled structural defaults for most dimensions.
2. **Extension dimensions** — the category-specific rows appended to the core completeness gate.
3. **Template routing** — which live template skill (or bespoke authoring) each action of the category maps to, with capability limits stated from the template's own schema.

Adding a category to Sailor = one door line in `AGENTS.md` + one conforming reference file here + one routing row in the mandate planner. Nothing else changes.

## Handoff

Exit verifier: every dimension concrete, user explicitly confirmed, `.sail/strategy.md` written with `"confirmedByUser": true`. Next: **Station 3 — [`sail-mandate-planner`](../sail-mandate-planner/SKILL.md)**, which routes each action of the spec to a shared template or bespoke authoring.
