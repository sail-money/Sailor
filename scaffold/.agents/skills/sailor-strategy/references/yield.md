# Yield — archetypes, extension dimensions, routing

A routing aid consulted when the intent fits this category — not the boundary of what can be built. Conforms to the category contract in [../SKILL.md](../SKILL.md), including its structural-only-defaults rule.

## Archetypes

### Single-market deposit — supply TOKEN to one allowlisted vault or lending market
Defaults: cadence = deposit on a balance threshold or weekly (whichever the user prefers); per-tx cap = the deposit tranche size; exit = withdraw back to the owner. The user supplies: the token, the market/vault, the tranche size.

### Vault rotation — move between an allowlisted set of vaults on a cadence
Defaults: cadence = weekly; the vault SET is fixed at mandate time (the allowlist) — which vault the agent picks within the set is agent logic, not a mandate change; per-tx cap = the rotation tranche size. The user supplies: the vault set (exact addresses), the token, the tranche size.

### Borrow position — supply collateral, borrow within an LTV ceiling (higher-risk — flag it)
Defaults: LTV ceiling = a conservative 50% of the market's own max LTV (the user may raise it deliberately); cadence = event-driven health check each tick. The user supplies: collateral token, borrow token, the market, the amounts.

## Extension dimensions (append to the core gate)

| Dimension | Concrete means |
|---|---|
| Market/vault addresses | Exact contract addresses per chain, resolved and verified — never from memory |
| Cap semantics | ERC-4626 `mint` caps are in **shares**, not underlying: effective asset cap = cap × share price — size accordingly (see `sailor-template-deposit`) |
| LTV ceiling + oracles | `maxLtvBps` AND both a collateral oracle and a borrow oracle. The pair is all-or-nothing: with zero oracles the template enforces amount-cap-only and **no LTV ceiling at all**; exactly one oracle reverts at configure |
| Exit path (accumulate-direction actions only) | Who unwinds the position, and how. **Agent-managed:** a **vault/lending deposit** unwinds by calling the vault's own `withdraw`/`redeem` (or Aave's own `withdraw`) — bespoke, see routing below, no shared template covers that call; a **borrow position** unwinds by `repay` first (pulls the debt asset from the SMA via allowance — approve coverage required, and there is no shared template for it either), then withdraw of the freed collateral — two legs, not one. **Owner-managed:** exit manually — the sovereign Safe exit always works, see `sailor-operate`. Either is a complete answer; asked once per action, never silently absent |

**Feasibility (verify, don't advise).** The named market or vault must exist on the target chain — verify the address on-chain (the contract exists and exposes the expected interface, e.g. a lending market's `supply` / a vault's `deposit`) before it enters the spec. If the user hasn't chosen a market, the harness does **not** pick one for them (that would be investment advice): point them to research it outside, then return with an address to verify.

## Routing (Station 3 reads this)

| Action | Route |
|---|---|
| Deposits into ERC-4626 vaults (`deposit`/`mint`) or Aave v2/v3 (`deposit`/`supply`) | [`sailor-template-deposit`](../../sailor-template-deposit/SKILL.md) |
| Borrows — Aave variable-rate, Morpho Optimizer/Morpho-Aave, Compound cTokens | [`sailor-template-borrow`](../../sailor-template-borrow/SKILL.md) — covers the borrow call only; the collateral-supply leg is a deposit action (row above) with its own approve coverage |
| Repay / unwind a borrow position | **Bespoke via [`sailor-mandates`](../../sailor-mandates/SKILL.md)** — no shared `RepayPermission` template exists today. `repay` pulls the debt asset from the SMA via allowance, so it needs approve coverage exactly like deposit/swap (see [`sailor-mandates/references/approvals.md`](../../sailor-mandates/references/approvals.md)); do not treat a borrow strategy as complete once `BorrowPermission` alone simulates clean if the strategy has an exit condition |
| Exit/unwind a vault or lending deposit (the vault's own `withdraw`/`redeem`, or Aave's own `withdraw`) | **Bespoke via [`sailor-mandates`](../../sailor-mandates/SKILL.md)** — `DepositPermission` gates entry selectors only (`deposit`/`mint`/Aave `deposit`/`supply`); it has no `withdraw`/`redeem` selector, and no shared template calls one. `sailor-template-withdraw` (row below) does NOT substitute for this — it only sweeps tokens the SMA already holds, it never calls a vault's own exit function. One config-only alternative exists: sweep the vault's own share token (a plain ERC-20) directly to the owner via `sailor-template-withdraw` and let the owner redeem it themselves later — legitimate when the owner is fine holding shares post-sweep, but the swept cap is then share-denominated (see the row below) |
| Withdrawals back to the owner, OR sweeping a held vault-share token to the owner | [`sailor-template-withdraw`](../../sailor-template-withdraw/SKILL.md) — asset-denominated normally; **share-denominated if the configured token is a vault's own share token** (see the row above) — headroom must then cover both continued accumulation (more shares bought) AND a lower future share price (more shares needed for the same value), not just position growth |
| Approve → deposit → reset in one atomic batch | [`sailor-template-approve-batch`](../../sailor-template-approve-batch/SKILL.md) |
| Staking wrapped as an ERC-4626 vault (stake via `deposit`/`mint`) | [`sailor-template-deposit`](../../sailor-template-deposit/SKILL.md) — same as any vault; native/LST staking with no vault interface is bespoke via [`sailor-mandates`](../../sailor-mandates/SKILL.md) |
| Markets outside those selectors (Morpho Blue, exotic vaults, staking contracts) | bespoke via [`sailor-mandates`](../../sailor-mandates/SKILL.md) |

Capability limits (from the templates' own schemas): `BorrowPermission` covers Aave **variable-rate only** (stable-rate debt is rejected), Morpho **Optimizer/Morpho-Aave** (Morpho Blue's ABI won't match — fails closed), and Compound cTokens with an `underlying()` (cETH is denied). Deposit and borrow positions always accrue to the SMA (`receiver`/`onBehalfOf == account` is enforced on-chain).
