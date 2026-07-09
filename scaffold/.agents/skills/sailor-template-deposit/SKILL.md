---
name: sailor-template-deposit
description: Gate an SMA's deposits into vaults / lending pools by REUSING the shared DepositPermission singleton (Protocol/contracts/templates/DepositPermission.sol) — register + configure, no per-SMA deploy. Use for a yield / earn / APY / farm strategy that supplies tokens into ERC-4626 vaults (deposit/mint) or Aave v2/v3 (deposit/supply), with a target + token allowlist and a per-tx cap; the resulting position always accrues to the SMA. NOTE: `sailor mandate register` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires DepositPermission deployed on the target chain (recorded in sailor-templates/deployed.json); run sailor-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/DepositPermission.sol
---

# sailor-template-deposit — bounded vault/lending deposit via the shared singleton

You typically arrive here from the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) with a complete strategy spec — this spoke covers the bounded-deposit permission of that plan.

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

## ⚠️ Approve coverage — the hidden precondition

`DepositPermission` authorizes the `deposit`/`mint`/`supply` **call** only. Every one of those
selectors pulls the asset via an ERC-20 allowance, and the `approve(target, amount)` that
establishes it is a **separate transaction this permission does not cover** (same rule as every
protocol permission — see
[`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md)). A
deposit with no/insufficient allowance reverts inside the vault or lending pool and the tick
fails. **Every** bounded deposit needs the allowance handled — decide how at mandate-build time,
not when the first tick reverts. This applies identically when the deposit is the
collateral-supply leg of a borrow strategy ([`sailor-template-borrow`](../sailor-template-borrow/SKILL.md)) — supplying collateral is a deposit, so it needs the same approve coverage.

- **Autonomous agent (yield/looping strategy) — default:** do NOT use `DepositPermission` alone;
  register the shared **`ApproveAndCallBatchPermission`** singleton and dispatch each deposit as
  one atomic `[approve(target, amount), deposit/supply, approve(target, 0)]` batch — no
  lingering allowance, no per-tick owner signature. See
  [`sailor-template-approve-batch`](../sailor-template-approve-batch/SKILL.md).
- **Owner in the loop per deposit:** keep `DepositPermission`; the owner pre-approves the
  vault/lending pool. The agent must read `allowance(SMA, target)` and **stall (never
  self-approve)** when it is below the deposit amount — `approve()` is an owner-side action the
  agent cannot take on its own.

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(address[] targets, address[] tokens, uint256 maxAmountPerTx)
```
| Field | Notes |
|---|---|
| `targets` | vault / lending-pool addresses |
| `tokens` | ERC-20 allowlist (the asset for Aave; the vault itself for ERC-4626) |
| `maxAmountPerTx` | per-deposit cap (assets, or shares for `mint`), base units |

### Worked example — single-market USDC supply into Aave v3 (Unichain)

Supply USDC into one lending market, capped per deposit; the position accrues to the SMA
(`onBehalfOf == SMA` is enforced on-chain). USDC is the verified Unichain continuity address; the
**lending-pool address varies per chain/market — verify it on-chain (the contract exists and
exposes the expected `supply(...)` interface) before configuring.** The target placeholder below
is not a real address.

```json
{
  "targets": ["0xLENDING_POOL_verify_onchain"],
  "tokens":  ["0x078D782b760474a361dDA0AF3839290b0EF57AD6"],
  "maxAmountPerTx": "1000000000"
}
```

`maxAmountPerTx: "1000000000"` = 1,000 USDC (6 decimals). This example uses Aave v3 `supply`, so
the cap is in the **asset's** base units. For an ERC-4626 `mint` the cap would instead be in
**shares** (effective asset cap = `maxAmountPerTx × sharePrice`) — size accordingly, and remember
that for ERC-4626 the `tokens` allowlist must list the **vault** address (the deposit calldata
carries no asset). Then register → configure → simulate:

```bash
sailor mandate register --address <DEPOSIT_PERMISSION> --sma <SMA> --label "usdc-supply"

# DepositPermission has no CLI --template encoder (only SwapPermission does today) — build the
# blob yourself and pass --params. --address is a known shared-template singleton, so the signing
# card's "what you're signing" explanation still renders automatically without --template/--label.
BLOB=$(cast abi-encode "f(address[],address[],uint256)" \
  "[0xLENDING_POOL_verify_onchain]" \
  "[0x078D782b760474a361dDA0AF3839290b0EF57AD6]" \
  1000000000)
sailor mandate configure --address <DEPOSIT_PERMISSION> --sma <SMA> --params "$BLOB"

sailor mandate simulate --address <DEPOSIT_PERMISSION> --sma <SMA> --calls ./probe.json
```

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sailor-templates` reuse-flow](../sailor-templates/references/reuse-flow.md) — follow it.
`sailor mandate register` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `DepositPermission` — `node .agents/skills/sailor-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** targets, tokens, cap (note the share-price caveat for `mint`).
- **Blob:** `abi.encode(targets[], tokens[], maxAmountPerTx)` — **flat params, no wrapper**. No
  CLI `--template` encoder for this template — build via `cast abi-encode` / `encodeAbiParameters`
  and pass `--params` (see worked example above).
- **Simulate (mandatory — unaudited example):** allowed deposit within cap passes; off-list
  target/token, over-cap, or `receiver != SMA` is rejected.

## Next

Once this permission is configured and simulate passes (must-pass AND must-fail cases), return to the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) for the next permission. When every permission in the plan is registered, configured, and simulate-verified, proceed to Station 4 — the sailor-agent-build skill (dispatch mechanics: [`sailor-transactions`](../sailor-transactions/SKILL.md)).
