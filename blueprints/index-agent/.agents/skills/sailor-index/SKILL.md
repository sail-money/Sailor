---
name: sailor-index
description: "Define an index strategy: hold a weighted basket of assets (tokens and tokenized stocks) across the chains their liquidity needs, rebalance to global target weights, and fund it through one consolidated plan. Use when the user wants an auto-investing index agent, or to change an existing basket."
station: strategy
---

# sailor-index — the index strategy (assets, weights, chains, funding)

## First contact

On a fresh project (no `.sail/index.json` yet), deliver
[references/welcome-script.md](references/welcome-script.md) verbatim before doing anything else.
It establishes identity, what the agent does, the safety promise, and the four-step journey — whose
first step is account setup, not the basket. Do not elicit the basket until Station 1 is complete:
`doctor` green (SMA deployed, agent wallet created, RPC connected). Route account setup to
`sailor-onboarding`; the basket questions below unlock only after it passes.

## What this owns

The index strategy definition. It turns the user's intent ("hold these assets at these weights")
into a concrete spec. The user names the **assets and weights**; the agent derives the **chains and
funding** from where each asset actually has liquidity. This is the core promise: **the user gives
a portfolio, the agent guides everything else.**

It owns:

- the **basket**: the assets and their target weights (they sum to 1.0). An asset may be a token or
  a tokenized stock — both are resolved the same way, both are held the same way.
- the **chains**: the set of chains the SMA is deployed on (a user decision at account setup), plus
  the chains the basket's liquidity *requires* — with the agent guiding the user to add a chain to
  the SMA when one is needed but missing.
- the **funding plan**: the minimum set of deposits (per settlement currency) that covers every
  asset, presented as one consolidated instruction.
- the **rebalance band**: how far a weight may drift before the agent trades.
- the **routing policy**: prefer one chain for cost, move an asset to another chain when its
  liquidity is too thin for the trade size.

It does not own:

- the mandate that enforces the swaps (`sailor-mandate-planner`),
- the bridge permission that moves USDC between chains (`sailor-cctp-bridge`),
- the runtime loop (`sailor-agent-build`).

It is not an investment advisor. The user names the assets and weights; this skill makes them
concrete; the protocol makes them safe. Never recommend an asset, never predict returns, never rank.

## When to use

- The user wants to create or change an index strategy.
- `sailor harbor create index` routes here as the entry skill.
- A spec exists but is incomplete or predates the current schema.

## Precondition (fail-closed)

Station 1 must be complete. Run `sailor doctor`; if it is not green (SMA deployed, keys present,
gas funded), hand back to `sailor-onboarding` and return once it passes. Then read
`.sail/strategies/*.md` and confirm an existing complete spec instead of re-eliciting it.

## The acts

### Act 1 — ORIENT

Confirm the intent is an index: hold a weighted basket of assets and keep it rebalanced toward
target weights. If the user names a different intent (pure yield, a one-off trade, payments), route
to the matching category instead of forcing the index shape.

### Act 2 — SPECIFY (the user gives the portfolio; the agent guides)

Elicit in the user's financial words. All decisions the user makes, none inferred:

1. **Basket** — the assets and target weights (sum to 1.0). Assets may be tokens (WETH, ARB,
   MORPHO) or tokenized stocks (NVDA, SPY, TSLA) — anything available on our chains. Resolve every
   asset with `sailor-token-resolve`; carry its address, decimals, liquidity map, and **funding
   path** into the spec (see `references/funding-paths.md`).
2. **Funding mode** — ask: "Do you want your deposits invested every time they arrive, or a set
   amount bought automatically on a schedule?" Two answers:
   - **Invest on deposit** (default) — every deposit is invested across the basket on the next run.
   - **Cadence DCA** — buy a fixed dollar amount every period (e.g. $500 every week); the rest stays
     as the funding pool. Record the amount and period.
3. **Rebalance band** — how far a weight may drift before the agent trades (default ±5pp).
4. **Rebalance cadence** — how often the agent trims overweight holdings: every run (default),
   daily, weekly, or monthly. Recorded as `rebalancePeriodSec`. Buying toward target stays
   continuous so deposits are invested promptly.
5. **Reports** — ask: "Do you want a periodic Telegram report?" If yes, ask the cadence. Secrets
   (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) go in `.sail/.env.local`, never the spec.

The agent then derives the rest (this is the "I guide you" part, never a question to the user):

#### 2a. Derive the required chains from the basket

Resolve each asset and read its liquidity home. The basket *requires* every chain where an asset
is routable that the user wants to hold it on. Chains are the agent's routing surface, not a menu
the user is asked to choose from.

#### 2b. Chain gap → tell the user to deploy the SMA there

Compare the required chains against the SMA's current chain set. If the basket needs a chain the
SMA is not deployed on, **say so plainly and route to `sailor-onboarding`** to deploy the SMA on
that chain before proceeding. This is the one place the agent directs the user to act on chains:

> Your index holds NVDA, which lives on Robinhood Chain. Deploy your SMA on Robinhood and I'll take
> it from there.

**Recommend chains only when the basket needs them, never before:**

- **Robinhood** is recommended **only when the basket contains tokenized stocks.** A crypto-only
  basket never mentions Robinhood.
- **BNB Smart Chain** is recommended **only when a token has its only (or deepest) liquidity there.**
- The 7 USDC chains (Ethereum, Optimism, Arbitrum, Base, Unichain, World Chain, HyperEVM) are
  covered by one deposit; the agent routes within them silently, no per-chain guidance.

#### 2c. Build the consolidated funding plan

From `references/funding-paths.md`, compute the minimum funding set: one line per settlement
currency the basket actually touches. Present it as a single instruction, never a menu:

> Send USDC to `0x…` (Base) for the crypto side, and USDG to `0x…` (Robinhood) for the stocks side.

A pure-crypto basket is still one USDC line. The agent never asks the user to pick a currency or
choose "bridge vs fund direct" — those are agent decisions.

### Act 3 — CONFIRM

Render the full spec (basket, chains, funding plan, band, routing policy), walk the completeness
gate, get explicit confirmation, then write `.sail/strategies/<name>.md` with the index envelope and
derive `.sail/index.json` from it (see `references/index-config.md`). Disclose before approval, each
only when it applies: the bespoke bridge permission, approve coverage, that trading is triggered by
the agent's code rather than enforced on-chain, and any risk that crosses a bound the user set
(report via `sailor-risk`, never recommend).

## Completeness gate

Every dimension concrete before confirming:

| Dimension | Concrete means |
|---|---|
| Basket | assets resolved (address + decimals) with weights summing to 1.0 |
| Chains | every required chain is doctor-green and the SMA is deployed on it (gap → user deploys first) |
| Funding plan | minimum deposit set stated, per settlement currency (USDC / USDG / USDT) |
| Funding mode | invest-on-deposit (default) or cadence DCA with amount + period, stated |
| Rebalance band | ± percentage points, stated |
| Rebalance cadence | every run (default) or a period in seconds, stated |
| Reports | on or off; if on, cadence + channel stated |
| Routing policy | preferred chain + liquidity threshold, stated |
| Feasibility | every basket asset has a routable pool on at least one named chain (from `sailor-token-resolve`) |

## Routing (how each action maps)

| Action | Route |
|---|---|
| Buy toward weight, or rebalance sell | `sailor-templates` (swap-no-oracle) by default; (swap) only when size vs depth warrants the oracle tier |
| Live quote + slippage floor | `sailor-swap-quote` |
| Liquidity + chain routing | `sailor-token-resolve` |
| Move USDC to another named chain | `sailor-cctp-bridge` (bespoke CCTP permission) |
| Stock token buy on Robinhood (USDG) | `sailor-templates` (swap) against USDG on Uniswap; no bridge — USDG is funded direct |

## Handoff

Exit verifier: every dimension concrete, the user confirmed, `.sail/strategies/<name>.md` written
with the index envelope, and `.sail/index.json` derived from it (see `references/index-config.md`).
Then:

1. `sailor-onboarding` deploys the SMA on every required chain (including any the user was guided
   to add).
2. `sailor-mandate-planner` registers and configures the swap permission (per chain, per asset).
3. `sailor-cctp-bridge` authors, deploys, simulates, and registers the bridge permission when the
   chain set spans more than one USDC chain.
4. Run the agent — the pre-built runtime (`src/agent.ts`) reads `.sail/index.json` and drives the loop.
5. Surface the pre-built dashboard (`pnpm dashboard`, a local read-only page at a local port) and,
   if the user opted into reports, confirm the Telegram report arrives. The dashboard title is a
   user parameter; write it to `.sail/dashboard.json` (`{ "title": "…" }`).

## Pitfalls

- Never recommend an asset or a weight; the user names the basket.
- Weights must sum to exactly 1.0. A basket that does not sum is rejected at the gate.
- An asset with no routable pool on any named chain cannot be held; surface it, never silently drop it.
- Recommend Robinhood only for stock baskets, and BNB only when a token's liquidity demands it. A
  crypto-only basket is one USDC deposit and never mentions either.
- The agent never asks the user to pick a currency or a bridge path. It computes the funding plan.
- The routing decision is live, not frozen at plan time. Record the policy, not the moment's outcome.
- No primary chain. Chains are derived from liquidity, guided by the agent, not asked as a menu.
