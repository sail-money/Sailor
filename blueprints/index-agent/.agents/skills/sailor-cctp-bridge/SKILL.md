---
name: sailor-cctp-bridge
description: Author, deploy, simulate, and register the CCTP bridge permission that moves USDC between the user's chains, with self-recipient, domain-allowlist, and per-tx cap enforced on-chain. Use when the index spans more than one chain and USDC must move across them.
station: mandate
---

# sailor-cctp-bridge — the USDC bridge permission

## What this owns

The CCTP bridge permission: a bespoke `IPermission` that authorizes the burn half of a USDC
cross-chain transfer (`depositForBurn` on Circle's TokenMessenger), with the safety properties
enforced on-chain. It is the enforcement; the runtime's decision of when and how much to bridge
is the policy (see `sailor-index`, the routing policy).

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

## What the permission enforces on-chain

| Bound | Check in `evaluate()` |
|---|---|
| Venue | `ctx.target == MESSENGER` |
| Function | `ctx.selector == 0x6fd3504e` (`depositForBurn`) |
| Asset | `burnToken == USDC` |
| Size | `amount <= MAX_AMOUNT` |
| Destination | `destinationDomain ∈ allowedDomains` |
| Recipient | `mintRecipient == bytes32(uint256(uint160(ctx.account)))` |
| Value | `ctx.value == 0` |

## What it leaves to the agent (off-chain)

- the **per-period cap** (cumulative volume over time), stated in the header,
- which allowed domain to pick, and when,
- the `approve()` that precedes `depositForBurn` (covered by a bounded approve permission, not here).

## Steps

1. **Resolve the source chain's CCTP TokenMessenger and USDC addresses** on-chain (never from docs).
2. **Map each named destination chain to its CCTP domain id**, not its chain id. Reference (verify
   against Circle's supported-domains page at deploy time):
   Ethereum = 0, OP Mainnet = 2, Arbitrum One = 3, Base = 6, Unichain = 10, World Chain = 14.
3. **Author** `CctpBridgePermission.sol` from `contracts/mandates/CctpBridgePermission.sol`, with the
   messenger, USDC, allowed domains, and per-tx cap as constructor arguments.
4. **Compile** (`forge build`), then **deploy, simulate, register** as three separate steps:
   `sailor mandate deploy --contract CctpBridgePermission`, then `sailor mandate simulate`, then
   `sailor mandate register`.
5. **Simulate must-fail probes** for every bound: an off-allowlist domain, a wrong `mintRecipient`,
   an over-cap amount, a non-USDC `burnToken`, a wrong target. One must-pass with everything
   in-bounds (see `sailor-mandates` → simulate-calls).
6. **Register the bounded approve** alongside it (the `approve` step), or use owner-set standing
   approval on the Safe.

## Pitfalls

- Verify the selector with `cast sig "depositForBurn(uint256,uint32,bytes32,address)"` (0x6fd3504e),
  never from memory.
- CCTP domain ids are not chain ids. Ethereum is domain 0, not chain 1.
- `mintRecipient` is bytes32, not address. Compare against `bytes32(uint256(uint160(ctx.account)))`.
- `depositForBurnWithCaller` is intentionally NOT allowed; keep the surface to one selector.
- The per-period cap is agent-enforced, not on-chain. State that in the header, and size the
  per-tx cap so the agent cannot move more in one call than the user is prepared to lose at once.

## Handoff

→ `sailor-agent-build`: the runtime bridges when a token's liquidity forces a move to another named
chain. Then `sailor-automation` / `sailor-operate` to run and monitor.
