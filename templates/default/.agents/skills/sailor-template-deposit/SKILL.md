---
name: sailor-template-deposit
description: Gate an SMA's deposits into vaults / lending pools by REUSING the shared DepositPermission singleton (Protocol/contracts/templates/DepositPermission.sol) — register + configure, no per-SMA deploy. Use for a bounded deposit mandate into ERC-4626 vaults (deposit/mint) or Aave v2/v3 (deposit/supply) with a target + token allowlist and a per-tx cap; the resulting position always accrues to the SMA. NOTE: `sailor mandate register` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires DepositPermission deployed on the target chain (recorded in sailor-templates/deployed.json); run sailor-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/DepositPermission.sol
---

# sailor-template-deposit — bounded vault/lending deposit via the shared singleton

Reuse the shared **`DepositPermission`** singleton. Family overview + flow:
[`sailor-templates`](../sailor-templates/SKILL.md). The operator/agent chooses the target vault
(ERC-4626) or lending market (Aave v2/v3) — this template gates the deposit, not the choice
of venue.

## What it enforces (per account, from source)

Selectors (any other ⇒ `false`):

| Function | Venue |
|---|---|
| `deposit(uint256 assets, address receiver)` | ERC-4626 / simple vault |
| `mint(uint256 shares, address receiver)` | ERC-4626 |
| `deposit(address asset, uint256 amount, address onBehalfOf, uint16)` | Aave v2 |
| `supply(address asset, uint256 amount, address onBehalfOf, uint16)` | Aave v3 |

Invariants: `value == 0`; `targets`/`tokens` must be non-empty with no zero addresses
(`EmptyAllowlist`/`ZeroAddress` revert at configure otherwise); `target ∈ targets`; token
allowlist enforced — Aave checks the `asset` arg, ERC-4626 requires the `target` (vault) itself
∈ `tokens`; `amount`/`shares ≤ maxAmountPerTx`; `receiver`/`onBehalfOf == SMA`.

> `mint`'s cap is in **shares**, not underlying. At a high share price the effective asset cap
> is `maxAmountPerTx × sharePrice` — size accordingly. For ERC-4626 `deposit`/`mint` the token
> allowlist is the last line of defence (no asset in calldata) — only allowlist vaults whose
> accepted token you trust.

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(address[] targets, address[] tokens, uint256 maxAmountPerTx)
```
| Field | Notes |
|---|---|
| `targets` | vault / lending-pool addresses |
| `tokens` | ERC-20 allowlist (the asset for Aave; the vault itself for ERC-4626) |
| `maxAmountPerTx` | per-deposit cap (assets, or shares for `mint`), base units |

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sailor-templates` reuse-flow](../sailor-templates/references/reuse-flow.md) — follow it.
`sailor mandate register` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `DepositPermission` — `node .agents/skills/sailor-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** targets, tokens, cap (note the share-price caveat for `mint`).
- **Blob:** `abi.encode(targets[], tokens[], maxAmountPerTx)` — **flat params, no wrapper**.
- **Simulate (mandatory — unaudited example):** allowed deposit within cap passes; off-list
  target/token, over-cap, or `receiver != SMA` is rejected.
