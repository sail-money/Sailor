---
name: sail-token-resolve
description: Resolve the tokens a user names by symbol or address into on-chain metadata (address, decimals) AND a cross-chain, cross-DEX liquidity map — which Sail chain and which protocol (Uniswap V3/V4, Sushiswap, PancakeSwap, Aerodrome…) actually hold liquidity, how deep each pool is, and whether the leg is swap-ready. Use BEFORE building any swap/DCA/LP/lending mandate, or whenever a user says "a portfolio of X and Y" / "DCA into A, B, C" / "can I swap X here?". Pass every symbol at once. Resolves ANY symbol — curated registry → keyless GeckoTerminal DEX index → on-chain symbol()+decimals() — and recommends which chain to act on. Runs the bundled `scripts/resolve-token.mjs` (no dependencies, no gas, no API key).
---

# sail-token-resolve — tokens → addresses + where the liquidity lives

Users name tokens by symbol ("WETH", "UNI", "HYPE", "MORPHO") far more often than by
address, and they think in *portfolios* ("a DCA of USDC, UNI and MORPHO"), not single
legs. This skill takes **one or many** symbols and, for each, returns: the verified
on-chain **address + decimals** per chain, a **liquidity venue map** (which chain, which
DEX/protocol, which pool, how deep), whether it is **swap-ready**, and a **recommendation**
when there's a discrepancy — liquidity split across chains, no pool on your chain but a deep
one elsewhere, or no pool on any Sail chain at all.

**"token exists" ≠ "token is swap-ready."** A token can have a valid contract with zero
routable liquidity. Swap-ready (on-chain confirmed) means Uniswap V3 QuoterV2 returns a
non-zero USDC→token quote — Sail's executable fast-path route.

## When to load

- The user names one or more tokens and you need addresses/decimals for a mandate.
- A user describes a **portfolio / DCA / basket** — resolve every symbol in one call.
- Before `sail-swap-quote` or `sail-template-swap` — both consume this skill's output.
- Whenever the user asks "can I swap X here?", "where's the best liquidity for X?", or
  "which chain should I use for this strategy?"

## Run it

```bash
# From the project root (reads .sail/.env.local for RPCs + chain):
node scripts/resolve-token.mjs WETH                    # single token, configured chain(s)
node scripts/resolve-token.mjs LINK --chain unichain   # force one chain
node scripts/resolve-token.mjs 0x4200…0006 --chain base # address input
node scripts/resolve-token.mjs USDC UNI HYPE MORPHO    # PORTFOLIO → rich JSON
node scripts/resolve-token.mjs UNI --all-chains --json # scan every Sail mainnet
```

Flags: `--chain <ethereum|unichain|base|arbitrum>` forces one chain; `--rpc <url>` overrides
the endpoint; `--all-chains` maps every Sail mainnet (even ones without an RPC configured —
those use GeckoTerminal-only data) so you can recommend "put your SMA on chain Y"; `--json`
forces the rich per-token map for a single token.

## Output shapes (pick the right consumer)

| Invocation | stdout shape |
|---|---|
| 1 symbol, single configured chain / `--chain` | **bare object** — `{address, decimals, feeTier, swapReady, quote, venues[], …}` (the shape `sail-swap-quote` / `sail-template-swap` expect) |
| 1 symbol, ≥2 configured chains | **array** of bare objects (one per chain) |
| ≥2 symbols | **portfolio**: `{ tokens: [tokenWrapper…], summary }` |
| 1 symbol + `--json`/`--all-chains` | **token wrapper** (see below) |

A **token wrapper** is:

```jsonc
{
  "query": "UNI",
  "chains": {                       // keyed by chain name; each value is a bare per-chain object
    "base":     { "address": "0x…", "decimals": 18, "swapReady": true, "feeTier": 10000,
                  "venues": [ … ], "bestVenue": { … }, "onchainVerified": true, … },
    "unichain": { … }
  },
  "chainsWithLiquidity": ["unichain","base","arbitrum"],
  "onSailChain": true,
  "crossChain": { "action": "route", "deepestChain": "base", "note": "…human guidance…" }
}
```

A **venue** (inside `venues[]`, sorted deepest-first, capped at 8; `venuesTotal` is the full
count) is:

```jsonc
{ "protocol": "uniswap-v3",      // uniswap-v3 | uniswap-v4 | uniswap-v2 | sushiswap | pancakeswap | aerodrome | other
  "dexId": "uniswap-v3-base",    // raw GeckoTerminal id
  "pool": "0x…", "feeTier": 500, // basis points (500 = 0.05%); null if the pool has no fee in its name
  "pairedSymbol": "USDC", "pairedToken": "0x…",
  "liquidityUsd": 8645941, "volume24hUsd": 22333927,
  "sailRoutable": true,          // Sail's fast path can route it (see below)
  "quoteVerified": true }        // a live on-chain QuoterV2 quote confirmed THIS venue
```

## How it works

1. **Symbol → address** (two layers): curated registry (instant, offline) → GeckoTerminal
   search (keyless CoinGecko DEX index) for anything not curated. Candidates are ranked by
   pool liquidity; the on-chain `symbol()` check is the final authority (a wrong DEX-side
   match is rejected, not trusted).
2. **On-chain verify** — `symbol()` + `decimals()` via eth_call on every chain that has an
   RPC. This is the source of truth (`decimalsSource: "onchain"`). On an `--all-chains` scan
   of a chain with no RPC, metadata falls back to GeckoTerminal (`decimalsSource:
   "geckoterminal-unverified"`) — flag this to the user before wiring it into a mandate.
3. **Liquidity venue map** — `GET /networks/{net}/tokens/{addr}/pools` returns every pool
   GeckoTerminal indexes, across **all DEXes** (Uniswap V3/V4, Sushiswap, PancakeSwap,
   Aerodrome, …), with the protocol, pool address, fee tier and USD depth. One call per token
   per chain.
4. **Swap-readiness (on-chain confirmed)** — quotes USDC→token across fee tiers 500/3000/10000
   via Uniswap V3 QuoterV2 and marks the matching venue `quoteVerified: true`. This is the only
   *executable* signal; everything else in `venues[]` is informational.

## `sailRoutable` — what Sail's fast path can actually swap

Sail's `sail-template-swap` fast path routes through **Uniswap V3** (everywhere) and the
**Uniswap V4** Universal Router (on Unichain). Those venues are marked `sailRoutable: true`.
Sushiswap, PancakeSwap, Aerodrome (and Uniswap V2) are detected and surfaced so you can see
*where the liquidity really is*, but they're `sailRoutable: false` — Sail can't route them via
the fast path. If the only liquidity is on a non-routable DEX, the token needs a custom mandate
(`sail-mandates`) or should be held. (Pools with absurd fees — >10% — are spam and are never
marked routable.)

## How to present results to the user

Read `crossChain.action` (per token) and the portfolio `summary`, then advise:

- **`route`** — swap-ready on a configured chain. If it's routable on **more than one**
  configured chain, surface both with their depths and ask which to use (or pick by where the
  rest of the basket lives). Hand the chosen chain's bare object to `sail-swap-quote`.
- **`suggest-sma`** — no routable pool on the configured chain(s), but a deep one on another
  Sail chain. Tell the user and **recommend deploying an SMA on that chain** for this leg
  (e.g. "MORPHO has no Uniswap pool on Base; the deep pool is Uniswap V3 on Unichain — consider
  an SMA on Unichain"). Don't silently drop it.
- **`manual-address`** — liquidity exists but only on a DEX Sail can't fast-route (e.g. only on
  Aerodrome). Offer a custom mandate via `sail-mandates`, or hold the leg.
- **`hold-skip`** — no pool on any scanned Sail chain (the token may live on a non-Sail chain,
  e.g. a HyperEVM-only asset). Recommend holding/dropping it from the strategy.

Always show the resolved **address + decimals + the chain/protocol/depth** you're acting on, so
the user can sanity-check before anything is signed.

## Worked example — "create a DCA strategy of USDC, UNI, HYPE and MORPHO"

```bash
node scripts/resolve-token.mjs USDC UNI HYPE MORPHO --all-chains
```

A typical read of the result:
- **USDC** — the quote asset; swap-ready everywhere (`feeTier: null`, it *is* USDC).
- **UNI** — `route`; routable on Unichain/Base/Arbitrum. Pick by depth or by where the basket
  concentrates.
- **HYPE** — `route` only on **Unichain** (a real ~$4M Uniswap V3 USDC pool); absent/illiquid
  elsewhere. Tell the user HYPE is a Unichain-only leg here.
- **MORPHO** — `route` on **Base** (Uniswap V3 USDC pool); on other chains it exists but has no
  routable USDC pool. If the project is configured for Base, good; if not, `suggest-sma`.

Then, for each `route`/chosen-chain leg, hand `(address, decimals, feeTier)` to
[`sail-swap-quote`](../sail-swap-quote/SKILL.md) → [`sail-template-swap`](../sail-template-swap/SKILL.md).

## Important

- **Decimals are critical** — 25 USDC = `25_000_000` (6 dec); 1 WETH =
  `1_000_000_000_000_000_000` (18 dec). Every cap in a mandate is base units. Trust
  `decimalsSource: "onchain"`; treat `geckoterminal-unverified` as provisional.
- **Addresses are per-chain** — WETH on Unichain ≠ WETH on Base ≠ WETH on Arbitrum. Resolve and
  verify separately per chain; never copy an address across chains.
- **`getPool` is unreliable** on some forks — swap-readiness trusts a non-zero QuoterV2 quote,
  never the V3 factory's `getPool`.
- **Symbol ambiguity / scam collisions.** When a symbol isn't curated, the deepest-pool
  candidate whose on-chain `symbol()` matches is used. A scam token can share a real symbol; the
  liquidity ranking favours the canonical one, but for an obscure symbol glance at the resolved
  `address` and `source` before wiring it in — or pass the intended contract's `0x` address
  directly (address-input bypasses the DEX lookup). Also sanity-check a venue's `volume24hUsd`
  against its `liquidityUsd`: a huge pool with near-zero volume is inflated/non-trading, and a
  big pool whose `pairedSymbol` is a look-alike (e.g. a "HYPE/BASEDHYPE" pool) is a *different*
  asset — depth there does not make *your* token swap-ready.
- **`bestVenue` is USDC-relevant, not the biggest pool.** It's the deepest *Sail-routable,
  USDC-paired* pool (the one a USDC DCA would route through), so it can be smaller than the
  largest pool in `venues[]` (which may be a WETH or look-alike pair).
- **Missing venues ≠ no liquidity.** A chain can be `swapReady: true` (from the on-chain
  QuoterV2 probe) yet show empty `venues[]` with `venuesError` set if GeckoTerminal rate-limited
  that call. Trust `swapReady`; to repopulate the venue map for one chain, re-run
  `node scripts/resolve-token.mjs <SYM> --chain <name> --json`.
- **Rate limits** — GeckoTerminal is keyless and rate-limited; the script throttles and caches
  calls. A big `--all-chains` portfolio takes a moment. Set `GECKO_MIN_SPACING_MS` to tune the
  spacing. A transient GeckoTerminal failure on one chain sets `venuesError` and leaves
  `swapReady` intact (it's from the on-chain probe) — it never aborts the whole run.
