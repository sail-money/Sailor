---
name: sail-template-borrow
description: Gate an SMA's lending borrows by REUSING the shared BorrowPermission singleton (Protocol/contracts/templates/BorrowPermission.sol) — register + configure, no per-SMA deploy. Use for a bounded borrow mandate against Aave / Morpho / Compound with a protocol + asset allowlist, per-tx cap, and an on-chain LTV check via collateral + borrow oracles. NOTE: `sailor mandate register` only registers — you must also configure per-account (see steps).
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

Selectors (any other ⇒ `false`): Aave `borrow(address,uint256,uint256,uint16,address)`
(**variable-rate only** — a stable-rate borrow, `rateMode != 2`, is rejected), Morpho
**Optimizer/Morpho-Aave** `borrow(address,uint256,address,address)` (**NOT Morpho Blue** — its
ABI differs and simply won't match this selector, i.e. fails closed; target a Blue-specific
permission instead), Compound `borrow(uint256)` (the call target is the **cToken**; the template
resolves `cToken.underlying()` and keys the allowlist/cap/LTV on the underlying — a target with
no `underlying()`, e.g. cETH, is denied). Invariants: `target ∈ protocols`; `asset ∈ assets`
(Aave/Morpho decode the asset; Compound resolves it via `underlying()`); `amount ≤
maxAmountPerTx`; `onBehalfOf`/`receiver == SMA`; **`_ltvCheck` passes** — the projected debt
value (via `borrowOracle`) against collateral value (via `collateralOracle`) must stay within
`maxLtvBps`, when oracles are configured (see ORACLE MODES below).

> **Oracle modes:** configure **zero** oracles for amount-cap-only borrowing (no LTV ceiling is
> applied at all, despite `maxLtvBps` being stored) or **both** — exactly one oracle reverts
> `OracleConfigInconsistent` at configure (a single feed can't price a ratio). When both are set,
> the check still depends on their honesty/freshness — see staleness via `maxPriceAgeSec`.

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
`sailor mandate register` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `BorrowPermission` — `node .agents/skills/sail-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** protocols, assets, cap, max LTV, oracles.
- **Blob:** `abi.encode(protocols[], assets[], maxAmountPerTx, maxLtvBps, collateralOracle,
  borrowOracle, maxPriceAgeSec)` — **flat params, no wrapper**.
- **Simulate (mandatory — unaudited example):** allowed borrow within LTV passes; over-cap,
  over-LTV, or wrong recipient is rejected.
