# Payments & treasury — archetypes, extension dimensions, routing

Conforms to the category contract in [../SKILL.md](../SKILL.md). Defaults below are structural only — never an invented address.

## Archetypes

### Payroll — fixed recipient allowlist, fixed amounts, on a schedule
Defaults: schedule = monthly (or the user's pay cycle); per-tx cap = the largest single payment; recipient allowlist = the exact payee addresses. The user supplies: every recipient address, each amount, the token, the schedule.

### Treasury sweep — consolidate to the owner's address on a threshold or schedule
Defaults: trigger = balance above a threshold, or weekly; per-tx cap = the sweep tranche. Single fixed recipient (the owner's Safe) — routes to the withdraw template, not transfer. The user supplies: the threshold/schedule, the tokens to sweep.

### Scheduled transfers — recurring moves to an allowlisted set
Defaults: schedule = the user's; per-tx cap = the largest scheduled move. The user supplies: recipients, amounts, token, schedule.

## Extension dimensions (append to the core gate)

| Dimension | Concrete means |
|---|---|
| Recipient allowlist | Exact addresses, verified with the user one by one — max 50 entries per config |
| Per-recipient vs total caps | `TransferPermission`'s per-tx cap is **uniform across the whole allowlist** (one cap per config, not per recipient). If recipients need materially different caps, either accept the largest as the shared cap — and say so plainly — or route to bespoke |
| Schedule | The schedule is an agent-side cadence guard (permissions are stateless); wire and confirm it before go-live |
| Native-ETH exclusion | `TransferPermission` and `WithdrawPermission` cover ERC-20 `transfer`/`transferFrom` only (`value == 0` — native ETH is rejected). Native-ETH payments need wrapped ETH or a bespoke permission |

## Routing (Station 3 reads this)

| Action | Route |
|---|---|
| Transfers to a multi-recipient allowlist | [`sail-template-transfer`](../../sail-template-transfer/SKILL.md) |
| Consolidation to ONE fixed recipient (owner's Safe) | [`sail-template-withdraw`](../../sail-template-withdraw/SKILL.md) |
| Native-ETH payments, or per-recipient caps that must differ | bespoke via [`sail-mandates`](../../sail-mandates/SKILL.md) |
