# Payments & treasury — archetypes, extension dimensions, routing

A routing aid consulted when the intent fits this category — not the boundary of what can be built. Conforms to the category contract in [../SKILL.md](../SKILL.md), including its structural-only-defaults rule.

## Archetypes

### Payroll — fixed recipient allowlist, fixed amounts, on a schedule
Defaults: schedule = monthly (or the user's pay cycle); per-tx cap = the largest single payment; recipient allowlist = the exact payee addresses. The user supplies: every recipient address, each amount, the token, the schedule.

### Treasury sweep — consolidate to the owner's address on a threshold or schedule
Defaults: trigger = balance above a threshold, or weekly; per-tx cap = the sweep tranche. Single fixed recipient (the owner's Safe) — routes to the transfer template with a one-entry recipient allowlist. The user supplies: the threshold/schedule, the tokens to sweep.

### Scheduled transfers — recurring moves to an allowlisted set
Defaults: schedule = the user's; per-tx cap = the largest scheduled move. The user supplies: recipients, amounts, token, schedule.

## Extension dimensions (append to the core gate)

| Dimension | Concrete means |
|---|---|
| Recipient allowlist | Exact addresses, verified with the user one by one — max 50 entries per config |
| Per-recipient vs total caps | `TransferPermission`'s per-tx cap is **uniform across the whole allowlist** (one cap per config, not per recipient). If recipients need materially different caps, either accept the largest as the shared cap — and say so plainly — or route to bespoke |
| Schedule | The schedule is an agent-side cadence guard (permissions are stateless); wire and confirm it before go-live |
| Native-ETH exclusion | `TransferPermission` covers ERC-20 `transfer`/`transferFrom` only, and every shared template rejects calls carrying native value (`value == 0`). Native-ETH payments need wrapped ETH or a bespoke permission |

**Feasibility (verify, don't advise).** Recipients are user-supplied addresses — confirm each is checksummed and valid for the intended chain before it enters the spec. The token being paid must exist on that chain — resolve it via [`sailor-token-resolve`](../../sailor-token-resolve/SKILL.md). A recipient or token that isn't valid on the target chain is caught here, not after signing.

## Routing (Station 3 reads this)

| Action | Route |
|---|---|
| Transfers to a multi-recipient allowlist | [`sailor-template-transfer`](../../sailor-template-transfer/SKILL.md) |
| Consolidation to ONE fixed recipient (owner's Safe) | [`sailor-template-transfer`](../../sailor-template-transfer/SKILL.md) with a one-entry recipient allowlist |
| Exiting a vault or lending position first, so there is something to sweep | [`sailor-template-withdraw`](../../sailor-template-withdraw/SKILL.md) — pays the SMA only; pair it with a transfer to reach the owner |
| Native-ETH payments, or per-recipient caps that must differ | bespoke via [`sailor-mandates`](../../sailor-mandates/SKILL.md) |
