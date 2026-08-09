# Trading — archetypes, extension dimensions, routing

A routing aid consulted when the intent fits this category — not the boundary of what can be built. Conforms to the category contract in [../SKILL.md](../SKILL.md), including its structural-only-defaults rule.

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
| Slippage tolerance | `maxSlippageBps` — sized with a live quote from [`sailor-swap-quote`](../../sailor-swap-quote/SKILL.md). This is the agent's own slippage, not the swap permission's on-chain band tolerance — copying it verbatim into the band silently rejects every trade once the pool's fee is added; [`sailor-mandate-planner`](../../sailor-mandate-planner/SKILL.md) checks this at plan time |
| Price source | `SwapPermissionNoOracle` by default; `SwapPermission` (oracle-gated) only when size vs pool depth warrants it — see below |
| Exit path (accumulate-direction actions only) | Agent-managed — a swap-out leg, same shared template, tokenIn/tokenOut reversed, reusing the entry's registration (see routing below for the shared-cap consequence) — or owner-managed (exit manually; the sovereign Safe exit always works, see `sailor-operate`) — or explicitly declined. Asked once per action; never silently absent |

**No-oracle is the default.** For regular-sized trades, `SwapPermissionNoOracle`'s live-pool band is the right, honest choice — cheap, no extra infrastructure, and it catches a confused manager/agent's bad quote. The reason to reach for an oracle is SIZE, not manager trust: a compromised key is already caught by the amount cap and allowlists either way, but a single pool's spot price is movable within one transaction, and that only matters once a trade is large enough relative to the pool for moving it to be worth an attacker's effort.

**Soft trigger — cap vs pool depth.** `sailor-token-resolve` reports pool liquidity. Cap large relative to the target pool's depth → raise the oracle option explicitly, in the moment ("at this size in this pool, price manipulation is a real consideration — an oracle-gated permission protects against it; here's whether one is available"). Cap small vs a deep pool → say nothing, default silently. Never a hard gate — the user may proceed no-oracle at any size; the decision is theirs.

**Detect-and-route when the oracle path is wanted.** Check `sailor-templates/deployed.json`'s `oracles` section for an adapter covering this pair on this chain. Adapter exists → route to `SwapPermission` with that address, zero user Solidity. None deployed → say so plainly: no adapter exists for this pair here; using the oracle tier means deploying one — a custom `IOracle` wrapper around a price feed, real work with real safety stakes (a wrong oracle is worse than none: false confidence) — and `SwapPermissionNoOracle` remains appropriate for most sizes. If the user still wants one built, route via [`sailor-mandates`](../../sailor-mandates/SKILL.md), flagged as the most safety-critical bespoke work in the catalog — no adapter generator, no shortcuts.

Both swap templates are ERC-20 → ERC-20 only (native value rejected) — an ETH leg trades as WETH.

**Feasibility (verify, don't advise).** The pair's pool must actually exist with real liquidity on the target chain — [`sailor-token-resolve`](../../sailor-token-resolve/SKILL.md)'s venue map answers this. No pool on that chain → the leg can't be built there: pick a chain where the pool exists (loop back to Station 1 if it needs adding), or route it bespoke.

## Routing (Station 3 reads this)

| Action | Route |
|---|---|
| Bounded swap (the common case) | [`sailor-template-swap-no-oracle`](../../sailor-template-swap-no-oracle/SKILL.md) — the default; see the price-source decision above |
| Bounded swap where size vs pool depth warrants an oracle | [`sailor-template-swap`](../../sailor-template-swap/SKILL.md) — see detect-and-route above |
| Swap's approve coverage | The agent grants its own allowance via a small bespoke permission (default — see either swap spoke's "Approve coverage"; standing or bounded-per-trade, the user's choice, neither one stalls); owner-set-on-the-Safe is a simpler opt-out; zero-standing-allowance alternative: [`sailor-template-approve-batch`](../../sailor-template-approve-batch/SKILL.md) (does not check min-out) |
| Live quotes / `amountOutMinimum` sizing | [`sailor-swap-quote`](../../sailor-swap-quote/SKILL.md) |
| Agent-managed exit (swap-out) | Same shared template as the entry (`SwapPermission`/`SwapPermissionNoOracle`), reconfigured with the reverse pair added to `tokensIn`/`tokensOut` — a config-only leg, not a second permission. The template's `maxAmountPerTx` is ONE value shared across every configured pair on that registration (confirmed in the frozen source), so entry and exit cannot carry different caps on one registration — size the shared cap to whichever leg needs more (almost always the exit ceiling); a generous or effectively unbounded cap costs nothing extra since the price floor (`sailor-mandate-planner`'s position-exit sizing rule) protects every trade regardless of cap size |
| Venues the swap templates don't cover (aggregators, perps, exotic routers) | bespoke via [`sailor-mandates`](../../sailor-mandates/SKILL.md) |

## Worked example — a complete `.sail/strategies/<name>.md` (example values, not a recommendation)

A two-chain DCA: the same USDC→WETH leg split across Base and Arbitrum (their own resolved
addresses and pools — the two actions never share one entry). Router addresses are each chain's
Uniswap V3 SwapRouter02 (the same registry `probe-mandate.mjs` uses); pool address/fee
tier/liquidity are what `sailor-token-resolve` reports at resolution time — illustrative here,
which is exactly what `provenance.resolvedAt` is for: re-verify rather than trust a stale figure.

````markdown
# Strategy — daily USDC→WETH DCA on Base and Arbitrum

Category: Trading · Archetype: DCA
Intent (user's words): "Buy 25 USDC of ETH every day on Base AND on Arbitrum. Keep it simple. Runs until I stop it."

| Dimension | Value |
|---|---|
| Chains | Base (8453), Arbitrum (42161) — both doctor green |
| Cadence | Scheduled — one buy per day, per chain |
| Exit condition | None — runs until revoked (explicitly confirmed by the user) |
| Provenance | Resolved 2026-07-10T21:14:00Z against Base (Alchemy) and Arbitrum (Alchemy) RPCs |

### Actions

| # | Route | Direction | Venue | Pool | Cap (human / base units) | Risk bounds | Exit path |
|---|---|---|---|---|---|---|---|
| `swap-base` | `SwapPermissionNoOracle` | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 dec) → WETH `0x4200000000000000000000000000000000000006` (18 dec) | Uniswap V3 SwapRouter02 `0x2626664c2603336E57B271c5C0b26F421741e481` | `0xd0b53D9277642d899DF5C87A3966A349A798F224`, 0.05% tier, ~$18M liquidity | 25 USDC / `25000000` per swap; ≤ 775 USDC / `775000000` per month | `maxSlippageBps` 100 (1%) | Owner-managed (explicitly confirmed — user will exit manually via the Safe) |
| `swap-arbitrum` | `SwapPermissionNoOracle` | USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (6 dec) → WETH `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` (18 dec) | Uniswap V3 SwapRouter02 `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `0xC6962004f452bE9203591991D15f6b388e09E8D0`, 0.05% tier, ~$22M liquidity | 25 USDC / `25000000` per swap; ≤ 775 USDC / `775000000` per month | `maxSlippageBps` 100 (1%) | Owner-managed (explicitly confirmed — user will exit manually via the Safe) |

```json
{
  "category": "trading",
  "archetype": "dca",
  "chains": [8453, 42161],
  "actions": [
    {
      "id": "swap-base",
      "kind": "swap",
      "chain": 8453,
      "route": { "type": "template", "name": "SwapPermissionNoOracle" },
      "tokenIn": { "symbol": "USDC", "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "decimals": 6 },
      "tokenOut": { "symbol": "WETH", "address": "0x4200000000000000000000000000000000000006", "decimals": 18 },
      "venue": { "name": "Uniswap V3 SwapRouter02", "address": "0x2626664c2603336E57B271c5C0b26F421741e481" },
      "pool": { "address": "0xd0b53D9277642d899DF5C87A3966A349A798F224", "feeTier": 500, "observedLiquidityUsd": 18000000 },
      "caps": {
        "perTx": { "baseUnits": "25000000", "human": "25 USDC" },
        "perDay": { "baseUnits": "25000000", "human": "25 USDC" },
        "perMonth": { "baseUnits": "775000000", "human": "775 USDC" }
      },
      "riskBounds": { "maxSlippageBps": 100 },
      "exitPath": { "managedBy": "owner", "actionIds": [] }
    },
    {
      "id": "swap-arbitrum",
      "kind": "swap",
      "chain": 42161,
      "route": { "type": "template", "name": "SwapPermissionNoOracle" },
      "tokenIn": { "symbol": "USDC", "address": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "decimals": 6 },
      "tokenOut": { "symbol": "WETH", "address": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "decimals": 18 },
      "venue": { "name": "Uniswap V3 SwapRouter02", "address": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" },
      "pool": { "address": "0xC6962004f452bE9203591991D15f6b388e09E8D0", "feeTier": 500, "observedLiquidityUsd": 22000000 },
      "caps": {
        "perTx": { "baseUnits": "25000000", "human": "25 USDC" },
        "perDay": { "baseUnits": "25000000", "human": "25 USDC" },
        "perMonth": { "baseUnits": "775000000", "human": "775 USDC" }
      },
      "riskBounds": { "maxSlippageBps": 100 },
      "exitPath": { "managedBy": "owner", "actionIds": [] }
    }
  ],
  "cadence": "scheduled: one buy per day, per chain",
  "exitCondition": "none — runs until revoked (explicitly confirmed)",
  "provenance": {
    "resolvedAt": "2026-07-10T21:14:00Z",
    "chains": {
      "8453": { "rpc": "alchemy (base mainnet)" },
      "42161": { "rpc": "alchemy (arbitrum mainnet)" }
    }
  },
  "confirmedByUser": true,
  "version": 3
}
```
````

A single-chain DCA is the same shape with one entry in `actions[]` and one chain in `chains`/`provenance.chains` — nothing else about the schema changes.
