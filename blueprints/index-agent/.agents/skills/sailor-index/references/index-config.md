# .sail/index.json — the runtime's machine config

Written once at onboarding (Act 3), after every token is resolved and the routing policy is
set. This is the file `src/agent.ts` reads every tick; it is derived from the spec, never typed
by hand, and it is the single source of truth the runtime trusts. Regenerate it from the spec,
never edit it in place.

## Shape

```json
{
  "chains": [8453, 42161, 130],
  "usdc": { "8453": "0x…", "42161": "0x…", "130": "0x…" },
  "router": { "8453": "0x…", "42161": "0x…", "130": "0x…" },
  "quoter": { "8453": "0x…", "42161": "0x…", "130": "0x…" },
  "bridge": {
    "messenger": { "8453": "0x…", "42161": "0x…", "130": "0x…" },
    "domains": { "8453": 6, "42161": 3, "130": 10 },
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
    }
  ],
  "dca": { "amountUsd": 500, "periodSec": 604800 },
  "rebalanceBandBps": 500,
  "maxSlippageBps": 100
}
```

## How the loop uses this

Every tick the runtime values the whole portfolio in USDC, then:

1. **Sells** any token whose weight drifted above its target by more than the band (back to USDC).
2. **Buys** toward target. How it buys depends on the mode chosen at onboarding:

- **Invest mode** (`dca` omitted, the default) — buy each token's shortfall toward its target, up
  to `bridge.maxPerTxUsd` per trade. A fresh USDC deposit is idle USDC, so the next tick invests it
  across the whole basket; large deposits spread over several ticks by the per-trade cap.
- **DCA mode** (`dca` present) — buy `dca.amountUsd` every `dca.periodSec`, split across tokens by
  target weight, and leave the rest of the idle USDC untouched as the pool that funds future
  periods. Between periods it still rebalances: sell overweight tokens, and buy back tokens that
  drift below their band.

Both modes route buys to the chain that holds enough USDC, and bridge USDC when none does.

Field notes:

- `chains` — the full user-named chain set (chain ids, not CCTP domains). The SMA must be
  deployed on each before the loop runs.
- `usdc` / `router` / `quoter` — per-chain resolved addresses (USDC, Uniswap V3 SwapRouter02,
  QuoterV2), keyed by chain id as a string.
- `bridge.messenger` — the CCTP TokenMessenger on each source chain.
- `bridge.domains` — the CCTP **domain** id for each chain (not the chain id). Verify against
  Circle's supported-domains page at deploy time.
- `bridge.maxPerTxUsd` — the per-transaction bridge cap, matched to the `CctpBridgePermission`
  constructor's `MAX_AMOUNT` (in whole USDC). The runtime also uses it as a conservative
  per-tick buy cap.
- `dca` — optional. Present means cadence-DCA mode (`amountUsd` per `periodSec`); absent means
  invest-on-deposit mode (deploy all idle USDC). This is the single switch set by the one
  onboarding question.
- `basket[].weight` — sums to 1.0 across the basket, global (not per chain).
- `basket[].chains` — ordered deepest-liquidity-first. That order IS the routing preference:
  the runtime buys on the first chain that holds enough USDC, and bridges to the first chain
  when none does. Order comes from `sailor-token-resolve` liquidity at resolution time.
