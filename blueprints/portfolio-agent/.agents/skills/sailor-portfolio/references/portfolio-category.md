# Portfolio — archetype, extension dimensions, routing

A routing aid consulted when the intent fits the **portfolio** category: hold a weighted basket of
assets, and rebalance toward global target weights across the chains their liquidity needs.
Conforms to the category contract in `sailor-strategy` (archetypes + structural-only defaults +
extension dimensions + routing).

## Archetype

### Portfolio — hold a weighted basket, rebalance to target

Two behaviors, one loop:

1. **Invest** — deploy capital into the basket. How capital enters is the user's one funding choice:
   - **Invest on deposit** — any idle funding is deployed across the basket in proportion to the target weights.
   - **Cadence DCA** — a fixed dollar amount is bought every period, split across assets by target weight.
2. **Rebalance** — when an asset's actual weight drifts past its band, sell it down to the settlement
   currency, and that flows back into the underweight assets.

The distinguishing properties, all user decisions, none inferred:

- **Basket** — N assets with target weights that sum to 1.0. The user names the assets and weights.
  An asset is a token (WETH, ARB, MORPHO) or a tokenized stock (NVDAc, AAPLc on Base; Robinhood stock
  tokens) — both are assets, resolved and held the same way.
- **Chains** — the set of chains the SMA is deployed on (a user decision at account setup), extended
  to cover every chain the basket's liquidity requires. The agent guides the user to add a chain to
  the SMA when a needed one is missing.
- **Global weights** — one portfolio across every named chain. The target weight of an asset is the
  same regardless of which chain physically holds it. Which chain holds an asset is the agent's
  *routing* decision, not part of the user's goal.
- **Liquidity-aware routing** — the agent prefers to act on a single chain (cheapest to operate, no
  bridge cost), and routes an asset's buy to another named chain only when liquidity on the preferred
  chain is too thin for the trade size.

Defaults (structural only — never a venue, asset, or address): funding mode = invest-on-deposit (the
default; switch to cadence DCA by naming an amount + period); rebalance band = ±5 percentage points
around each target weight; per-tx cap = `bridge.maxPerTxUsd` (and the largest rebalance leg the band
implies); `maxSlippageBps` = 100. The user supplies: the basket + weights, the funding mode, and the
rebalance band.

## Extension dimensions (append to the core gate)

| Dimension | Concrete means |
|---|---|
| Basket | asset set + target weights (sum to 1.0), each resolved via `sailor-token-resolve` |
| Chains | the SMA's deployed chain set, extended to cover every required chain, each doctor-green |
| Deposit asset | the settlement currency per chain (USDC / USDG / USDT), resolved address + decimals per chain — see `references/funding-paths.md` |
| Funding mode | invest-on-deposit (default) or cadence DCA (amount + period), the user's one funding choice |
| Routing rule | per asset: the preferred chain, and the liquidity threshold (slippage / depth vs trade size) that triggers a move to another chain |
| Rebalance band | ± percentage points around each target weight that a weight must leave before the agent trades |

## Routing (Station 3 reads this)

| Action | Route |
|---|---|
| Bounded swap (buy toward weight, or rebalance sell) | `sailor-templates` (swap-no-oracle) by default; `sailor-templates` (swap) only when size vs pool depth warrants the oracle tier (see `sailor-strategy` → trading, price-source decision) |
| Live quotes / `amountOutMinimum` sizing | `sailor-swap-quote` |
| Liquidity + chain routing | `sailor-token-resolve` (`chainsWithLiquidity`, `deepestChain`, `crossChain.action`) |
| Bridge USDC to another named chain | bespoke CCTP permission, authored via the `sailor-cctp-bridge` skill (cross-chain only; see that skill) |
| Stock token buy on Base (USDC) | `sailor-templates` (swap) against USDC on Aerodrome/Uniswap — same leg as every other Base asset |
| Stock token buy on Robinhood (USDG) | `sailor-templates` (swap) against USDG on Uniswap; USDG is funded direct, no bridge (optional alternative) |
| Swap's approve coverage | owner-set approval sized to a year of trading (one Safe signature at setup, amount per the sizing rule below); agent-managed bounded approve is the alternative for a user who wants zero standing allowance |

## Approve model — owner-set, sized to a year (default)

The swap router pulls the SMA's settlement currency on every buy, so the router needs an allowance.
The default is **owner-set**: the owner signs one `approve` on the Safe at setup, sized to a year of
trading, and the agent trades inside it. It is not per-trade (a signature before every buy is the bad
UX the founder rejected) and not infinite (a ceiling caps what a compromised agent could move even
when the mandate cannot name every token).

**Sizing.** Approve, on each chain's settlement currency, an amount equal to **twice the expected
12-month inflow**, rounded up. Twice covers rebalancing churn (sells that flow back into buys) with
margin. Concretely:

- **Invest-on-deposit** (the default): `2 × (initial deposit + 12 × expected monthly deposit)`. With no
  recurring deposits planned, `2 × initial deposit`.
- **Cadence DCA**: `2 × dca.amountUsd × periods per year`.

There are two approvals, both sized the same way: one USDC `approve(router, amount)` per chain the SMA
trades on (the buy leg), and one `approve(router, amount)` per basket token on its chain (the sell leg).

The runtime records the ceiling (`approval.ceilingUsd` in `portfolio.json`) and the report warns when the
remaining allowance drops below a quarter, so the owner tops up with one signature before the agent
would ever stall. The alternative — agent-managed, where the agent grants its own bounded approve under
a registered permission — stays available for a user who wants zero standing allowance; both models are
detailed in `sailor-mandates/references/approvals.md` ("Swaps are a special case").

## Spec schema (portfolio-specific)

The `sailor-strategy` core schema holds the actions and per-action values. A portfolio strategy adds these to the
spec's JSON block, in the `strategy` envelope the runtime reads:

```jsonc
{
  // ... core identity + actions (one swap action per token per chain actually used)
  "portfolio": {
    "depositAsset": { "symbol": "USDC", "decimals": 6 },
    "basket": [
      { "symbol": "WETH",  "weight": 0.4, "chains": [8453, 42161] },
      { "symbol": "UNI",   "weight": 0.3, "chains": [8453] },
      { "symbol": "MORPHO", "weight": 0.3, "chains": [8453, 130] }
    ],
    "chains": [8453, 42161, 130],
    "dca": { "amountUsd": 500, "periodSec": 604800 },
    "rebalanceBandBps": 500,
    "maxSlippageBps": 100
  }
}
```

- **`basket[].weight`** sums to 1.0 across the basket. Global — not per chain.
- **`basket[].chains`** is the token's *candidate* chain set; the runtime picks the cheapest/liquid route within it.
- **`chains`** is the full user-named set; the SMA is deployed on each before the loop runs.
- The routing **policy** (prefer one chain; move a token when its liquidity is too thin for the trade size) is fixed
  in the spec. The routing **decision** (which chain holds a given buy this tick) is made at tick time from live
  liquidity, so a token can move chains as conditions change without any change to the mandate.

## Feasibility (verify, don't advise)

Every basket token must have a routable USDC pool on at least one named chain — `sailor-token-resolve` answers
this. A token with no routable pool on any named chain cannot be held: drop it, add a chain where it is routable,
or route it bespoke. Never recommend *which* tokens to hold; the user names the basket.
