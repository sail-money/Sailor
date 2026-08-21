# Funding paths — the wealth index, not just a crypto index

The index agent's promise widens from "send USDC" to **"send money, once, and I place it."**
USDC stays the silent default; a leg only surfaces a different currency when the asset genuinely
lives on a chain that settles in something else. This reference is the single source of truth for
which currency each chain settles in and how the user funds it. The resolver and onboarding read
this; nothing is researched on-chain or typed by hand.

## The principle

The user's intent is *what they want to own*. The currency is the agent's problem. The agent
absorbs every conversion it safely can and only surfaces a currency when the user must physically
hold it. Crucially, **the agent never asks the user to pick a currency** — it computes the minimum
funding set from the basket and presents one consolidated instruction. The user accepts it or
changes the basket.

## Chain → settlement currency + funding path

| Chain | Chain id | Settles in | Funding path |
|---|---|---|---|
| Ethereum | 1 | USDC | USDC-leg (CCTP v1) |
| Optimism | 10 | USDC | USDC-leg (CCTP v1) |
| Arbitrum | 42161 | USDC | USDC-leg (CCTP v1) |
| Base | 8453 | USDC | USDC-leg (CCTP v1) |
| Unichain | 130 | USDC | USDC-leg (CCTP v1) |
| World Chain | 480 | USDC | USDC-leg (CCTP v2) |
| HyperEVM | 999 | USDC | USDC-leg (CCTP v2) |
| Robinhood | 4663 | USDG (Paxos Global Dollar) | USDG-leg (fund direct, no safe bridge) |
| BNB Smart Chain | 56 | bridged USDC / USDT | USDT-leg (fund direct, no native USDC, no CCTP) |
| MegaETH | 4326 | unverified | unsupported (no CCTP; revisit when a safe path exists) |

## The four funding paths

1. **USDC-leg** — native USDC + a safe burn-and-mint bridge (CCTP v1 or v2). One USDC deposit
   covers every chain in this leg; the agent bridges where the basket needs it.
2. **USDG-leg** — Robinhood Chain only. Settles in USDG; there is no trustless USDC→USDG bridge
   (only lock-and-mint via Across or the Orbit native bridge, both of which carry a locked-pool
   and a ~7-day withdrawal — the exact risk we designed against). So the user funds USDG directly
   to the SMA on Robinhood Chain. The basket's stock tokens trade there against USDG on Uniswap.
3. **USDT-leg** — BNB Smart Chain only. No *native* Circle USDC (Circle's BNB CCTP support is a
   T-bill token, not USDC), and BSC's stablecoins are bridged (Binance-Peg USDC, and USDT as the
   dominant one). Either way there is no safe burn-and-mint path, so the user funds a BSC
   stablecoin directly. The exact settlement symbol (USDT vs Binance-Peg USDC) is resolved at
   build time, not asserted here.
4. **unsupported** — no safe path today. The resolver marks it; onboarding treats any asset
   whose only home is such a chain as a held leg the user cannot currently hold.

## Why USDG and USDT are funded direct, not bridged

The whole bridge standard is "no locked pool to drain" — burn-and-mint via Circle's CCTP. That
path does not exist for USDG (Robinhood) or USDT-on-BNB. The only alternatives are lock-and-mint
bridges with a custodial pool and a slow withdrawal. Funding direct is the honest choice: it costs
the user a second deposit, but it keeps the product's safety story intact and keeps the "agent
handles the rest" feeling alive on that leg.

## How onboarding uses this (the consolidated funding plan)

Given a resolved basket, the agent computes the minimum funding set — the smallest number of
deposits that covers every asset — and presents it as a single instruction. Example:

> Send USDC to `0x…` (Base) for the crypto side, and USDG to `0x…` (Robinhood) for the stocks side.

- One line per funding path that the basket actually touches. A pure-crypto basket is still one
  USDC line, unchanged.
- The user is never asked "which stablecoin do you want to use" or "bridge or fund directly."
  Those are agent decisions and stay invisible.
- The currencies shown are a fact about the basket, not a menu. The user either funds or edits
  the basket.

## Regional note (do not gate the build on this)

Robinhood Stock Tokens are a security issued by a Robinhood Europe entity and restricted in some
jurisdictions. For now we treat them as any other asset — the agent builds them like a token. If a
jurisdiction question ever comes up, it is a launch-time check, not a build-time blocker. Build the
full stocks leg first.

