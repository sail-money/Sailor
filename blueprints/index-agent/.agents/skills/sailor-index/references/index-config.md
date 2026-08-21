# .sail/index.json — the runtime's machine config

Written once at onboarding (Act 3), after every asset is resolved and the routing policy is
set. This is the file `src/agent.ts` reads every tick; it is derived from the spec, never typed
by hand, and it is the single source of truth the runtime trusts. Regenerate it from the spec,
never edit it in place.

## Shape

```json
{
  "chains": [8453, 42161, 4663],
  "settlement": {
    "8453":  { "symbol": "USDC", "address": "0x…", "decimals": 6 },
    "42161": { "symbol": "USDC", "address": "0x…", "decimals": 6 },
    "4663":  { "symbol": "USDG", "address": "0x…", "decimals": 18 }
  },
  "router": { "8453": "0x…", "42161": "0x…", "4663": "0x…" },
  "quoter": { "8453": "0x…", "42161": "0x…", "4663": "0x…" },
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
      "symbol": "NVDA",
      "weight": 0.6,
      "chains": [
        { "chainId": 4663, "address": "0x…", "decimals": 18, "feeTier": 500 }
      ]
    }
  ],
  "dca": { "amountUsd": 500, "periodSec": 604800 },
  "rebalanceBandBps": 500,
  "rebalancePeriodSec": 604800,
  "maxSlippageBps": 100,
  "report": { "cadenceSec": 604800, "channel": "telegram" }
}
```

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

Both modes route buys to the chain that holds enough settlement currency. **USDC chains are bridged
when none does; USDG (Robinhood) and USDT (BNB) chains are funded direct and never bridged** — when
one is short, the runtime logs "funded direct" and waits for a deposit rather than bridging.

## Field notes

- `chains` — the full chain set the SMA is deployed on (chain ids, not CCTP domains). The SMA must
  be deployed on each before the loop runs.
- `settlement` — **per chain, the settlement currency** (symbol + address + decimals). USDC (6 dec)
  on the 7 USDC chains, USDG (18 dec) on Robinhood, USDT (18 dec) on BNB. All value math is
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
- `dca` — optional. Present means cadence-DCA mode; absent means invest-on-deposit mode.
- `rebalanceBandBps` — how far a weight may drift (basis points) before the agent trades.
- `rebalancePeriodSec` — optional. How often (seconds) the agent trims overweight holdings.
- `report` — optional. When present, the agent sends a Telegram report every `cadenceSec`. Secrets
  (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) read from `.sail/.env.local`, never written here.
- `basket[].weight` — sums to 1.0 across the basket, global (not per chain).
- `basket[].chains` — ordered deepest-liquidity-first. That order IS the routing preference: the
  runtime buys on the first chain that holds enough settlement currency, and (USDC chains only)
  bridges to the first chain when none does.
