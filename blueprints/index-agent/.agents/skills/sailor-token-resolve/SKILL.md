---
name: sailor-token-resolve
description: Resolve tokens named by symbol or address into on-chain metadata and a cross-chain liquidity map, so the agent knows where each token is swap-ready. Use before building any swap, DCA, or lending mandate, and when the user names a portfolio.
station: anytime
---

# sailor-token-resolve — tokens → addresses + where the liquidity lives

Users name tokens by symbol ("WETH", "UNI", "HYPE", "MORPHO") far more often than by
address, and they think in *portfolios* ("a DCA of USDC, UNI and MORPHO"), not single legs —
pass every symbol in one call.

**"token exists" ≠ "token is swap-ready."** A token can have a valid contract with zero
routable liquidity. Swap-ready (on-chain confirmed) means Uniswap V3 QuoterV2 returns a
non-zero USDC→token quote — Sail's executable fast-path route.

## When to load

- The user names one or more tokens and you need addresses/decimals for a mandate.
- A user describes a **portfolio / DCA / basket** — resolve every symbol in one call.
- Before `sailor-swap-quote` or `sailor-templates` (swap) — both consume this skill's output.
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
node scripts/resolve-token.mjs USDC UNI MORPHO --all-chains --compact          # minimal, for agent reads
node scripts/resolve-token.mjs USDC UNI MORPHO --all-chains --optimize         # + minimum chain-set plan
```

Flags: `--chain <ethereum|unichain|base|arbitrum|…>` forces one chain; `--rpc <url>` overrides the
endpoint; `--all-chains` maps every Sail mainnet (even ones without an RPC configured — those use
DexScreener-only data) so you can recommend "put your SMA on chain Y"; `--json` forces the rich
per-token map for a single token; `--compact` shrinks the output to what an agent needs (query →
chains + action only, no venue arrays); `--optimize` appends a basket-level minimum chain-set plan
(`summary.basket`); `--map <path>` points at an offline liquidity map (default
`scripts/liquidity-map.json`). `--compact` + `--optimize` together is the token-cheapest read for
an agent building a portfolio.

**RPC — ask here, the first time it's genuinely needed, once.** This script reads **only**
`.sail/.env.local` — no shell-var fallback, no public-RPC fallback (unlike `sailor doctor`,
which tolerates a public fallback and can go green with none configured). If nothing is
written there yet, it fails with `No RPC for <chain>. Pass --rpc or set RPC_URL in
.sail/.env.local.` — that failure is the FIRST point in the whole journey where the user's own
RPC is actually required; nothing before this station needed it. When it fires: public RPCs are
unreliable for real work (rate-limited, no SLA) — a free-tier key from Alchemy or Infura takes a
couple of minutes to get. Guide them to the signup, take the URL,
write it to `.sail/.env.local` (`RPC_URL=…` for a single chain, or the chain-named var for
multi-chain projects), then re-run. Written once, never asked again — every later RPC-dependent
script (`sailor-swap-quote`'s `quote-swap.mjs`, `doctor`, the runner) reads the same file.

> **Coverage — all 10 Sail mainnets, two tiers of confidence.** The script ships curated
> token tables + a Uniswap QuoterV2 address for the chains where Sail's fast path actually
> routes (ethereum, base, arbitrum, optimism, unichain, bsc). On those, `swapReady` is
> **on-chain confirmed** via a live USDC→token QuoterV2 quote. On the newer chains (world chain,
> hyperevm, megaeth, robinhood) — and anywhere an RPC isn't configured — the script falls back to
> **DexScreener** liquidity data (keyless, covers all 10 mainnets): that tells you *where liquidity
> lives* but is informational, not a swap-readiness guarantee. The two Sail testnets (base sepolia,
> eth sepolia) are not scanned — they have no real DEX liquidity. So: trust `swapReady` on the six
> fast-path chains; treat DexScreener-only chains as "liquidity here, confirm the pool on-chain
> before binding a mandate."

## Liquidity map (offline cache — read it, don't scan live)

`scripts/liquidity-map.json` is a small offline cache of the top ~30 assets: for each, the canonical
contract address + whether a Sail-routable USDC pool exists + its depth, per chain. The resolver
reads it **first** and skips the live index scan for anything it answers, so a portfolio of major
assets resolves in ~1–2 seconds instead of a live 10-chain scan. It is **strictly additive**:
curated registry → liquidity map → live DexScreener/GeckoTerminal, in that order, so the map can
only ever fill gaps, never override a verified answer. Map-sourced entries are marked
`source: "liquidity-map"` (not on-chain verified) and re-verified on-chain whenever an RPC is set.

- **Don't load the map into context** — it's ~50KB. Have `resolve-token.mjs` query it; that's its
  whole job. The agent never reads the file directly.
- **Refresh offline** — `node scripts/build-liquidity-map.mjs` regenerates it from DexScreener
  (keyless). Run it on a schedule; the map's top assets are stable at the day/week scale, but a
  stale map quietly under-reports a token that *gained* a chain since the last refresh.
- **It only covers its seeded tokens.** The long tail still resolves live — slower but correct.
  Grow the seed in `build-liquidity-map.mjs` (not in `resolve-token.mjs`) to widen instant coverage.

## Output shapes (pick the right consumer)

| Invocation | stdout shape |
|---|---|
| 1 symbol, single configured chain / `--chain` | **bare object** — `{address, decimals, feeTier, swapReady, quote, venues[], …}` (the shape `sailor-swap-quote` / `sailor-templates` (swap) expect) |
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
  "dexId": "uniswap",            // raw source id (DexScreener: "uniswap"/"aerodrome"…; GeckoTerminal: "uniswap-v3-base")
  "pool": "0x…", "feeTier": 500, // basis points (500 = 0.05%); null if the pool has no fee in its name
  "pairedSymbol": "USDC", "pairedToken": "0x…",
  "liquidityUsd": 8645941, "volume24hUsd": 22333927,
  "sailRoutable": true,          // Sail's fast path can route it (see below)
  "quoteVerified": true }        // a live on-chain QuoterV2 quote confirmed THIS venue
```

## How it works

1. **Symbol → address** (two layers): curated registry (instant, offline) → **DexScreener**
   search (keyless, primary), then GeckoTerminal search (keyless fallback) for anything not
   curated. Candidates are ranked by pool liquidity; the on-chain `symbol()` check is the final
   authority (a wrong DEX-side match is rejected, not trusted).
2. **On-chain verify** — `symbol()` + `decimals()` via eth_call on every chain that has an RPC.
   This is the source of truth (`decimalsSource: "onchain"`). On an `--all-chains` scan of a chain
   with no RPC, metadata falls back to the DEX index (`decimalsSource: "dexscreener-unverified"`
   or `"geckoterminal-unverified"`) — flag this to the user before wiring it into a mandate.
3. **Liquidity venue map** — DexScreener's keyless pair endpoints (primary, ~300 req/min, flat
   response) return every tracked pool across **all DEXes** (Uniswap V3/V4, Sushiswap, PancakeSwap,
   Aerodrome, …), with protocol, pool address, fee tier and USD depth. GeckoTerminal
   (`/networks/{net}/tokens/{addr}/pools`, ~10–30 req/min) is the deep-coverage fallback when
   DexScreener has no venues. One lookup per token per chain, cached + throttled.
4. **Swap-readiness (on-chain confirmed)** — quotes USDC→token across fee tiers 500/3000/10000
   via Uniswap V3 QuoterV2 and marks the matching venue `quoteVerified: true`. This is the only
   *executable* signal; everything else in `venues[]` is informational.

## `sailRoutable` — what Sail's fast path can actually swap

Sail's `sailor-templates` (swap) fast path routes through **Uniswap V3** (everywhere) and the
**Uniswap V4** Universal Router (on Unichain). Those venues are marked `sailRoutable: true`.
Sushiswap, PancakeSwap, Aerodrome (and Uniswap V2) are detected and surfaced so you can see
*where the liquidity really is*, but they're `sailRoutable: false` — Sail can't route them via
the fast path. If the only liquidity is on a non-routable DEX, the token needs a custom mandate
(`sailor-mandates`) or should be held. (Pools with absurd fees — >10% — are spam and are never
marked routable.)

## How to present results to the user

Read `crossChain.action` (per token) and the portfolio `summary`, then advise:

- **`route`** — swap-ready on a configured chain. If it's routable on **more than one**
  configured chain, surface both with their depths and ask which to use (or pick by where the
  rest of the basket lives). Hand the chosen chain's bare object to `sailor-swap-quote`.
- **`suggest-sma`** — no routable pool on the configured chain(s), but a deep one on another
  Sail chain. Tell the user and **recommend deploying an SMA on that chain** for this leg
  (e.g. "MORPHO has no Uniswap pool on Base; the deep pool is Uniswap V3 on Unichain — consider
  an SMA on Unichain"). Don't silently drop it.
- **`manual-address`** — liquidity exists but only on a DEX Sail can't fast-route (e.g. only on
  Aerodrome). Offer a custom mandate via `sailor-mandates`, or hold the leg — `sailor-strategy`'s
  Act 3 discloses what bespoke authoring against this venue actually entails before the user
  confirms; no need to explain it here.
- **`hold-skip`** — no pool on any scanned Sail chain (the token may live on a chain this
  project isn't configured for). Recommend holding/dropping it from the strategy.

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
`sailor-swap-quote` → `sailor-templates` (swap).

## Important

- **Decimals are critical** — 25 USDC = `25_000_000` (6 dec); 1 WETH =
  `1_000_000_000_000_000_000` (18 dec). Every cap in a mandate is base units. Trust
  `decimalsSource: "onchain"` and `"registry"` (both verified); treat `"liquidity-map"`
  and `dexscreener-unverified` / `geckoterminal-unverified` as provisional.
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
  QuoterV2 probe) yet show empty `venues[]` with `venuesError` set if the liquidity index
  rate-limited that call. Trust `swapReady`; to repopulate the venue map for one chain, re-run
  `node scripts/resolve-token.mjs <SYM> --chain <name> --json`.
- **Rate limits and the timeout** — DexScreener (primary) is keyless at ~300 req/min and is
  throttled + cached; GeckoTerminal (fallback) is keyless but ~10–30 req/min. The script throttles
  and caches both, and widens the gap between calls adaptively when it hits a 429 (`DEX_MIN_SPACING_MS`
  / `GECKO_MIN_SPACING_MS` are the floors, the `*_MAX_SPACING_MS` values the caps). A big
  `--all-chains` portfolio prints a progress line per token as it goes, and a hard deadline
  (`RESOLVE_TIMEOUT_MS`, default 180s) returns whatever mapped so far with a `summary.timedOut` flag
  and `summary.unresolved` list rather than hanging — re-run only the unresolved tokens with a
  targeted `--chain`. A transient provider failure on one chain sets `venuesError` and leaves
  `swapReady` intact (it's from the on-chain probe) — it never aborts the whole run.
