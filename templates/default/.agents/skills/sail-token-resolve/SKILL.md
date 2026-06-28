---
name: sail-token-resolve
description: Resolve a token the user named by symbol or address to its on-chain metadata (address, decimals) and determine whether it is swap-ready on the active chain — i.e. whether a live Uniswap V3 pool exists. Use BEFORE building any swap mandate or quoting a swap. Runs the bundled `scripts/resolve-token.mjs` (no dependencies, no gas).
---

# sail-token-resolve — token → address + swap-readiness

The user will name tokens by symbol ("WETH", "LINK") far more often than by
address. Never guess an address, and never assume a token that exists is also
swap-ready. This skill resolves the symbol to a verified on-chain address +
decimals, then probes Uniswap V3 liquidity to flag swap-readiness.

**"token exists" ≠ "token is swap-ready."** A token can have a valid contract on
a chain with zero V3 liquidity. Swap-ready means QuoterV2 returns a non-zero
quote for USDC→token.

## When to load

- The user names a token by symbol and you need its address/decimals for a mandate.
- Before `sail-swap-quote` or `sail-swap-mandate` — both consume this skill's output.
- Whenever the user asks "can I swap X here?" or "does X have a pool?"

## Run it

```bash
# From the project root (it reads .sail/.env.local for RPC + chain):
node scripts/resolve-token.mjs WETH
node scripts/resolve-token.mjs LINK --chain unichain
node scripts/resolve-token.mjs 0x4200000000000000000000000000000000000006
```

`--chain` and `--rpc` override the project's active chain/RPC (else read from
`.sail/.env.local` / `.sail/config.json`). Output is one JSON object on stdout
(human notes on stderr).

## What it returns

```json
{
  "symbol": "WETH",
  "address": "0x4200…0006",
  "decimals": 18,            // verified on-chain via decimals()
  "chain": "unichain", "chainId": 130,
  "swapReady": true,
  "feeTier": 3000,           // deepest pool across 500/3000/10000
  "quote": { "tokenIn": "USDC", "amountIn": "25000000", "amountOut": "…" },
  "recommendation": "Swap-ready on unichain (deepest pool fee 3000). Hand to quote-swap.mjs…"
}
```

## How it works

1. **Curated registry** (instant) — common tokens per chain (USDC/WETH/UNI/LINK/…).
2. **On-chain verify** — calls `symbol()` + `decimals()` via eth_call. Source of
   truth; never trust the registry's decimals blindly (a 6-vs-18 mismatch silently
   mis-sizes every cap).
3. **Liquidity probe** — quotes USDC→token across fee tiers 500/3000/10000 via
   QuoterV2. Picks the tier with the highest `amountOut` (deepest pool). A revert
   or zero at all tiers ⇒ not swap-ready.

## The two outcomes that matter

- **`swapReady: true`** → hand the `(address, decimals, feeTier)` to
  [`sail-swap-quote`](../sail-swap-quote/SKILL.md) for an exact quote, then to
  [`sail-swap-mandate`](../sail-swap-mandate/SKILL.md).
- **`swapReady: false`** → the token has no USDC V3 pool on this chain. Tell the
  user; suggest re-running with `--chain base|arbitrum` to locate liquidity on
  another Sail chain, or configure the leg as "held" (agent skips it until a pool
  appears). Do **not** build a swap mandate for a non-swap-ready token — it would
  fail-closed on every dispatch.

## Important

- **Decimals are critical** — 25 USDC = `25_000_000` (6 dec); 1 WETH =
  `1_000_000_000_000_000_000` (18 dec). Every cap in a mandate is base units.
- **Addresses are per-chain** — WETH on Unichain ≠ WETH on Base ≠ WETH on Arbitrum.
  Resolve and verify separately per chain; never copy an address across chains.
- **`getPool` is unreliable** on some forks — this skill trusts a non-zero
  QuoterV2 quote as the go/no-go signal, never the V3 factory's `getPool`.
