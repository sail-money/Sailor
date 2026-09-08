---
name: sailor-bridge
description: "Move the settlement currency between the chains a basket needs, and author, deploy, simulate and register the permission that bounds it: CCTP (preferred, Circle's burn-and-mint) between native-USDC chains, Across (intent-based, relayer-filled) only for chains CCTP does not reach. Use when a portfolio spans more than one chain, before authoring a bridge permission, or to decide which mechanism a route uses."
station: mandate
---

# sailor-bridge — moving settlement currency between chains, and the permissions that bound it

## What this owns

Two bespoke `IPermission` contracts and the rule for choosing between them:

- **`CctpBridgePermission`** — Circle's CCTP, burn on the source `TokenMessenger`, mint on the
  destination `MessageTransmitter`, USDC only, `mintRecipient` forced to the account.
- **`AcrossBridgePermission`** — Across V3, one `depositV3` on the source SpokePool, filled by a
  relayer on the destination, depositor and recipient forced to the account, output floored.

The permission is the enforcement; the runtime's decision of when and how much to bridge is the
policy (see `sailor-portfolio`, the routing policy). The runtime picks the mechanism per route with
the same rule written below, so onboarding and execution never disagree.

Why bespoke and not a shared template: no shared template can constrain `mintRecipient` (CCTP) or
`recipient`/`depositor`/`outputAmount` (Across). Those fields are the entire safety question, so
they are checked by purpose-built contracts. Start from `contracts/mandates/CctpBridgePermission.sol`
and `contracts/mandates/AcrossBridgePermission.sol`.

## The decision rule — CCTP first, Across only where CCTP cannot deliver

| Route | Mechanism | Why |
|---|---|---|
| Native-USDC chain → native-USDC chain (both have a CCTP domain: Ethereum 0, Optimism 2, Arbitrum 3, Base 6, Unichain 10; World Chain 14 and HyperEVM 19 on CCTP v2, not yet wired) | **CCTP** | The issuer burns and mints; no third-party contract ever holds the funds; the only trust is Circle's attestation, which the user already accepts by holding USDC. |
| A chain with no CCTP domain whose settlement currency has a supported Across route (Robinhood Chain, USDG) | **Across** | Intent-based: the relayer fills from its own capital in seconds and takes the settlement risk; the user's exposure is one capped deposit for the seconds before a fill, refunded to the depositor if never filled. Adds Across's upgradeable contracts to the trust set, bounded by the per-tx cap. |
| A chain with neither (BNB Smart Chain in USDT, MegaETH) | **Funded direct** | No path with an acceptable trust model. The runtime logs "funded direct" and waits for a deposit. |

Rules that follow from the table:

1. **Never use Across where CCTP works.** If both ends have a CCTP domain the route is CCTP, even if
   Across is faster. The runtime enforces this (`bridgeVia`: CCTP when both chains have domains,
   Across otherwise, null if neither).
2. **One Across permission per direction.** Robinhood needs the inbound route (USDC on Base →
   USDG) and the outbound one (USDG → USDC on Base) so trims can come home.
3. **A route is live only once its permission is registered** and named in
   `.sail/portfolio.json` (`bridge.permission[chain]` for CCTP mints, `bridge.across.routes[].permission`
   for Across). Until then the runtime treats the destination as funded direct rather than
   retrying denied dispatches.
4. **Every arrival is confirmed on-chain, never inferred from a balance**: CCTP by the destination
   transmitter's `usedNonces`, Across by verifying the fill transaction on the destination SpokePool.

## The one source of truth for addresses

**Read the registries — never research bridge addresses on-chain or from memory:**

- `references/cctp-addresses.json` — settlement currency, TokenMessenger, MessageTransmitter and
  domain id for every chain CCTP covers, plus the selectors and the Iris attestation API. Chains with
  no CCTP path are listed under `unbridged` with the reason.
- `references/across-routes.json` — SpokePool per chain, settlement token and decimals, the
  SpokePool's quote and deadline buffers, the `depositV3` selector, the `FundsDeposited` event
  topic, the API endpoints, the admin structure, and the recommended bounds.

## Steps (deterministic — no research)

1. **Classify each cross-chain leg** with the decision rule. Present the mechanism per route in the
   mandate plan (`sailor-mandate-planner`) with its trust model stated in one line, and for Across
   the fact that the SpokePools are upgradeable by Across governance (a 3-of-N Safe on Ethereum).
2. **Read the addresses** from the registries.
3. **Author the permission(s)**:
   - CCTP: `CctpBridgePermission(messenger, transmitter, usdc, allowedDomains, maxAmount)` — one
     per chain; it authorizes both halves of a transfer on that chain. `allowedDomains` is the set
     of destination domains the user may bridge to; `maxAmount` the per-tx cap in USDC base units.
   - Across: `AcrossBridgePermission(spokePool, inputToken, outputToken, destinationChainId,
     maxInputAmount, maxFeeBps, maxQuoteAge, maxFillDeadline, inputDecimals, outputDecimals)` — one
     per route direction. Recommended: cap = `bridge.maxPerTxUsd`, `maxFeeBps` 30, `maxQuoteAge`
     3600, `maxFillDeadline` 21600 (the SpokePool's own buffer).
   - The source chain's `BoundedErc20Approve` must list the messenger (CCTP) or the SpokePool
     (Across) as a spender for the settlement currency.
4. **Compile** (`forge build`; both contracts ship with Foundry tests), then **deploy, simulate,
   register** as three separate steps per contract: `sailor mandate deploy --contract <Name>
   --args-file <args>`, `sailor mandate simulate --calls <probes>`, `sailor mandate register`.
5. **Simulate must-fail probes for every bound** — the standard is a must-fail probe PROVEN TO
   REJECT (see `sailor-mandates` → simulate-calls). CCTP: off-allowlist domain, wrong
   `mintRecipient`, over-cap amount, non-USDC `burnToken`, wrong target, `receiveMessage` on the
   wrong target. Across: wrong recipient, wrong depositor, wrong input or output token, wrong
   destination, over cap, output below the floor, exclusive relayer set, exclusivity deadline set,
   stale quote, future quote, past or too-far fill deadline, non-empty message, native value, wrong
   target. `scripts/build-across-probes.mjs` generates the Across set; regenerate right before
   simulating, the probes carry live timestamps.
6. **Name the registered addresses in `.sail/portfolio.json`** — this is what switches a route on.

## How arrivals complete (automatic, no onboarding step)

- **CCTP**: the burn half (`approve` + `depositForBurn`) destroys USDC on the source chain; CCTP v1
  does not auto-relay. `completePendingMints` reads the confirmed burn's tx hash from the ledger,
  fetches the signed message + attestation from Circle's Iris API (free, keyless; the literal
  `PENDING` answer means wait), checks the destination transmitter's `usedNonces` for the burn's
  nonce, and emits `receiveMessage` on the destination until it is used. Replay is impossible: the
  transmitter rejects a repeated message, and a valid attestation only exists for a burn whose
  `mintRecipient` the burn half already forced to the account.
- **Across**: `completePendingAcrossFills` reads the `depositId` from the confirmed deposit's
  receipt (`FundsDeposited`, topic index 2), asks Across's status API, and records `filled` only
  after the fill transaction is verified on the destination SpokePool. `expired` becomes
  `bridgeRefunded`: the USDC is back on the source chain and counts there again.
- Both run before the empty-portfolio guard so a departed-but-unarrived bridge always completes,
  and both feed `pendingBridgeUsd`, so money in flight is counted in total value throughout.

## Pitfalls

- Read addresses from the registries, never from memory or on-chain — re-research is the single
  biggest source of onboarding friction.
- CCTP domain ids are not chain ids. Ethereum is domain 0, not chain 1.
- `mintRecipient` is bytes32, not address. Compare against `bytes32(uint256(uint160(ctx.account)))`.
- `depositForBurnWithCaller` is intentionally NOT allowed; keep the CCTP surface to two selectors.
- Across `depositV3` is payable; the permission requires zero native value. `exclusiveRelayer`
  must be the zero address and `exclusivityDeadline` zero — the route is open to every relayer.
- USDG on Robinhood Chain has 6 decimals, not 18. Read decimals from the registry, never assume.
- The per-period cap is agent-enforced, not on-chain. Size the per-tx cap so the agent cannot move
  more in one call than the user is prepared to have in flight at once.
- A bridge that has departed but not arrived blocks a second bridge to the same destination (the
  in-flight guard). Do not "fix" a slow attestation by re-bridging.

## Handoff

→ `sailor-agent-build`: the runtime bridges when a token's liquidity forces a move to another named
chain and completes every arrival on the next runs. Then `sailor-automation` / `sailor-operate`
to run and monitor.
