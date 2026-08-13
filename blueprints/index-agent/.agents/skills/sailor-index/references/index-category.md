# Index — archetype, extension dimensions, routing

A routing aid consulted when the intent fits the **index** category: deposit one stablecoin, hold a weighted
token basket, and rebalance toward global target weights across the user's chosen chains. Conforms to the
category contract in `sailor-strategy` (archetypes + structural-only defaults + extension dimensions + routing).

## Archetype

### Index — deposit USDC, hold a weighted basket, rebalance to target

Two behaviors, one loop:

1. **Invest** — deploy capital into the basket. How capital enters is the user's one funding choice:
   - **Invest on deposit** — any idle USDC is deployed across the basket in proportion to the target weights.
   - **Cadence DCA** — a fixed dollar amount is bought every period, split across tokens by target weight.
2. **Rebalance** — when a token's actual weight drifts past its band, sell it down to USDC, and that USDC flows back into the underweight tokens.

The distinguishing properties, all user decisions, none inferred:

- **Basket** — N tokens with target weights that sum to 1.0. The user names the tokens and weights.
- **Chains** — a user-named set of chain ids (any subset of the supported chains). Chains are a parameter,
  exactly like tokens. There is no primary chain.
- **Global weights** — one portfolio across every named chain. The target weight of a token is the same
  regardless of which chain physically holds it. Which chain holds a token is the agent's *routing* decision,
  not part of the user's goal.
- **Liquidity-aware routing** — the agent prefers to act on a single chain (cheapest to operate, no bridge cost),
  and routes a token's buy to another named chain only when liquidity on the preferred chain is too thin for the
  trade size (slippage would move the price past the user's bound). Per token, so different tokens can live on
  different chains.

Defaults (structural only — never a venue, token, or address): funding mode = invest-on-deposit (the default;
switch to cadence DCA by naming an amount + period); rebalance band = ±5 percentage points around each target
weight; per-tx cap = `bridge.maxPerTxUsd` (and the largest rebalance leg the band implies); `maxSlippageBps` = 100.
The user supplies: the basket + weights, the chains, the funding mode, and the rebalance band.

## Extension dimensions (append to the core gate)

| Dimension | Concrete means |
|---|---|
| Basket | token set + target weights (sum to 1.0), each resolved via `sailor-token-resolve` |
| Chains | user-named chain ids, each doctor-green |
| Deposit asset | USDC (the stablecoin), resolved address + decimals per chain |
| Funding mode | invest-on-deposit (default) or cadence DCA (amount + period), the user's one funding choice |
| Routing rule | per token: the preferred chain, and the liquidity threshold (slippage / depth vs trade size) that triggers a move to another chain |
| Rebalance band | ± percentage points around each target weight that a weight must leave before the agent trades |

## Routing (Station 3 reads this)

| Action | Route |
|---|---|
| Bounded swap (buy toward weight, or rebalance sell) | `sailor-templates` (swap-no-oracle) by default; `sailor-templates` (swap) only when size vs pool depth warrants the oracle tier (see `sailor-strategy` → trading, price-source decision) |
| Live quotes / `amountOutMinimum` sizing | `sailor-swap-quote` |
| Liquidity + chain routing | `sailor-token-resolve` (`chainsWithLiquidity`, `deepestChain`, `crossChain.action`) |
| Bridge USDC to another named chain | bespoke CCTP permission, authored via the `sailor-cctp-bridge` skill (cross-chain only; see that skill) |
| Swap's approve coverage | per `sailor-templates` (swap) "Approve coverage" — default agent-granted bounded approve |

## Spec schema (index-specific)

The `sailor-strategy` core schema holds the actions and per-action values. An index strategy adds these to the
spec's JSON block, in the `strategy` envelope the runtime reads:

```jsonc
{
  // ... core identity + actions (one swap action per token per chain actually used)
  "index": {
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
