# Funding paths — the wealth portfolio, not just a crypto portfolio

The portfolio agent's promise widens from "send USDC" to **"send money, once, and I place it."**
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
| Base | 8453 | USDC | USDC-leg (CCTP v1) — also carries Coinbase tokenized stocks |
| Unichain | 130 | USDC | USDC-leg (CCTP v1) |
| World Chain | 480 | USDC | USDC-leg (CCTP v2) |
| HyperEVM | 999 | USDC | USDC-leg (CCTP v2) |
| Robinhood | 4663 | USDG (Paxos Global Dollar, 6 dec) | USDG-leg (Across from/to the USDC chains, or fund direct) — optional alternative for stocks |
| BNB Smart Chain | 56 | bridged USDC / USDT | USDT-leg (fund direct, no native USDC, no CCTP) |
| MegaETH | 4326 | unverified | unsupported (no CCTP; revisit when a safe path exists) |

## Tokenized stocks: Base first, Robinhood optional

**Tokenized stocks are now a USDC asset, not a separate leg.** Coinbase launched tokenized U.S.
stocks natively on Base (Aug 2026) under its B20 standard: NVDAc, AAPLc, METAc and GOOGLc (note the
lowercase `c` suffix — a user saying "NVDA" maps to `NVDAc` on Base), each backed 1:1 by the
underlying share held by Alpaca, settled in USDC, and traded on Aerodrome and other Base venues.
More tickers follow over time.

This means a basket that includes stocks funds with the **same USDC deposit** as the crypto side —
one deposit, one leg, no second currency. Robinhood stock tokens (settled in USDG) remain an
**optional alternative**, used only when a specific stock is not on Base, or the user prefers
Robinhood. The agent never defaults to Robinhood; it defaults to Base.

## The four funding paths

1. **USDC-leg** — native USDC + a safe burn-and-mint bridge (CCTP v1 or v2). One USDC deposit
   covers every chain in this leg; the agent bridges where the basket needs it. Base stock tokens
   live here, so the crypto and stock sides of a basket are usually one USDC deposit.
2. **USDG-leg** — Robinhood Chain only, and optional. Settles in USDG (Paxos; 6 decimals on
   Robinhood Chain). CCTP does not reach it and there is no USDC liquidity there, but the agent CAN
   move dollars in and out through **Across**: one `depositV3` on the source SpokePool, and a relayer
   delivers USDG (or USDC on the way back) to the SMA's own address in about two seconds, repaid later
   through Across's optimistic settlement. That is intent-based, not lock-and-mint — no pooled custody
   of the user's funds beyond the seconds before a fill, and an unfilled deposit is refunded to the
   depositor (the SMA) after the fill deadline. Bounded on-chain by `AcrossBridgePermission`
   (depositor and recipient pinned to the SMA, both tokens, the destination, a per-tx cap, an output
   floor, fresh quote, bounded deadline, empty message). The canonical Orbit bridge and LayerZero's
   USDG OFT are the alternatives; both are slower and the OFT needs a native fee, so Across is the
   default route. Funding USDG directly still works and skips the bridge entirely.
   Use this leg only when a stock is not on Base or the user prefers Robinhood.
3. **USDT-leg** — BNB Smart Chain only. No *native* Circle USDC (Circle's BNB CCTP support is a
   T-bill token, not USDC), and BSC's stablecoins are bridged (Binance-Peg USDC, and USDT as the
   dominant one). Either way there is no safe burn-and-mint path, so the user funds a BSC
   stablecoin directly. The exact settlement symbol (USDT vs Binance-Peg USDC) is resolved at
   build time, not asserted here.
4. **unsupported** — no safe path today. The resolver marks it; onboarding treats any asset
   whose only home is such a chain as a held leg the user cannot currently hold.

## Why USDT is funded direct, and why USDG is bridged by Across

The whole bridge standard is "no locked pool to drain" — burn-and-mint via Circle's CCTP. That
path does not exist for USDG (Robinhood) or USDT-on-BNB. For Robinhood, Across's intent-based
model (a relayer fills from its own capital in seconds, exposure bounded per transaction by the
permission) is acceptable and is what the runtime uses; for BNB there is still no acceptable path,
so funding direct remains the honest choice there. Base stocks need none of this — they settle in
USDC on the same CCTP v1 leg as everything else.

## How onboarding uses this (the consolidated funding plan)

Given a resolved basket, the agent computes the minimum funding set — the smallest number of
deposits that covers every asset — and presents it as a single instruction. Examples:

> Send USDC to `0x…` (Base). That one deposit covers everything.

> Send USDC to `0x…` (Base) for the crypto side, and USDG to `0x…` (Robinhood) for the one stock that
> only trades there.

- One line per funding path that the basket actually touches. A pure-crypto basket, and a basket
  with Base stock tokens, are both one USDC line.
- The user is never asked "which stablecoin do you want to use" or "bridge or fund directly."
  Those are agent decisions and stay invisible.
- The currencies shown are a fact about the basket, not a menu. The user either funds or edits
  the basket.

## Regional note (do not gate the build on this)

Both stock-token issuers are restricted in some jurisdictions: Coinbase's Base stock tokens are
issued under Abu Dhabi Global Market regulation and available to eligible investors outside the US;
Robinhood Stock Tokens are a security issued by a Robinhood Europe entity, also jurisdiction-limited.
For now we treat both as any other asset — the agent builds them like a token. If a jurisdiction
question ever comes up, it is a launch-time check, not a build-time blocker. Build the full stocks
leg first.
