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

The JSON output contract, DEX-classification rules, and full pitfall list are in
[`references/resolution-detail.md`](references/resolution-detail.md) — load only when you
need the schema or a deeper "why".

## When to load

- The user names one or more tokens and you need addresses/decimals for a mandate.
- A user describes a **portfolio / DCA / basket** — resolve every symbol in one call.
- Before `sailor-swap-quote` or `sailor-templates` (swap) — both consume this skill's output.
- Whenever the user asks "can I swap X here?", "where's the best liquidity for X?", or
  "which chain should I use for this strategy?"

## Run it

```bash
node scripts/resolve-token.mjs WETH                    # single token, configured chain(s)
node scripts/resolve-token.mjs LINK --chain unichain   # force one chain
node scripts/resolve-token.mjs 0x4200…0006 --chain base # address input
node scripts/resolve-token.mjs USDC UNI HYPE MORPHO    # PORTFOLIO → rich JSON
node scripts/resolve-token.mjs USDC UNI MORPHO --all-chains --compact   # minimal, agent reads
node scripts/resolve-token.mjs USDC UNI MORPHO --all-chains --optimize  # + minimum chain-set
```

The flags you'll actually use: `--chain` (target one chain), `--all-chains` (map every Sail
mainnet), `--compact` + `--optimize` (cheapest read for a portfolio), `--identify`
(disambiguation only, offline), `--size <usd>` (screen depth against a trade size), `--map
<path>` (offline map). Full flag list: `node scripts/resolve-token.mjs --help`.

## Confirm identity FIRST, before any search

**The #1 failure mode is searching the wrong ticker.** "COIN" could be Coinbase's own Base stock
(`COINc`), the Backed tracker (`bCOIN` on BSC), or a dead crypto token. Resolving before you know
*what the user means* wastes searches and can return a wrong address. The flow is:

1. **Disambiguate offline, in one instant call:**
   ```bash
   node scripts/resolve-token.mjs COIN CRCL HYPE ZAMA ENA --identify
   ```
   This reads `scripts/token-identities.json` and prints three buckets:
   - **Confident** (single canonical meaning) — auto-proceed.
   - **Need confirmation** (multiple candidates, e.g. `COINc` vs `bCOIN` vs `COINB`) — ask ONE
     quick check: "Just confirming — COIN = Coinbase stock (COINc on Base)? Or the Backed tracker
     bCOIN on BSC?" Default to the candidate marked `default: true`.
   - **Unknown** (not in the catalog) — resolve live; the on-chain `symbol()` check is the authority.

2. **Ask once, in one message, covering every ambiguous token together** — never a token-by-token
   interrogation. Example: "Quick check before I resolve: COIN = Coinbase stock (COINc)? CRCL =
   Circle (CRCLc)? Everything else (HYPE, ZAMA, ENA) I'm confident on. Sound right?" Then resolve.

3. **Resolve the confirmed tickers**, not the raw user input — e.g. pass `COINc` not `COIN` once
   confirmed.

The catalog is the ONLY thing safe to cache permanently: it stores *identity* (what a token IS).
It deliberately does NOT store where liquidity lives — that is dynamic and resolved live below.

## Resolve on the funding chain first (the speed rule)

**Never open with `--all-chains`.** It scans 10 chains serially and a couple of live
lookups can run the whole call past the timeout (this is the #1 source of "why is this
taking so long"). The correct order:

1. **Start with the user's funding chain.** When the user says "1K USDC on Base" (or names any
   one chain), resolve on THAT chain first with a targeted `--chain <name>` — one chain, seconds:
   ```bash
   node scripts/resolve-token.mjs HYPE UNI AAVE MORPHO CRCL COIN ZAMA ENA --chain base --compact --size 1000
   ```
2. **Broaden only for the tokens that came back with no liquidity there.** Re-run just those with
   `--all-chains` (or `--chain` on a specific likely home) to find where they DO live. This is a
   small, fast call because it is a handful of symbols, and the offline map answers the majors.
3. **For any token whose only liquidity is on another chain, instruct the user to deploy the SMA
   on that chain** (`crossChain.action: "suggest-sma"`) — see "How to present results" below.

## Liquidity is size-relative and dynamic (screen with `--size`)

A pool that's fine for a $1K buy can be useless for a $100K buy — and pools appear and disappear.
So **always pass `--size`** (the user's per-leg amount) and treat depth as a *screening* signal,
not a final answer:

- Each venue is annotated with `estImpactPct` (rough price impact `2·size/depth`), `fitsSize`
  (impact ≤ 3%), and `suspectVolume` (a big pool with zero 24h volume — seeded/look-alike, not
  real depth; Robinhood's bStocks pools show $100M+ with zero volume and must NOT be trusted).
- The resolver already prefers a venue that fits the size and has real volume, and the
  recommendation flags "~$X is thin for a $Y trade" when it doesn't.
- **The live on-chain quote is the only authority for the real number.** Depth figures are stale
  and concentration-blind; `quote-swap.mjs` (or the QuoterV2 probe) gives the actual `amountOut`
  at the real trade size. Rule of thumb: constant-product pool ≥ 100× trade size, V3 ≥ 20×
  (screen only, always live-quote); retail max-slippage caps 3/5/8% — full model in
  `docs/references/dex-liquidity-adequacy-model.md`.

## Tokenized stocks (Coinbase B20)

Users name the plain stock ticker — "COIN", "CRCL", "NVDA", "AAPL" — but the on-chain symbol
carries a lowercase `c` suffix: `COINc`, `CRCLc`, `NVDAc`. The resolver maps both forms to the
same curated entry automatically (8 decimals, settled in USDC, traded on Base), so pass the symbol
exactly as the user said it; do not correct it. These resolve offline from the curated registry —
no live lookup, no timeout.

## Two-hop swaps are normal routes, not a problem

A token with no *direct* USDC pool can still be bought if it has a Sail-routable pool against the
chain's hub asset (WETH on most chains, WBNB on BNB). That is a **two-swap route** — USDC → WETH →
token — which the same swap template can execute in two legs. It needs **no custom mandate**. The
resolver surfaces it as `twoHop: true` / `twoHopVia: "WETH"`, and the recommendation says "swappable
in two steps". **Never tell the user a two-hop token "needs a custom mandate", "is not tradeable", or
"has no pool"** — just note the extra leg.

The resolver also emits the **executable route** in `twoHopRoute` — `{ viaAddress, viaSymbol,
viaFeeTier, feeTier, probedOnChain }` — so a two-hop token can actually be bought, not just
described. `viaAddress` is the hub (WETH/WBNB), `viaFeeTier` the settlement→hub leg, `feeTier` the
hub→token leg. When `probedOnChain` is true the fee tiers came from a live QuoterV2 probe; when
false, re-resolve with an RPC before wiring the route into a config.

A **zero-volume hub pool is not a two-hop route.** A planted look-alike can share a token's symbol
and carry a huge WETH pool with no real trading (the ZAMA trap: five copies of "ZAMA", each with a
$60M–$277M WETH pool and $0 volume). The resolver rejects those as `suspectVolume` and won't surface
them as a route — and when resolving a symbol it prefers the contract that *actually trades*, so you
get the real token, never the deepest look-alike.

**RPC — ask here, the first time it's genuinely needed, once.** This script reads **only**
`.sail/.env.local` (no shell-var or public-RPC fallback). If nothing is written there, it fails with
`No RPC for <chain>` — that failure is the FIRST point in the journey where the user's own RPC is
required. Guide them to a free-tier Alchemy/Infura key, write `RPC_URL=…` (or the chain-named var)
to `.sail/.env.local`, re-run. Written once, never asked again — every later RPC script reads the
same file.

## How to present results to the user

Read `crossChain.action` (per token) and the portfolio `summary`, then advise:

- **`route`** — swap-ready on a configured chain. If it's routable on **more than one**
  configured chain, the resolver already ranks by depth AND gas cost: a cheaper chain (Base,
  Arbitrum, BSC, …) wins over Ethereum when its liquidity is within ~2x, and Ethereum only wins
  when it is meaningfully deeper (the note says so). Surface both with their depths when the user
  should choose. Hand the chosen chain's bare object to `sailor-swap-quote`.
- **`suggest-sma`** — no routable pool on the configured chain(s), but a deep one on another
  Sail chain (ranked by depth and gas cost). **Instruct the user to deploy the SMA on that chain
  to trade this leg** (a required
  step, not a suggestion): "MORPHO has no USDC pool on Base; the deep USDC pool is on Unichain —
  deploy your SMA on Unichain and I'll trade this leg there." Don't silently drop it or frame it
  as optional.
- **`manual-address`** — liquidity exists but only on a DEX the template can't route (Curve,
  Balancer, non-USDC pair). Offer a custom mandate via `sailor-mandates`, or hold the leg.
- **`hold-skip`** — no pool on any scanned Sail chain. Recommend holding/dropping it.

Always show the resolved **address + decimals + the chain/protocol/depth** you're acting on, so
the user can sanity-check before anything is signed.

## Important

- **Decimals are critical** — 25 USDC = `25_000_000` (6 dec); 1 WETH = `1_000_000_000_000_000_000`
  (18 dec). Trust `decimalsSource: "onchain"` and `"registry"`; treat `"liquidity-map"` and
  `*-unverified` as provisional.
- **Addresses are per-chain** — WETH on Unichain ≠ WETH on Base ≠ WETH on Arbitrum. Resolve and
  verify separately per chain; never copy an address across chains.
- **`bestVenue` is USDC-relevant, not the biggest pool.** It's the deepest *Sail-routable,
  USDC-paired* pool (the one a USDC DCA would route through), so it can be smaller than the
  largest pool in `venues[]` (which may be a WETH or look-alike pair).
- **Volume vs depth** — a huge pool with near-zero `volume24hUsd` is inflated/non-trading, and a
  pool paired with a look-alike symbol is a *different* asset. Depth alone is never the answer.
