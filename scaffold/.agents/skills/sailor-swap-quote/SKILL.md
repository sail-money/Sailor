---
name: sailor-swap-quote
description: Fetch a live Uniswap V3 quote and compute the slippage-adjusted amountOutMinimum for a swap. Use after resolving tokens to show the current price and produce the floor embedded in every swap dispatch.
---

# sailor-swap-quote — live price + amountOutMinimum floor

The actual number: how much tokenOut the user's amountIn buys right now, and the
`amountOutMinimum` floor that protects against slippage.

## When to load

**Precondition:** run `sailor-token-resolve` first — this skill's inputs (tokenIn/tokenOut addresses, decimals, and the fee tier) come from its output, and it must have returned `swapReady: true` for the pair. Do not hand-type these; a wrong decimals or a non-existent tier produces a wrong or reverting quote.

- Before presenting a mandate to the user (show them the current price).
- To validate `amountOutMinimum` before the agent dispatches a real swap.
- Whenever the user asks "what's the price of X?" or "how much WETH for 25 USDC?".

## Run it

```bash
# From the project root. Inputs come from sailor-token-resolve's output — never hand-typed.
# Example values below are Unichain's USDC/WETH; your chain's addresses will differ.
node scripts/quote-swap.mjs \
  --token-in  0x078D782b760474a361dDA0AF3839290b0EF57AD6  --decimals-in  6  \
  --token-out 0x4200000000000000000000000000000000000006 --decimals-out 18 \
  --amount 25000000 --fee 3000 --slippage-bps 100
```

- `--amount` is in base units of tokenIn (see `sailor-token-resolve`'s decimals note).
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
   respect. Hand the full quote to `sailor-templates` (swap) or
   `sailor-templates` (swap-no-oracle) — the mandate's
   `maxSlippageBps`/`toleranceBps` bound is the on-chain enforcement of this, but **do not copy
   `--slippage-bps` verbatim into that field** — this quote's `amountOut` already has the pool's
   fee baked in, while the mandate's band is checked against a fee-*exclusive* reference price. The
   band tolerance needs its own, larger number: see
   `sailor-templates` (swap-no-oracle), the "⚠️ Tolerance vs. pool fee" section.

## If it fails

| Error (verbatim from the script) | Meaning / fix |
|---|---|
| `QuoterV2 returned 0 … pool is empty or does not exist at this tier` | No pool at this fee tier (despite resolve-token). Try the next tier from resolve-token's `probedTiers`, or re-run resolve-token — liquidity may have shifted. |
| `QuoterV2 reverted: …` | The `eth_call` to the quoter reverted (bad token/tier/args, or a non-quoter address). Re-check the addresses and tier from resolve-token. |
| `No RPC for <chain>. Pass --rpc or set RPC_URL in .sail/.env.local.` | No RPC configured for the chain — run from the project root, pass `--rpc`, or set `RPC_URL`. |
| `Could not resolve chain` / `Unknown chain "<x>"` | No chain configured, or an unrecognized `--chain` value — pass `--chain` or set `CHAIN_ID` in `.sail/.env.local`. |
| `Missing --<flag>` | A required flag (`--token-in`, `--token-out`, `--amount`, `--decimals-in`, `--decimals-out`, `--fee`) was not passed. |
| `--slippage-bps must be an integer in [0, 10000]` | Out-of-range slippage — use `0`–`10000` (bps). |
| `eth_call HTTP <status>` | The RPC endpoint returned a non-200 (dead or rate-limited RPC) — try another `--rpc`. |
