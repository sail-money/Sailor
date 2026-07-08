---
name: sailor-swap-quote
description: Fetch a live Uniswap V3 quote via QuoterV2 and compute a slippage-adjusted amountOutMinimum for a swap. Use after sailor-token-resolve to show the user the current price and to produce the amountOutMinimum floor the agent must embed in every swap dispatch. Runs the bundled `scripts/quote-swap.mjs` (no dependencies, no gas).
---

# sailor-swap-quote — live price + amountOutMinimum floor

After [`sailor-token-resolve`](../sailor-token-resolve/SKILL.md) confirms a token is
swap-ready, get the actual number: how much tokenOut the user's amountIn buys
right now, and the `amountOutMinimum` floor that protects against slippage.

## When to load

- After `sailor-token-resolve` returned `swapReady: true`.
- Before presenting a mandate to the user (show them the current price).
- To validate `amountOutMinimum` before the agent dispatches a real swap.
- Whenever the user asks "what's the price of X?" or "how much WETH for 25 USDC?".

## Run it

```bash
# From the project root. Inputs come from sailor-token-resolve's output.
node scripts/quote-swap.mjs \
  --token-in  0x078D782b760474a361dDA0AF3839290b0EF57AD6  --decimals-in  6  \
  --token-out 0x4200000000000000000000000000000000000006 --decimals-out 18 \
  --amount 25000000 --fee 3000 --slippage-bps 100
```

- `--amount` is in **base units** of tokenIn (25 USDC = `25000000`, not `25`).
- `--fee` is the tier from `sailor-token-resolve` (deepest pool).
- `--slippage-bps` defaults to `100` (1%). Tighten (e.g. `50`) for stable pairs,
  loosen for volatile ones. `0` removes the floor — testing only.
- `--chain` / `--rpc` override the project's active chain/RPC.

Output: one JSON object on stdout; human notes on stderr.

## What it returns

```json
{
  "amountIn": "25000000", "amountOut": "15805313193992907",
  "amountOutMinimum": "15647260062052977",   // amountOut × (10000-slip)/10000
  "slippageBps": 100, "fee": 3000,
  "human": { "amountIn": "25.0", "amountOut": "0.015805313193992907",
             "amountOutMinimum": "0.015647260062052977",
             "price": "0.015805313193992907 out per 25.0 in" }
}
```

## How the floor is computed

```
amountOutMinimum = amountOut × (10000 − slippageBps) / 10000
```

At 1% slippage, `amountOut × 9900 / 10000`. The agent must embed a value **at
least this high** in its swap calldata's `amountOutMinimum` field — the
`SwapPermission` mandate rejects any swap whose `amountOutMinimum` is below the
pool-implied floor (fail-closed). Re-quote close to dispatch time; a stale quote
is the most common reason a legitimate swap gets rejected.

## What to do with it

1. **Show the user** the `human.price` line before they approve the mandate.
2. **Record `amountOutMinimum`** as the floor the agent's dispatch logic must
   respect. Hand the full quote to [`sailor-template-swap`](../sailor-template-swap/SKILL.md)
   — the mandate's `maxSlippageBps` bound is the on-chain enforcement of this.
3. **Re-quote at dispatch time** — pool state moves; a quote taken minutes ago may
   no longer match.

## If it fails

| Error | Meaning |
|---|---|
| `QuoterV2 reverted` / `amountOut == 0` | No pool at this fee tier (despite resolve-token). Try the next tier from resolve-token's `probedTiers`, or re-run resolve-token — liquidity may have shifted. |
| `No RPC for chain` | Run from the project root, or pass `--rpc`. |
