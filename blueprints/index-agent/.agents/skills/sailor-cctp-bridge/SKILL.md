---
name: sailor-cctp-bridge
description: Author, deploy, simulate, and register the CCTP bridge permission that moves USDC between the user's chains, with self-recipient, domain-allowlist, and per-tx cap enforced on-chain. Use when the index spans more than one chain and USDC must move across them.
station: mandate
---

# sailor-cctp-bridge — the USDC bridge permission

## What this owns

The CCTP bridge permission: a bespoke `IPermission` that authorizes **both halves** of a USDC
cross-chain transfer — `depositForBurn` on the source TokenMessenger (burn) and `receiveMessage`
on the destination MessageTransmitter (mint) — with the safety properties enforced on-chain. It
is the enforcement; the runtime's decision of when and how much to bridge is the policy (see
`sailor-index`, the routing policy).

Why bespoke and not a shared template: none of the shared templates can constrain
`depositForBurn`'s `mintRecipient` (the address that receives the minted USDC on the destination
chain). That one field is the entire safety question, so it must be checked by a purpose-built
contract. Start from `contracts/mandates/CctpBridgePermission.sol`.

## Why this is the safe bridge

Circle's CCTP is burn-and-mint: USDC is burned on the source chain and minted fresh on the
destination. There is no locked pool anywhere to drain, which is what gets hacked in a lock-and-mint
bridge. The remaining risk is the mint landing at the wrong address, and this permission closes that:
it forces `mintRecipient` to be the account's own address. That is safe because the SMA carries the
same CREATE2 address on every chain, so "your own account on the destination chain" is the same 20
bytes the kernel already knows as `ctx.account`.

## The one source of truth for addresses

**Read `references/cctp-addresses.json` — never research CCTP addresses on-chain or from memory.**
That registry pins the settlement currency, TokenMessenger, MessageTransmitter, and domain id for
every chain Circle CCTP covers, verified once against Circle's official docs. It also lists the
selectors and the Iris attestation API base.

CCTP covers these Sail chains, across two generations that share the same burn-and-mint safety model:

- **CCTP v1** (the currently-implemented path): **Ethereum (0), Optimism (2), Arbitrum (3), Base (6),
  Unichain (10)** — `depositForBurn` / `receiveMessage`.
- **CCTP v2** (same safety, new contract set): **World Chain (14), HyperEVM (19)** — documented in
  the registry, not yet wired into the runtime.

The chains with **no CCTP USDC path** are funded direct, never bridged: **BNB (settles in USDT),
Robinhood (settles in USDG), MegaETH (unverified).** The runtime treats "no domain in
`bridge.domains`" as the funded-direct signal and skips the bridge rather than failing.

## Steps (deterministic — no research)

1. **Read the addresses** from `references/cctp-addresses.json` for the source and destination
   chains. Note the constructor takes messenger **and** transmitter (one contract authorizes both
   halves of a transfer on a single chain).
2. **Author** `contracts/mandates/CctpBridgePermission.sol` with `(messenger, transmitter, usdc,
   allowedDomains, maxAmount)` from the registry — the domain allowlist is the set of destination
   domains the user may bridge to, and `maxAmount` is the per-tx cap in USDC base units.
3. **Compile** (`forge build`), then **deploy, simulate, register** as three separate steps:
   `sailor mandate deploy --contract CctpBridgePermission`, then `sailor mandate simulate`, then
   `sailor mandate register`.
4. **Simulate must-fail probes** for every bound: an off-allowlist domain, a wrong `mintRecipient`,
   an over-cap amount, a non-USDC `burnToken`, a wrong target, and `receiveMessage` on the wrong
   target. One must-pass with everything in-bounds (see `sailor-mandates` → simulate-calls).
5. **Register the bounded approve** alongside it (the `approve` step), or use owner-set standing
   approval on the Safe.

The mint half needs **no extra step in onboarding**: the runtime completes it automatically (see
below), so there is no separate mint permission, no relayer to configure, and no additional
registration fee.

## How the mint half works (automatic, no onboarding step)

The runtime (`src/agent.ts`) does the whole trip. The burn half (`approve` + `depositForBurn`)
destroys USDC on the source chain; CCTP v1 does not auto-relay, so `completePendingMints` reads
the burn's tx hash from `.sail/activity.jsonl`, fetches the signed message + attestation from
Circle's Iris API (`https://iris-api.circle.com/v1/messages/{sourceDomain}/{txHash}`, free and
keyless), and emits a `receiveMessage` dispatch on the destination chain. It runs before the
empty-portfolio guard so a burned-but-unminted bridge always completes. Replay is impossible: the
MessageTransmitter rejects a repeated message on-chain, and a valid attestation only exists for a
burn whose `mintRecipient` the burn half already forced to the account.

## Pitfalls

- Read addresses from `references/cctp-addresses.json`, never from memory or on-chain — that
  re-research is the single biggest source of onboarding friction.
- CCTP domain ids are not chain ids. Ethereum is domain 0, not chain 1.
- `mintRecipient` is bytes32, not address. Compare against `bytes32(uint256(uint160(ctx.account)))`.
- `depositForBurnWithCaller` is intentionally NOT allowed; keep the surface to two selectors
  (`depositForBurn` + `receiveMessage`).
- The per-period cap is agent-enforced, not on-chain. State that in the header, and size the
  per-tx cap so the agent cannot move more in one call than the user is prepared to lose at once.
- Only the chains listed in `references/cctp-addresses.json` can bridge; every other chain is
  funded direct. World Chain's domain 14 and HyperEVM's domain 19 are CCTP v2 (different contract
  set and selector) — do not mix v2 addresses into the v1 runtime path without wiring the v2 flow.

## Handoff

→ `sailor-agent-build`: the runtime bridges when a token's liquidity forces a move to another named
chain, and completes the mint automatically on the next run. Then `sailor-automation` /
`sailor-operate` to run and monitor.
