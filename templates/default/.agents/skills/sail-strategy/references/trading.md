# Trading — archetypes, extension dimensions, routing

Conforms to the category contract in [../SKILL.md](../SKILL.md). Defaults below are structural only — never an invented address, never an asset recommendation.

## Archetypes

### DCA — buy a fixed amount of TOKEN_OUT with TOKEN_IN per period
Defaults: cadence = one buy per day (scheduled); per-tx cap = the per-period buy amount; per-period exposure = per-tx × runs per period; `maxSlippageBps` = 100 (1%). The user supplies: the pair, the amount, the period.

### Rebalancer — hold target weights, trade back inside a band
Defaults: band = ±5 percentage points around each target weight; cadence = daily check, trade only when a weight leaves its band; per-tx cap = the largest single-leg trade the band implies (a stated fraction of allocated capital); `maxSlippageBps` = 100. The user supplies: the token set, the target weights, the allocated capital.

### Threshold / range trader — act when price crosses user-set levels
Defaults: cadence = event-driven (each tick checks price against the levels); per-tx cap = a stated fraction of allocated capital per trigger. The levels are the user's own — never suggest entry or exit prices.

## Extension dimensions (append to the core gate)

| Dimension | Concrete means |
|---|---|
| Pair(s) | tokenIn/tokenOut per leg, both resolved via `sail-token-resolve` |
| Venue + fee tier | The exact router and pool fee tier the leg trades on (token-resolve reports swap-ready tiers) |
| Slippage tolerance | `maxSlippageBps` — sized with a live quote from [`sail-swap-quote`](../../sail-swap-quote/SKILL.md) |
| Price source | Oracle-gated vs pool-referenced — see below; this decides which swap template Station 3 uses |

**Price source — surface this risk difference to the user.** `SwapPermission` (oracle-gated) enforces a manipulation-resistant slippage band via a mandatory `IOracle` adapter — use it whenever an adapter exists for the pair. `SwapPermissionNoOracle` replaces the oracle with a live reference-pool band that is **NOT manipulation-resistant** (a single pool's spot price, movable within one transaction) — it catches an honest mis-quote, not an attack; only for tokens with no oracle adapter, and the user should know the difference before choosing it.

Both swap templates are ERC-20 → ERC-20 only (native value rejected) — an ETH leg trades as WETH.

## Routing (Station 3 reads this)

| Action | Route |
|---|---|
| Bounded swap, pair has an oracle adapter | [`sail-template-swap`](../../sail-template-swap/SKILL.md) |
| Bounded swap, no oracle exists for the pair | [`sail-template-swap-no-oracle`](../../sail-template-swap-no-oracle/SKILL.md) (state the risk difference) |
| Autonomous approve → swap → reset each run | [`sail-template-approve-batch`](../../sail-template-approve-batch/SKILL.md) |
| Live quotes / `amountOutMinimum` sizing | [`sail-swap-quote`](../../sail-swap-quote/SKILL.md) |
| Venues the swap templates don't cover (aggregators, perps, exotic routers) | bespoke via [`sail-mandates`](../../sail-mandates/SKILL.md) |

## Worked example — a complete `.sail/strategy.md` (example values, not a recommendation)

Reuses the same Unichain USDC/WETH pair as the `sail-token-resolve`, `sail-swap-quote`, and `sail-template-swap` worked examples.

````markdown
# Strategy — daily USDC→WETH DCA on Unichain

Category: Trading · Archetype: DCA
Intent (user's words): "Buy 25 USDC of ETH every day. Keep it simple. It runs until I stop it."

| Dimension | Value |
|---|---|
| Chains | Unichain (130) — doctor green |
| Tokens | USDC `0x078D782b760474a361dDA0AF3839290b0EF57AD6` (6 dec) → WETH `0x4200000000000000000000000000000000000006` (18 dec) |
| Venue | Uniswap V3 SwapRouter02 `0x73855d06DE49d0fe4A9c42636Ba96c62da12FF9C`, 0.30% fee tier |
| Amounts & caps | 25 USDC per swap (per-tx `25000000`); one swap/day; ≤ 775 USDC/month |
| Cadence | Scheduled — one buy per day |
| Risk bounds | `maxSlippageBps` 100 (1%); oracle-gated: UniV3TwapOracle `0x9d84C11626d13C5DC9540fA12A3Ff7B85Ac3c1B9`, `maxPriceAgeSec` 3600 |
| Exit condition | None — runs until revoked (explicitly confirmed by the user) |

```json
{
  "category": "trading",
  "archetype": "dca",
  "chains": [130],
  "tokens": [
    { "symbol": "USDC", "address": "0x078D782b760474a361dDA0AF3839290b0EF57AD6", "decimals": 6, "chain": 130 },
    { "symbol": "WETH", "address": "0x4200000000000000000000000000000000000006", "decimals": 18, "chain": 130 }
  ],
  "venues": [
    { "name": "Uniswap V3 SwapRouter02", "address": "0x73855d06DE49d0fe4A9c42636Ba96c62da12FF9C", "chain": 130 }
  ],
  "caps": { "perTx": "25000000", "perDay": "25000000", "perMonth": "775000000", "capToken": "USDC" },
  "cadence": "scheduled: one buy per day",
  "riskBounds": { "maxSlippageBps": 100, "priceOracle": "0x9d84C11626d13C5DC9540fA12A3Ff7B85Ac3c1B9", "maxPriceAgeSec": 3600 },
  "exitCondition": "none — runs until revoked (explicitly confirmed)",
  "confirmedByUser": true,
  "version": 1
}
```
````
