# The possibility map — what a DeFi agent can be bounded to do

**Discipline (read first):** this file maps what is EXPRESSIBLE and how it is BOUNDED — never
what is advisable. The choice of strategy is the user's alone; every row below is a capability
statement, not a suggestion. Possibility, never opportunity.

Consult this when the user's intent is exotic, unclear, or matches no category reference
(trading / yield / payments). A plain DCA, deposit, or payment flow never needs it.

Because permissions are arbitrary Solidity, the protocol is venue-agnostic: AMM swaps, lending,
LP positions, perpetuals, restaking, prediction markets, RWA flows — any on-chain primitive can
be bounded (whitepaper §9). A goal with no template row below is still fully in reach: bespoke
authoring is the protocol working as designed, not a fallback. Templates are shortcuts — the
token-cheap route through bounds Sailor has already mapped — never barriers.

## Goal → bound shape → route

| The agent should… | Enforceable bound shape | Route | Safety note (mechanics, never merits) |
|---|---|---|---|
| **Accumulate an asset over time** (recurring buys) | Router + token allowlists, per-tx cap, output pinned to the SMA, min-out floor | [`sailor-template-swap-no-oracle`](../../sailor-template-swap-no-oracle/SKILL.md) or [`sailor-template-swap`](../../sailor-template-swap/SKILL.md) — same size-driven default/trigger as [trading.md](trading.md)'s price-source decision, which owns the choice; approve coverage per `sailor-mandates/references/approvals.md`; cadence is agent-side | A price floor is only as strong as its price source; a thin pool's spot price can be moved within one transaction |
| **Earn on idle capital** (lending / vault deposits) | Vault/market + token allowlists, per-tx cap, position credited to the SMA | [`sailor-template-deposit`](../../sailor-template-deposit/SKILL.md) (ERC-4626 `deposit`/`mint`, Aave v2/v3); exits via [`sailor-template-withdraw`](../../sailor-template-withdraw/SKILL.md); other market ABIs → bespoke | The bound constrains where and how much — an allowlisted venue's own honesty is a trust assumption the bound cannot vet |
| **Provide liquidity** (AMM LP positions) | Pool / position-manager allowlist, per-token caps, position owner pinned to the SMA | Bespoke (no LP template) — a bounded `mint`/`increase`/`decrease`/`collect` permission | LP value moves with the pool's price ratio; the bound controls deposits and withdrawals, not that exposure |
| **Take or manage leverage** (borrow against collateral) | Protocol + asset allowlists, per-borrow cap, LTV ceiling (requires both oracles), position to the SMA | [`sailor-template-borrow`](../../sailor-template-borrow/SKILL.md) (Aave variable-rate, Morpho Optimizer, Compound cTokens); other markets or cumulative-position bounds → bespoke | With zero oracles there is NO LTV ceiling — cap-only; an LTV ceiling trusts its oracles and checks at borrow time, not continuously |
| **Hedge, or act on a price condition** | The condition lives in agent logic (the kernel has no notion of price or time); the resulting ACTION carries the bounds — the swap/borrow shapes above | Templates for the action where they fit; perp venues → bespoke | The trigger itself is not enforced on-chain — if the agent stops, nothing fires; only the action's bounds are guaranteed |
| **Automate treasury / payment flows** | Recipient allowlist (or one pinned recipient), token allowlist, per-tx cap | [`sailor-template-transfer`](../../sailor-template-transfer/SKILL.md) (allowlisted set) / [`sailor-template-withdraw`](../../sailor-template-withdraw/SKILL.md) (single pinned recipient); native ETH or differing per-recipient caps → bespoke | A recipient allowlist is only as trustworthy as the key that configures it |
| **Rebalance a portfolio** | Same shape as accumulate — bands/weights are agent logic; every trade leg is a bounded swap | Swap templates per leg; approve coverage per `approvals.md` | Same price-source caveat as accumulate, once per leg |
| **Interact with one specific venue or vault** | Target + selector allowlist, decoded-parameter caps, recipient pinned to the SMA | A template if the venue speaks a template's selector set (check the spoke's selector table); otherwise bespoke | Verify every selector against the venue's deployed ABI — a wrong selector gates nothing, or everything |
| **Trade perpetuals, use prediction markets, restake, hold RWA positions** | Venue-specific: allowlisted markets, bounded sizes/collateral, positions pinned to the SMA | Bespoke — the venue-agnostic case the protocol is designed for | Each venue's liquidation, settlement, and custody mechanics are its own; the permission bounds the calls, not the venue |

Sequence constraints (approve → act → reset, or any whole-batch invariant) are what batch
permissions exist for: [`sailor-template-approve-batch`](../../sailor-template-approve-batch/SKILL.md)
for the approve bracket, a bespoke `IBatchPermission` for anything else.

## The off-chain boundary (stated once, honestly)

Venues whose state is partly off-chain — order books that match off-chain, settlement engines
that sign off-chain — can have their ON-CHAIN boundary bounded (deposits, withdrawals, allowed
sub-accounts) but not their off-chain order signing. That is a property of those venues, not of
the protocol (whitepaper §4.3, §8.2). Before such a strategy is confirmed, say which surfaces
are enforced on-chain and which inherit the venue's own trust assumptions.

## Reading a row into a spec

A row's bound shape is Station 3's input, not Station 2's interrogation script: elicit the
intent's completeness dimensions as usual, then record each action's route (template vs bespoke)
in the spec. The Act-3 disclosures (template count N, bespoke count M) come straight from those
routes.
