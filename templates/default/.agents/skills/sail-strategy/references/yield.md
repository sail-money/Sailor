# Yield — archetypes, extension dimensions, routing

Conforms to the category contract in [../SKILL.md](../SKILL.md). Defaults below are structural only — never an invented address, never an asset recommendation.

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
| Cap semantics | ERC-4626 `mint` caps are in **shares**, not underlying: effective asset cap = cap × share price — size accordingly (see `sail-template-deposit`) |
| LTV ceiling + oracles | `maxLtvBps` AND both a collateral oracle and a borrow oracle. The pair is all-or-nothing: with zero oracles the template enforces amount-cap-only and **no LTV ceiling at all**; exactly one oracle reverts at configure |
| Unwind path | How the position exits (withdraw/redeem route) and where funds land |

## Routing (Station 3 reads this)

| Action | Route |
|---|---|
| Deposits into ERC-4626 vaults (`deposit`/`mint`) or Aave v2/v3 (`deposit`/`supply`) | [`sail-template-deposit`](../../sail-template-deposit/SKILL.md) |
| Borrows — Aave variable-rate, Morpho Optimizer/Morpho-Aave, Compound cTokens | [`sail-template-borrow`](../../sail-template-borrow/SKILL.md) |
| Withdrawals back to the owner | [`sail-template-withdraw`](../../sail-template-withdraw/SKILL.md) |
| Approve → deposit → reset in one atomic batch | [`sail-template-approve-batch`](../../sail-template-approve-batch/SKILL.md) |
| Markets outside those selectors (Morpho Blue, exotic vaults, staking contracts) | bespoke via [`sail-mandates`](../../sail-mandates/SKILL.md) |

Capability limits (from the templates' own schemas): `BorrowPermission` covers Aave **variable-rate only** (stable-rate debt is rejected), Morpho **Optimizer/Morpho-Aave** (Morpho Blue's ABI won't match — fails closed), and Compound cTokens with an `underlying()` (cETH is denied). Deposit and borrow positions always accrue to the SMA (`receiver`/`onBehalfOf == account` is enforced on-chain).
