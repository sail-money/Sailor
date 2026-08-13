---
name: sailor-index
description: Define an index strategy: deposit USDC, hold a weighted token basket across the user's chosen chains, rebalance to global target weights, and route buys to the chain with enough liquidity. Use when the user wants an auto-investing index agent, or to change an existing basket.
station: strategy
---

# sailor-index — the index strategy (basket, weights, chains, routing)

## What this owns

The index strategy definition. It turns the user's intent ("hold this basket at these percentages, across these chains") into a concrete spec, using the index category in [references/index-category.md](references/index-category.md) and the general strategy flow in `sailor-strategy`.

It owns:

- the **basket**: the tokens and their target weights (they sum to 1.0),
- the **chains**: the user-named chain set, with no primary chain,
- the **rebalance band**: how far a weight may drift before the agent trades,
- the **routing policy**: prefer one chain for cost, move a token to another chain when its liquidity is too thin for the trade size.

It does not own:

- the mandate that enforces the swaps (`sailor-mandate-planner`),
- the bridge permission that moves USDC between chains (`sailor-cctp-bridge`),
- the runtime loop (`sailor-agent-build`).

It is not an investment advisor. The user names the basket and weights; this skill makes them concrete; the protocol makes them safe. Never recommend a token, never predict returns, never rank assets.

## When to use

- The user wants to create or change an index strategy.
- `sailor harbor create index` routes here as the entry skill.
- A spec exists but is incomplete or predates the current schema.

## Precondition (fail-closed)

Station 1 must be complete. Run `sailor doctor`; if it is not green (RPC connected, keys present, gas funded), hand back to `sailor-onboarding` and return once it passes. Then read `.sail/strategies/*.md` and confirm an existing complete spec instead of re-eliciting it.

## The three acts

### Act 1 — ORIENT

Confirm the intent is an index: deposit USDC, hold a weighted basket, and keep it rebalanced toward target weights. If the user names a different intent (pure yield, a one-off trade, payments), route to the matching category instead of forcing the index shape.

### Act 2 — SPECIFY

Elicit in the user's financial words. The index-specific fields, all user decisions, none inferred:

1. **Basket** — the tokens and target weights. Weights must sum to 1.0. Resolve every token with `sailor-token-resolve` and carry its address, decimals, and liquidity map into the spec.
2. **Chains** — the chain set the agent may use, any subset of the supported chains. No primary chain. Each named chain must be doctor-green.
3. **Deposit** — USDC, and the chains the user will fund it on.
4. **Funding mode** — ask the user straight: "Do you want your USDC invested every time you send it, or do you want a set amount bought automatically on a schedule?" Two answers:
   - **Invest on deposit** (the default) — every time USDC arrives, the next tick invests it across the basket.
   - **Cadence DCA** — buy a fixed dollar amount every period (for example $500 every week); the rest of the USDC stays as the funding pool. Record the amount and period.
5. **Rebalance band** — how far a weight may drift before the agent trades (default ±5 percentage points).

Then establish the **routing policy**: the preferred chain (cheapest to operate, usually where USDC already sits), and the liquidity threshold that moves a token to another chain (the slippage that would move the price too far for the trade size). This policy is fixed in the spec; the decision of which chain holds each buy is made live at each tick, so a token can move chains as conditions change without changing the mandate.

### Act 3 — CONFIRM

Render the full spec (basket table, chains, band, routing policy), walk the index completeness gate, get explicit confirmation, then write `.sail/strategies/<name>.md` with the index envelope from `index-category.md`, and derive `.sail/index.json` from it (see `references/index-config.md`). Disclose before approval, each only when it applies: the bespoke bridge permission, approve coverage, that trading is triggered by the agent's code rather than enforced on-chain, and any risk that crosses a bound the user set (report via `sailor-risk`, never recommend).

## Index completeness gate

Every dimension concrete before confirming:

| Dimension | Concrete means |
|---|---|
| Basket | tokens resolved (address + decimals) with weights summing to 1.0 |
| Chains | named chain ids, each doctor-green, the SMA deployable on each |
| Deposit | USDC resolved per chain |
| Funding mode | invest-on-deposit (default) or cadence DCA with amount + period, stated |
| Rebalance band | ± percentage points, stated |
| Routing policy | preferred chain + liquidity threshold, stated |
| Feasibility | every basket token has a routable USDC pool on at least one named chain (from `sailor-token-resolve`) |

## Routing (how each action maps)

| Action | Route |
|---|---|
| Buy toward weight, or rebalance sell | `sailor-templates` (swap-no-oracle) by default; (swap) only when size vs depth warrants the oracle tier |
| Live quote + slippage floor | `sailor-swap-quote` |
| Liquidity + chain routing | `sailor-token-resolve` |
| Move USDC to another named chain | `sailor-cctp-bridge` (bespoke CCTP permission) |

## Handoff

Exit verifier: every dimension concrete, the user confirmed, `.sail/strategies/<name>.md` written
with the index envelope, and `.sail/index.json` derived from it (see `references/index-config.md`). Then:

1. `sailor-onboarding` deploys the SMA on every named chain.
2. `sailor-mandate-planner` registers and configures the swap permission (per chain, per token).
3. `sailor-cctp-bridge` authors, deploys, simulates, and registers the bridge permission when the
   chain set spans more than one chain.
4. Run the agent — the pre-built runtime (`src/agent.ts`) reads `.sail/index.json` and drives the loop.

## Pitfalls

- Never recommend tokens or weights; the user names the basket.
- Weights must sum to exactly 1.0. A basket that does not sum is rejected at the gate.
- A token with no routable USDC pool on any named chain cannot be held; surface it, never silently drop it.
- The routing decision is live, not frozen at plan time. Record the policy, not the moment's outcome.
- No primary chain. Do not default to Ethereum or any other chain; ask which chains the user wants.
