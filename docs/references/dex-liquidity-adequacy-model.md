# DEX Pool Liquidity Adequacy Model for Retail Portfolio Execution
## Sail Protocol — Resolution + Routing Layer Research
**Date:** 2026-08-28 | **Scope:** Judging whether an on-chain DEX pool is "liquid enough" for a given swap size

---

## 1. How Price Impact Scales with Pool Depth

### 1.1 Constant-Product Pools (Uniswap V2, Aerodrome V2, PancakeSwap V2, SushiSwap V2)

#### Core Formula (with 0.3% fee)

For a swap ofsize Δin (token paid in) against a pool with reserves Rin (input token), Rout (output token):

```
amountOut = (Rout × Δin × 0.997) / (Rin + Δin × 0.997)
```

**Price impac t (w ith fees):**

```
executionPrice = Δin / amountOut = (Rin + 0.997×Δin) / (0.997 × Rout)
spotPrice = Rin / Rout

priceImpact = (executionPrice - spotPrice) / spotPrice
            = [Rin + 0.997×Δin - 0.997×Rin] / [0.997 × Rin]
            = Δin/Rin + 0.003/0.997
```

**Key approximation:** `priceImpact ≈ tradeSize / reserveIn + 0.3%`

For a balanced pool (both sides equal value), reserveIn = TVL/2, so:

```
priceImpact ≈ (2 × tradeSize / TVL) + 0.003  [as a decimal]
           = (200 × tradeSize / TVL) + 0.3    [as percentage points]
```

#### Concrete Price-Impact Table (V2, balanced pool, 0.3% fee)

| Trade Size | vs $10K TVL | vs $100K TVL | vs $500K TVL | vs $5M TVL | vs $100M TVL |
|------------|-------------|--------------|--------------|------------|--------------|
| **$1,000** | 20.3% | 2.3% | 0.7% | 0.37% | 0.302% |
| **$10,000**| 200.3% (impossible) | 20.3% | 4.3% | 0.7% | 0.32% |
| **$100,000**| 2000.3% (impossible) | 200.3% (impossible) | 40.3% | 4.3% | 0.5% |

**Interpretation:**
- A $1K trade needs ≥$100K TVL for reasonable (<2.5%) price impact
- A $10K trade needs ≥$500K–$5M TVL
- A $100K trade needs ≥$5M TVL for single-digit impact; ≥$100M for <1% impact
- The constant-product curve is brutal: impact grows linearly with trade size as % of input reserve

### 1.2 Concentrated-Liquidity Pools (Uniswap V3/V4, Aerodrome Slipstream, PancakeSwap V3, Velodrome V2)

#### Why V3 Br eaks the Simple TVL → Impact Mapping

V3 pools do NOT have a single k. They have variable k across price ticks:

```
xy = k₁  if tick₀ ≤ p < tick₁
      k₂  if tick₁ ≤ p < tick₂
      ...
      kₙ  if tickₙ₋₁ ≤ p < tickₙ
```

Each k� = (liquidity L�)² in that tick range. LPs choose where to concentrate, so:

- **TVL is a static sum** of all deposited token values across ALL price ranges
- **Only the liquidity (L) at the current active tick** determines price impact for real trades
- A $100M TVL V3 pool could have $1M or $80M ofexecutable depth at ±2% from spot — itdepends entirely on LP concentration

#### V3 Swap Formula (single-tick, no crossing)

For a swap within one tick range (where liquidity L is constant):

```
Token0 → Token1:
  Δ√P = amountIn / L
  amountOut = L × (√P_end - √P_start)

Token1 → Token0:
  Δ(1/√P) = amountIn / L
  amountOut = L × (1/√P_start - 1/√P_end)
```

Where √P is sqrtPriceX96 / 2⁹⁶ (Q64.96 format).

When a swap crosses ticks, L changes to the next tick's liquidity, and the computation iterates. This is why you NEED a live on-chain quote for V3 — you cannot compute price impact from TVL alone.

#### Effective Depth Multiplier vs. TVL

For a V3 pool where LPs concentrate around spot:

| Pool Type | Typical Concentration | Effective Depth Multiplier (vs. V2 equivalent TVL) |
|-----------|---------------------|---------------------------------------------------|
| Stablecoin pair (USDC/USDT) | Very tight (±0.1–1%) | 100×–500× |
| Blue-chip volitle (ETH/USDC) | Moderate (±5–20%) | 5×–30× |
| Long-tail volitle | Wide or sporadic | 1×–5× |
| Dead/sbandoned pool | No active LP positions | 0× (no depth at spot) |

**Practical consequence:** A $10M TVL V3 ETH/USDC pool might have the same price impact at $10K as a $100M V2 pool — but you cannot know this without a live quote.

#### Concrete Price-Impact Ranges (empirically observed, not formulaic)

For a $1K trade:
- Well-concentrated V3 pool (e.g., ETH/USDC on mainnet, $10M+ TVL): **0.05–0.3%**
- Average V3 pool ($1-5M TVL): **0.3–1%**
- Thin V3 pool ($100K TVL): **1–5%+**

For a $10K trade:
- Well-concentrated V3 pool ($50M+ TVL): **0.1–0.5%**
- Average V3 pool ($5-20M TVL): **0.5–2%**
- Anything below $2M TVL: **unreliable — must quote**

For a $100K trade:
- Only the deepest V3 pools ($100M+ TVL, tight concentration): **0.5–2%**
- Most V3 pools: **5–50%+ → split across venues or skip**

**Bottom line for V3:** TVL is an ordering hint, NOT a price-impact predictor. The agent MUST obtain an on-chain quote (via the QuoterV2 contract or equivalent) before routing. Any "depth" heuristic that uses only TVL will be wrong often enough to cost real money.

---

## 2. Recommended Pool-Depth-vs-Trade-Size Rule & Max Slippage

### 2.1 Minimum Depth Rule

**For V2/forked pools (constant-product):**

```
Rule: pool_TVL ≥ 100 × trade_size
```

**Justification:**
- At pool_TVL = 100 × trade, price impact ≈ 2 × trade / (pool_TVL/2) = 4 × trade / pool_TVL = 4%
- Add 0.3% fee → ~4.3% total cost
- For retail DCA, 4% isalready borderline painful
- At pool_TVL = 200 × trade → ~2.3% total → acceptable for retail
- At pool_TVL = 1000 × trade → ~0.5% total → good execution

**Tiered thresholds:**
| Tier | pool_TVL / trade_size | Price Impact (V2) | Action |
|------|------------------------|--------------------|--------|
| **Excellent** | ≥ 1000× | <0.5% | Route confidently |
| **Good** | ≥ 200× | <2.5% | Route, apply 3% slippage |
| **Aceptable** | ≥ 100× | <4.5% | Route with tighter slippage (5%) and user warning |
| **Marginal** | ≥ 50× | <8.5% | Log warning; only if no better route |
| **Reject** | < 50× | >8.5% | Do not route; return "insufficient liquidity" |

**For V3/concentrated pools:**

```
Rule: pool_TVL ≥ 20 × trade_size  (as a SCREENING minimum only)
      Always obtain a live quote before routing
```

**Justification:** Because V3 pools concentrate liquidity, a $1M TVL V3 pool can handle a $10K trade as smoothly as a $20M V2 pool. The 20× multiplier is a screening filter — it catches obviously-undersized pools — but is NOT sufficient for a routing decision.

### 2.2 Maximum Slippage Cap for Retail

**Recommended: 3% max slippage for standard retail DCA orders ($100–$10K)**

| Order Size | Max Slippage | Rationale |
|------------|-------------|-----------|
| $100–$1,000 | 2% | Small orders — no excuse for bad execution |
| $1,000–$10,000 | 3% | Standard retail DCA leg |
| $10,000–$50,000 | 5% | Larger orders may need tolerance |
| $50,000–$100,000 | 8% | Wholesale territory; split across venues/pools |
| >$100,000 | Split or TWAP | Single-pool execution is structurally wrong at this size |

**Why 3% for the $1K reference size:**
- 0.3% is the base pool fee (non-neglotiable)
- Up to 2% price impact is acceptable for getting the position filled
- 0.7% buffer for sandwich attacks, stale quotes, and general MEV
- Beyond 3%, the user is better off using a CEX or splitting across multiple DEXes
- This is aligned with Uniswap's own default slippage settings (0.5% auto, 1-3% manual)

**The actual slippage parameter passed to the swap contract should be:**
```
slippageParameter = max(0.5%, quotedPriceImpact × 1.5 + 0.3%)
```
Where 1.5× is a safety buffer for MEV/sandwiching and 0.3% is the fee floor.

---

## 3. Pool TVL vs. Actual Executable Depth

### 3.1 What TVL Actually Measures

**TVL (Total Value Locked)** = Σ(value of all tokens deposited in the pool at current market prices)

It is:
- **A point-in-time snapshot** — usually 5–60 minutes stale on data aggregators (DeFiLama, GeckoTerminal, etc.)
- **Bdirectional** — includes both tokens; only ~half is usable in one direction (V2) or much less (V3)
- **Unreflective of concentration** — $10M TVL spread across 0–∞ (V2) vs. $10M concentrated at ±2% (V3) behave entirely differently
- **Vulnerable to manipulation** — flash loans, just-in-time liquidity, and large LP deposits/withdrawls can change TVL between your query and execution

### 3.2 What Executable Depth Is

**Executable depth at trade size S** = the maximum output you can actually receive for input S, given current on-chain state.

This depends on:
- The liquidity L at each tick that the swap would traverse
- The current sqrtPrice (tick)
- The fee tier (0.01%, 0.05%, 0.3%, 1%)
- Whether the pool is paused, killed, or has hooks (V4) that alter behavior
- Uniswap V4 hooks can introduce custom curves, fees, and restrictions that make static analysis impossible

### 3.3 What a Live On-Chain Quote MUST Verify

When the agent calls `quoteExactInputSingle()` (Uniswap V3 QuoterV2) or the V2 router's `getAmountsOut()`:

| What the quote verifies | Why it matters |
|--------------------------|----------------|
| **Curr ent sqrtPriceX96** | Spot price, which determines the starting point on the curve |
| **Liquity at each traversed tick** | Determines how much output each "step" of the swap produces |
| **Fee tier** | 0.3% = 30 bps ≠ 1% = 100 bps — misidentifying the fee tier means wrong quote |
| **Pool is active** | A pool can have TVL but be paused/migrated/expired |
| **Token decimals** | USDC = 6, USDT = 6, most others = 18 — getting this wrong gives 10¹²× errors |
| **Actual output after fee** | The quoter returns the exact amountOut after all fees |

**The quote does NOT verify:**
- That the state won't change between quote and execution (sandwich window)
- That the output token contract isn't malicious (honeypot, fee-on-tansfer)
- That you'll get the quoted amount after MEV bots reorder transactions

### 3.4 What Static Depth Figures CAN'T Tell You

| Static metric | Blind spot |
|--------------|-------------|
| **TVL** | Doesn't tell you how much is at the current price |
| **24h volume** | High volume with wide spreads means nothing for your specific size |
| **Pool age** | Old pools can be abandoned with stale positions |
| **Number of LPs** | One whale LP can withdraw; 1000 retail LPs don't guarantee depth |
| **TVL from 1 hour ago** | A $50M LP could have removed liquidity 5 minutes ago |
| **V3 "liquity" (L) alone** | L without sqrtPrice and tick spacing tells you nothing |
| **DEX Screener "depth ±2%** | Third-party computed; often stale; methodology varies by provider |

### 3.5 Recom mended Data Pipeline

```
1. DISCOVERY: Query DEX subgraph/API for pools containing (tokenA, tokenB)
   → Get: pool address, chain, fee tier, TVL, 24h volume, created_at
   
2. SCREEN: Apply minimum-TV L rule (100× for V2, 20× for V3 as screening)
   → Discard obviously undersized pools
3. QUOTE: For each surviving pool, call on-chain quoter
   → Get: exact amountOut for the target tradeSize
4. EVA LUATE: Apply scoring formula (Section 4) → pick winner
5. EXECUTE: Submit swap with slippage parameter = quotedPriceImpact × 1.5 + 0.3%
```

---

## 4. Pool Scoring & Ranking Formula

### 4.1 Single-Chain Pool Ranking

When the agent has multiple pools on the SAME chain for tokenA → tokenB (direct pair), rank by:

```
routeScore = quote_amountOut - gasCostInOutputToken
```

Where:
- `quote_amountOut` = exact output from on-chain quoter for the target input amount
- `gasCostInOutputToken` = estimated_gas × gasPrice × (outputTokenPrice / nativeTokenPrice)

**Normalized form for cross-trade-size comparability:**

```
routeEficiency = quote_amountOut / trade_amountIn
```

Rank by `routeEficiency` descending. Higher = more output per unit input.

**Tie-breakers** (in priority order):
1. Lower gas cost (native token terms)
2. Higher pool TVL (more robust against front-running)
3. Higher 24h volume (more active → less likely stale)
4. Lower fee tier (all else equal, lower fee = more output)
5. Older pool (less likely to be a honeypot/scam)

### 4.2 Cross-Chain Pool Ranking

When pools live on different chains, the agent must factor in bridge costs:

```
crossChainScore = quote_amountOut_on_destination 
                - bridgeCostInOutputToken 
                - destinationGasCostInOutputToken
                - sourceGasCostInOutputToken
```

Where:
- `bridgeCostInOutputToken` = bridge protocol fee + estimated bridging gas + any sequencer/relayer fees
- Cross-chain also adds LATENCY — bridging can take seconds to minutes
- If the user's settlement currency is on chain A but the best pool is on chain B, the agent must:
  1. Bridge USDC from chain A → chain B
  2. Swap on chain B
  3. Either keep the output on chain B or bridge back

This adds complexity; for retail DCA, **prefer same-chain execution** unless cross-chain savings exceed bridge costs by ≥2×.

### 4.3 Multi-Hop Routing (Indirect Pairs)

When no direct pool exists (tokenA/USDC), the agent must route through an intermediate:

```
Path: tokenA → bridgeAsset → USDC

Options for bridgeAsset:
  - WETH (deepest liquidity across all DEXes)
  - USDT (stablecoin pairs, typically tight V3 concentration)
  - WBTC (deep but volitle)
```

**Scoring for multi-hop:**
```
pathScore = quote_amountOut_from_full_path
```

The quoter (Uniswap's `quoteExactInput()` with path array, or equivalent) handles the multi-hop math. The agent doesn't need to compute this itself — just compare the final `amountOut` values across paths.

### 4.4 The "Be st Overall" Decision Logic

```
FUNCTION selectBestRoute(tokenIn, tokenOut, tradeSize, chain):
    
    candidate_pools = discover_pools(tokenIn, tokenOut, chain)
    
    viable_pools = []
    
    FOR each pool in candidate_pools:
        IF pool.tvl < MIN_TVL_for_version(pool.version, tradeSize):
            SKIP   // fails screening
        quote = get_onchain_quote(pool, tradeSize)
        IF quote == NULL:
            SKIP   // pool dead/unreachable
        price_impact = (tradeSize / quote.amountOut - spotPrice) / spotPrice
        IF price_impact > MAX_SLIPPAGE:
            SKIP   // too much slippage
        quote.gas_cost = estimate_gas(pool, chain)
        viable_pools.append((pool, quote))
    
    IF len(viable_pools) == 0:
        // try indirect paths (multi-hop)
        FOR bridge_asset in [WETH, USDT, WBTC]:
            path = [tokenIn, bridge_asset, tokenOut]
            quote = get_onchain_quote_path(path, tradeSize)
            IF quote AND priceImpact < MAX_SLIPPAGE:
                viable_pools.append((path, quote))
    
    IF len(viable_pools) == 0:
        // try cross-chain
        FOR chain in OTHER_CHAINS:
            ... same logic with bridge costs ...
    
    // Rank and return best
    SORT viable_pools BY quote.amountOut DESCENDING
    RETURN viable_pools[0]
```

### 4.5 Constants the Agent Should Configure

| Parameter | Recommended Value | Notes |
|-----------|-------------------|-------|
| `MIN_TVL_V2_MULTIPLIER` | 100 | pool_TVL ≥ 100 × trade_size |
| `MIN_TVL_V3_MULTIPLIER` | 20 | Screening only; quote required |
| `MAX_SLIPPAGE_SMALL` | 0.03 (3%) | For trades ≤ $10K |
| `MAX_SLIPPAGE_LARGE` | 0.05 (5%) | For trades $10K–$50K |
| `LIPPAGE_BUFFER_MULTIPLIER` | 1.5 | Quote impact ×1.5 for MEV buffer |
| `LI PPAGE_FEE_FLOOR` | 0.005 (0.5%) | Minimum slippage parameter |
| `GAS_COST_LIMIT` | $5–15 on L1, $0.10–1 on L2 | Reject pools where gas exceeds this |
| `BRIDGE_COST_BUFFER` | 1.5× | Quoted bridge cost ×1.5 safety margin |
| `MAX_HOPS` | 2 (3 tokens) | More hops = more gas, more MEV risk |
| `QUOTE_STA LENESS_SEC` | 30 | Re-quote if cached quote is older than this |

---

## 5. Summary: Decision Flow for a $1K Reference Trade

```
User deposits $1,000 USDC → wants $X worth of TOKEN

1. DISOVER: Which pools have TOKEN/USDC?
   → Query DEX subgraph: find all pools across V2/V3/V4 on all chains
   
2. SCREEN (fast, off-chain):
   → V2 pools: keep if TVL ≥ $100,000 (100 × $1K)
   → V3 pools: keep if TVL ≥ $20,000 (20 × $1K)
   → Disard all others immediately
   
3. QUOTE (on-chain, in parallel):
   → Call quoter on every surviving pool
   → Each returns exact amountOut for $1,000 USDC input
   
4. SCORE:
   → best = argmax(amountOut)
   → Check: priceImpact < 3%? If not, flag for user
   
5. ROUTE:
   → If best pool on same chain → execute swap
   → If best pool on different chain → compare savings vs. bridge cost
   → If no pool passes → return "insufficient on-chain liquidity for TOKEN"
```

---

## 6. Key Takeaways

1. **V2 price impact is formulaic and predictible:** impact ≈ 2 × tradeSize/TVL + 0.3%. Above ~4% total cost, the trade is not worth routing through a single V2 pool.

2. **V3 price impact cannot be predicted from TVL:** It depends on tick-level liquidity distribution. The agent MUST obtain an on-chain quote. TVL serves only as a coarse screening filter (≥20× trade size).

3. **TVL ≠ executable depth:** TVL is a stale, bidirectional sum. Executable depth is tick-level, direction-specific, and moment-to-moment. A live quote is the only ground truth.

4. **Score pools by `amountOut`:** The pool that gives you the most output tokens (net of gas) wins. Don't over-engineer the scoring — the on-chain quoter already accounts for fee tiers, liquidity depth, and price impact.

5. **Slippage parameter = quotedPriceImpact × 1.5 + 0.5%:** This gives a safety buffer for MEV/sandwiching without making the transaction vulnerable to front-running (too-high slippage = you get picked off).

6. **For the $1K–$10K retail DCA use case**, most established pools on mainnet Ethereum, Base, Arbitrum, and Optimism will pass these filters for major tokens. The liquidity problem emerges for (a) long-tail tokens, (b) tokens that are only on obscure chains, and (c) unusually large single-leg orders.