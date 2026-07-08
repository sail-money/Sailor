---
name: sail-template-transfer
description: Gate an SMA's ERC-20 transfers by REUSING the shared TransferPermission singleton (Protocol/contracts/templates/TransferPermission.sol) — register + configure, no per-SMA deploy. Use to let an agent move approved tokens, within a per-tx cap, only to a recipient allowlist (partner protocols, CEX deposit addrs, co-manager wallets). For returning funds to a single fixed Safe, prefer sail-template-withdraw. NOTE: `sailor mandate register` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires TransferPermission deployed on the target chain (recorded in sail-templates/deployed.json); run sail-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/TransferPermission.sol
---

# sail-template-transfer — bounded transfer to an allowlist via the shared singleton

Reuse the shared **`TransferPermission`** singleton. Family overview + flow:
[`sail-templates`](../sail-templates/SKILL.md).

## What it enforces (per account, from source)

Selectors: `0xa9059cbb` `transfer`, `0x23b872dd` `transferFrom`. Invariants: `value == 0`;
`allowedRecipients`/`allowedTokens` must be non-empty with no zero addresses
(`EmptyAllowlist`/`ZeroAddress` revert at configure otherwise); `target (token) ∈
allowedTokens`; `to ∈ allowedRecipients`; `amount ≤ maxAmountPerTx`; **`transferFrom` requires
`from == SMA`** (cannot pull from third parties that approved the Safe). Max 50 entries per
allowlist.

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(address[] allowedRecipients, address[] allowedTokens, uint256 maxAmountPerTx)
```
| Field | Notes |
|---|---|
| `allowedRecipients` | addresses the agent may send to (≤ 50) |
| `allowedTokens` | ERC-20 tokens the agent may move (≤ 50) |
| `maxAmountPerTx` | per-transfer cap, base units |

> Recipient/token allowlists are mutable via `reconfigure` (permissionSigner). In production
> use a multisig/timelock as the signer — it can widen the allowlist. Vet recipient contracts.

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sail-templates` reuse-flow](../sail-templates/references/reuse-flow.md) — follow it.
`sailor mandate register` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `TransferPermission` — `node .agents/skills/sail-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** recipients, tokens, cap.
- **Blob:** `abi.encode(allowedRecipients[], allowedTokens[], maxAmountPerTx)` — **flat params, no
  wrapper**.
- **Simulate (mandatory — unaudited example):** allowed recipient/token within cap passes; off-list
  recipient, wrong token, over-cap, or `transferFrom` with `from != SMA` is rejected.
