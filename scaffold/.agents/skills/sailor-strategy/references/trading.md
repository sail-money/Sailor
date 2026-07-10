# Trading — archetypes, extension dimensions, routing

A routing aid consulted when the intent fits this category — not the boundary of what can be built. Conforms to the category contract in [../SKILL.md](../SKILL.md). Defaults below are structural only — never an invented address, never an asset recommendation.

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
| Pair(s) | tokenIn/tokenOut per leg, both resolved via `sailor-token-resolve` |
| Venue + fee tier | The exact router and pool fee tier the leg trades on (token-resolve reports swap-ready tiers) |
| Slippage tolerance | `maxSlippageBps` — sized with a live quote from [`sailor-swap-quote`](../../sailor-swap-quote/SKILL.md) |
| Price source | `SwapPermissionNoOracle` by default; `SwapPermission` (oracle-gated) only when size vs pool depth warrants it — see below |

**No-oracle is the default.** For regular-sized trades, `SwapPermissionNoOracle`'s live-pool band is the right, honest choice — cheap, no extra infrastructure, and it catches a confused manager/agent's bad quote. The reason to reach for an oracle is SIZE, not manager trust: a compromised key is already caught by the amount cap and allowlists either way, but a single pool's spot price is movable within one transaction, and that only matters once a trade is large enough relative to the pool for moving it to be worth an attacker's effort.

**Soft trigger — cap vs pool depth.** `sailor-token-resolve` reports pool liquidity. Cap large relative to the target pool's depth → raise the oracle option explicitly, in the moment ("at this size in this pool, price manipulation is a real consideration — an oracle-gated permission protects against it; here's whether one is available"). Cap small vs a deep pool → say nothing, default silently. Never a hard gate — the user may proceed no-oracle at any size; the decision is theirs.

**Detect-and-route when the oracle path is wanted.** Check `sailor-templates/deployed.json`'s `oracles` section for an adapter covering this pair on this chain. Adapter exists → route to `SwapPermission` with that address, zero user Solidity. None deployed → say so plainly: no adapter exists for this pair here; using the oracle tier means deploying one — a custom `IOracle` wrapper around a price feed, real work with real safety stakes (a wrong oracle is worse than none: false confidence) — and `SwapPermissionNoOracle` remains appropriate for most sizes. If the user still wants one built, route via [`sailor-mandates`](../../sailor-mandates/SKILL.md), flagged as the most safety-critical bespoke work in the catalog — no adapter generator, no shortcuts.

Both swap templates are ERC-20 → ERC-20 only (native value rejected) — an ETH leg trades as WETH.

**Feasibility (verify, don't advise).** The pair's pool must actually exist with real liquidity on the target chain — [`sailor-token-resolve`](../../sailor-token-resolve/SKILL.md)'s venue map answers this. No pool on that chain → the leg can't be built there: pick a chain where the pool exists (loop back to Station 1 if it needs adding), or route it bespoke. This checks whether what the user chose is buildable — it never recommends what to trade.

## Routing (Station 3 reads this)

| Action | Route |
|---|---|
| Bounded swap, pair has an oracle adapter | [`sailor-template-swap`](../../sailor-template-swap/SKILL.md) |
| Bounded swap, no oracle exists for the pair | [`sailor-template-swap-no-oracle`](../../sailor-template-swap-no-oracle/SKILL.md) (state the risk difference) |
| Autonomous approve → swap → reset each run | [`sailor-template-approve-batch`](../../sailor-template-approve-batch/SKILL.md) |
| Live quotes / `amountOutMinimum` sizing | [`sailor-swap-quote`](../../sailor-swap-quote/SKILL.md) |
| Venues the swap templates don't cover (aggregators, perps, exotic routers) | bespoke via [`sailor-mandates`](../../sailor-mandates/SKILL.md) |

## Worked example — a complete `.sail/strategy.md` (example values, not a recommendation)

Reuses the same Unichain USDC/WETH pair as the `sailor-token-resolve`, `sailor-swap-quote`, and `sailor-template-swap` worked examples.

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
