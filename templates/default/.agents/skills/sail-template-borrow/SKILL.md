---
name: sail-template-borrow
description: Gate an SMA's lending borrows by REUSING the shared BorrowPermission singleton (Protocol/contracts/templates/BorrowPermission.sol) — register + configure, no per-SMA deploy. Use for a bounded borrow mandate against Aave / Morpho / Compound with a protocol + asset allowlist, per-tx cap, and an on-chain LTV check via collateral + borrow oracles. NOTE: `sailor mandate attach` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires BorrowPermission deployed on the target chain (recorded in sail-templates/deployed.json); run sail-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/BorrowPermission.sol
---

# sail-template-borrow — bounded lending borrow via the shared singleton

Reuse the shared **`BorrowPermission`** singleton. Family overview + flow:
[`sail-templates`](../sail-templates/SKILL.md).

## What it enforces (per account, from source)

Selectors (any other ⇒ `false`): Aave `borrow(address,uint256,uint256,uint16,address)`,
Morpho-style `borrow(...)`, Compound-style `borrow(...)`. Invariants: `target ∈ protocols`;
`asset ∈ assets` (Aave/Morpho decode the asset; Compound uses `target`);
`amount ≤ maxAmountPerTx`; `onBehalfOf`/`receiver == SMA`; **`_ltvCheck` passes** — the
projected debt value (via `borrowOracle`) against collateral value (via `collateralOracle`)
must stay within `maxLtvBps`.

> Unlike the older bounded-borrow doc, this version **does** enforce an LTV bound on-chain.
> The check still depends on the oracles you configure — see staleness via `maxPriceAgeSec`.

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(address[] protocols, address[] assets, uint256 maxAmountPerTx,
           uint256 maxLtvBps, address collateralOracle, address borrowOracle,
           uint256 maxPriceAgeSec)
```
| Field | Notes |
|---|---|
| `protocols` | lending pools the agent may borrow from |
| `assets` | borrowable ERC-20 allowlist |
| `maxAmountPerTx` | per-borrow cap, base units |
| `maxLtvBps` | max loan-to-value, bps (e.g. `5000` = 50%) |
| `collateralOracle` / `borrowOracle` | price sources for the LTV check |
| `maxPriceAgeSec` | oracle freshness bound; `> 0` when oracles are set |

> `maxLtvBps` is a **per-transaction** projection, not a tracked lifetime LTV. For
> portfolio-level exposure, rely on the protocol's health factor or pair with a
> position-monitoring permission.

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sail-templates` reuse-flow](../sail-templates/references/reuse-flow.md) — follow it.
`sailor mandate attach` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `BorrowPermission` — `node SKILLS/sail-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** protocols, assets, cap, max LTV, oracles.
- **Blob:** `abi.encode(protocols[], assets[], maxAmountPerTx, maxLtvBps, collateralOracle,
  borrowOracle, maxPriceAgeSec)` — **flat params, no wrapper**.
- **Simulate (mandatory — unaudited example):** allowed borrow within LTV passes; over-cap,
  over-LTV, or wrong recipient is rejected.
