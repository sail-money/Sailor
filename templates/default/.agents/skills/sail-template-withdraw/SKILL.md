---
name: sail-template-withdraw
description: Gate an SMA's ERC-20 withdrawals by REUSING the shared WithdrawPermission singleton (Protocol/contracts/templates/WithdrawPermission.sol) — register + configure, no per-SMA deploy. Use when the agent may move approved tokens, within a per-tx cap, only to ONE fixed recipient (typically the owner's Safe) for safe-to-safe consolidation. For a mutable multi-recipient allowlist, use sail-template-transfer instead. NOTE: `sailor mandate attach` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires WithdrawPermission deployed on the target chain (recorded in sail-templates/deployed.json); run sail-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/WithdrawPermission.sol
---

# sail-template-withdraw — bounded withdraw to a fixed recipient via the shared singleton

Reuse the shared **`WithdrawPermission`** singleton. Family overview + flow:
[`sail-templates`](../sail-templates/SKILL.md).

## What it enforces (per account, from source)

Selectors: `0xa9059cbb` `transfer`, `0x23b872dd` `transferFrom`. Invariants: `value == 0`;
`tokens` must be non-empty and `allowedRecipient` non-zero, with no zero-address tokens
(`EmptyAllowlist`/`ZeroAddress` revert at configure otherwise); `target (token) ∈ tokens`;
`to == allowedRecipient` (a single address from config); `amount ≤ maxAmountPerTx`;
**`transferFrom` requires `from == SMA`**.

> Single recipient per config. To change it, `reconfigure` with a new blob (no redeploy). This
> is the consolidation primitive — funds can only flow to the one approved address.

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(address[] tokens, address allowedRecipient, uint256 maxAmountPerTx)
```
| Field | Notes |
|---|---|
| `tokens` | ERC-20 tokens the agent may move |
| `allowedRecipient` | the single destination (e.g. owner's Safe) |
| `maxAmountPerTx` | per-withdraw cap, base units |

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sail-templates` reuse-flow](../sail-templates/references/reuse-flow.md) — follow it.
`sailor mandate attach` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `WithdrawPermission` — `node SKILLS/sail-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** tokens, the single recipient, cap.
- **Blob:** `abi.encode(tokens[], allowedRecipient, maxAmountPerTx)` — **flat params, no wrapper**.
- **Simulate (mandatory — unaudited example):** withdraw to the recipient within cap passes; any
  other `to`, wrong token, over-cap, or `transferFrom` with `from != SMA` is rejected.
