# .sail/portfolio.json — the runtime's machine config

Written once at onboarding (Act 3), after every asset is resolved and the routing policy is
set. This is the file `src/agent.ts` reads every tick; it is derived from the spec, never typed
by hand, and it is the single source of truth the runtime trusts. Regenerate it from the spec,
never edit it in place.

## Shape

```json
{
  "chains": [8453, 42161],
  "settlement": {
    "8453":  { "symbol": "USDC", "address": "0x…", "decimals": 6 },
    "42161": { "symbol": "USDC", "address": "0x…", "decimals": 6 }
  },
  "router": { "8453": "0x…", "42161": "0x…" },
  "quoter": { "8453": "0x…", "42161": "0x…" },
  "bridge": {
    "messenger":   { "8453": "0x…", "42161": "0x…" },
    "transmitter": { "8453": "0x…", "42161": "0x…" },
    "domains": { "8453": 6, "42161": 3 },
    "maxPerTxUsd": 1000
  },
  "basket": [
    {
      "symbol": "WETH",
      "weight": 0.4,
      "chains": [
        { "chainId": 42161, "address": "0x…", "decimals": 18, "feeTier": 3000 },
        { "chainId": 8453, "address": "0x…", "decimals": 18, "feeTier": 3000 }
      ]
    },
    {
      "symbol": "NVDAc",
      "weight": 0.6,
      "chains": [
        { "chainId": 8453, "address": "0x…", "decimals": 18, "feeTier": 500 }
      ]
    },
    {
      "symbol": "SKY",
      "weight": 0.2,
      "chains": [
        {
          "chainId": 1,
          "address": "0x…",
          "decimals": 18,
          "feeTier": 3000,
          "via": { "address": "0x…WETH…", "feeTier": 500 }
        }
      ]
    }
  ],
  "dca": { "amountUsd": 500, "periodSec": 604800 },
  "rebalanceBandBps": 1000,
  "rebalancePeriodSec": 604800,
  "maxSlippageBps": 100,
  "report": { "cadenceSec": 604800, "channel": "telegram" }
}
```

A Coinbase tokenized stock (NVDAc) is just a Base asset that settles in USDC. When a basket instead
uses a Robinhood stock token, the Robinhood chain (4663) is added to `chains`, `settlement`,
`router` and `quoter` with `{ "symbol": "USDG", "decimals": 18 }` — the one place a second currency
enters the config. (See `references/funding-paths.md`.)

### Two-hop assets (no direct USDC pool)

An asset with no direct USDC pool but a routable pool against the chain's hub asset (WETH/WBNB) is
**swappable in two steps** — settlement → hub → token. It is fully executable, not a special case;
the config just carries one extra field so the runtime can build the two-leg path:

- `basket[].chains[].via` — `{ "address": "<hub 0x>", "feeTier": <settlement→hub fee> }`. Its
  presence is the "two-hop" marker. The token's own `feeTier` is the **hub→token** leg.
- `via.address` is the chain's hub (WETH on Ethereum/Base/Arbitrum/Optimism/Unichain/World Chain,
  WBNB on BNB). `via.feeTier` is the settlement→hub leg; `feeTier` is the hub→token leg. The
  resolver emits both in `twoHopRoute` (`viaAddress`, `viaFeeTier`, `feeTier`), on-chain probed
  when an RPC is set — write them verbatim. If `twoHopRoute` came back **not** probed
  (`probedOnChain: false`), re-resolve with an RPC before writing a `via`; never write a `via` with
  a null fee tier.

The runtime values and buys a two-hop asset through the same path (reverse for the sell/valuation
leg), so a two-hop token is priced and rebalanced exactly like a direct one. A token whose `via` is
absent is treated as a direct single-hop swap — the runtime never invents a hop.

## How the loop uses this

Every tick the runtime values the whole portfolio in the value-accounting base (6-decimal dollar
units, the USDC base), then:

1. **Sells** any asset whose weight drifted above its target by more than the band (back to its
   chain's settlement currency).
2. **Buys** toward target. How it buys depends on the mode chosen at onboarding:

- **Invest mode** (`dca` omitted, the default) — buy each asset's shortfall toward its target, up
  to `bridge.maxPerTxUsd` per trade. A fresh deposit is idle settlement currency, so the next tick
  invests it across the whole basket.
- **DCA mode** (`dca` present) — buy `dca.amountUsd` every `dca.periodSec`, split across assets by
  target weight, and leave the rest of the idle funding untouched.

Both modes route buys to the chain that holds the **most** settlement currency, and each buy is
capped at `min(shortfall, available cash)` against a **shared per-chain spend budget** read once up
front — so partial idle cash still moves every laggard toward target, and the sum of queued buys in
one tick never exceeds on-chain holdings. **USDC chains are bridged
when none does** — every shortfall bound for the same chain is pooled into one bridge per tick, sized to
`min(pooled need, source balance, per-tx cap)` (partial, never all-or-nothing); USDG on Robinhood is bridged by Across when `bridge.across` names the route, otherwise funded
direct; USDT (BNB) is always funded direct** — when a funded-direct chain is short, the runtime logs
"funded direct" and waits for a deposit rather than bridging. Base
stock tokens need no special case: they settle in USDC, so they buy like any other Base asset.

## Field notes

- `chains` — the full chain set the SMA is deployed on (chain ids, not CCTP domains). The SMA must
  be deployed on each before the loop runs.
- `settlement` — **per chain, the settlement currency** (symbol + address + decimals). USDC (6 dec)
  on the 7 USDC chains (including Base, which also carries Coinbase tokenized stocks), USDG (18 dec)
  on Robinhood (optional alternative for stocks), USDT (18 dec) on BNB. All value math is
  normalized to the 6-decimal base via `toBase`/`fromBase` in `src/agent.ts`; the decimals here are
  what make that normalization correct.
- `router` / `quoter` — per-chain resolved addresses (Uniswap V3 SwapRouter02, QuoterV2), keyed by
  chain id as a string.
- `bridge.messenger` — the CCTP TokenMessenger on each source chain (the burn half). **Present only
  on USDC chains.**
- `bridge.transmitter` — the CCTP MessageTransmitter on each USDC chain (the mint half). The runtime
  calls `receiveMessage` here to complete a burn, using the message + attestation it fetches from
  Circle's Iris API.
- `bridge.domains` — the CCTP **domain** id for each USDC chain (not the chain id). The presence of
  a domain is the runtime's "this chain can be bridged" signal; Robinhood and BNB have no entry, so
  they are never bridged. Verified against Circle's docs at build time; both messenger and
  transmitter come from the `sailor-cctp-bridge` skill's `references/cctp-addresses.json` registry.
- `bridge.maxPerTxUsd` — the per-transaction bridge cap, matched to the `CctpBridgePermission`
  constructor's `MAX_AMOUNT` (in whole USDC). The runtime also uses it as a conservative per-tick
  buy cap.
- `bridge.across` — optional. Across V3 routes for chains CCTP does not reach (Robinhood Chain, in
  USDG). `routes[]` entries: `{ source, dest, spokePool, destinationSpokePool, inputToken,
  outputToken, permission, maxFeeBps, fillDeadlineSec }` — one per direction. The runtime picks CCTP
  when both chains are USDC chains and Across otherwise; it quotes Across's API, refuses fees above
  `maxFeeBps`, sends one `depositV3` per (source → dest) per run with depositor and recipient pinned
  to the SMA and an empty message, and records the arrival only after the fill transaction is
  verified on the destination SpokePool (an expired deposit is recorded as refunded). `permission` is
  the registered `AcrossBridgePermission` on the source chain, pinned on the dispatch — and the
  switch: a route without it is treated as not bridgeable (funded direct) until registration.
- `dca` — optional. Present means cadence-DCA mode; absent means invest-on-deposit mode.
- `rebalanceBandBps` — how far a weight may drift (basis points) before the agent trims it; 1000 = ±10pp, the default. Buys toward target are not gated by the band.
- `rebalancePeriodSec` — optional. How often (seconds) the agent trims overweight holdings.
- `report` — optional. When present, the agent sends a Telegram report every `cadenceSec`. Secrets
  (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) read from `.sail/.env.local`, never written here.
- **Approve model is agent-managed.** The runtime grants its own router allowance when it is short
  (via the `BoundedErc20Approve` permission, registered alongside the swap permission) before each
  swap — the owner never signs a standing approval and nothing in this file needs an allowance
  field. The on-chain swap bounds (router/token allowlist, per-tx cap, min-out) still apply to every
  trade regardless of the allowance.
- `basket[].weight` — sums to 1.0 across the basket, global (not per chain).
- `basket[].chains` — the routing preference, ordered **gas-aware** (the resolver's ranked order: a
  cheaper chain wins within ~2× of a pricier one's depth; Ethereum only ranks first when it is
  meaningfully deeper). The runtime buys on the first chain that holds enough settlement currency,
  and (USDC chains only) bridges to the first chain when none does. Write the chain objects in the
  resolver's `crossChain.routableChains` order — never re-sort by raw depth, which would silently
  prefer an expensive L1 over a cheaper chain.
- `basket[].chains[].feeTier` — the token-side leg fee (basis points). For a direct asset it is the
  settlement→token fee; for a two-hop asset (`via` present) it is the hub→token leg. Used only when
  `dex` is `uniswap-v3` (or absent).
- `basket[].chains[].dex` — the DEX family that executes this token's swap: `"uniswap-v3"` (default,
  omit it) or `"aerodrome"` (Aerodrome Slipstream on Base). Write it from the resolver's per-chain
  `dex` field.
- `basket[].chains[].tickSpacing` — Aerodrome Slipstream pool tick spacing (int24). **Replaces**
  `feeTier` as the path's hop value when `dex` is `"aerodrome"`; write it from the resolver's
  `tickSpacing` field. Aerodrome pools do not have fee tiers — never write a `feeTier` for an
  Aerodrome token.
- `basket[].chains[].via` — optional; `{ address, feeTier }` for a two-hop asset (see "Two-hop
  assets" above). `via.feeTier` is the settlement→hub leg. Absent = direct single-hop. (Uniswap V3
  only — Aerodrome two-hop is not yet supported.)

### Aerodrome assets (Base)

An asset whose only real USDC pool is on **Aerodrome Slipstream** (e.g. cbHYPE) is executable, not a
"hold" — the runtime routes it through Aerodrome's SwapRouter with a `tickSpacing` path. Two config
additions make that work:

- The token's chain object carries `"dex": "aerodrome"` and `"tickSpacing": <int24>` (from the
  resolver), instead of a `feeTier`.
- The top-level config adds an `aerodrome` block with the per-chain router + quoter (Base):
  ```json
  "aerodrome": {
    "router": { "8453": "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F" },
    "quoter": { "8453": "0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555" }
  }
  ```
  These are the Gauges V3 (newest) CL factory addresses — `0x698Cb2` is the single-factory
  SwapRouter for `0xf8f2eB…` (where cbHYPE's USDC pool lives) and `0xCd2A7D` is the
  MixedQuoterV3. The older `0xBE6D…`/`0x254c…` pair serve the LEGACY factory and cannot route
  cbHYPE. The mandate is already DEX-agnostic, so no new permission is needed — the same swap
  permission authorizes the Aerodrome router.
