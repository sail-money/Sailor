---
name: sailor-template-withdraw
description: Gate an SMA's ERC-20 withdrawals by REUSING the shared WithdrawPermission singleton (Protocol/contracts/templates/WithdrawPermission.sol) — register + configure, no per-SMA deploy. Use to sweep, exit, cash out, or consolidate to my wallet — the agent may move approved tokens, within a per-tx cap, only to ONE fixed recipient (typically the owner's Safe) for safe-to-safe consolidation. For a mutable multi-recipient allowlist, use sailor-template-transfer instead. NOTE: `sailor mandate register` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires WithdrawPermission deployed on the target chain (recorded in sailor-templates/deployed.json); run sailor-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/WithdrawPermission.sol
---

# sailor-template-withdraw — bounded withdraw to a fixed recipient via the shared singleton

You typically arrive here from the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) with a complete strategy spec — this spoke covers the bounded-withdraw permission of that plan (often the strategy's exit/consolidation path).

Reuse the shared **`WithdrawPermission`** singleton. Family overview + flow:
[`sailor-templates`](../sailor-templates/SKILL.md).

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

### Worked example — treasury sweep back to the owner (Unichain)

Let the agent sweep USDC and WETH from the SMA back to the owner's wallet, capped per withdraw.
The tokens are the verified Unichain continuity addresses; **`allowedRecipient` is the owner's own
address — supplied by the user, confirm it is checksummed and correct on the target chain before
configuring** (a wrong recipient here is where funds would go). The recipient placeholder below is
not a real address.

```json
{
  "tokens": [
    "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    "0x4200000000000000000000000000000000000006"
  ],
  "allowedRecipient": "0xOWNER_WALLET_confirm_with_user",
  "maxAmountPerTx":   "5000000000"
}
```

`maxAmountPerTx: "5000000000"` = 5,000 USDC (6 decimals) — note the cap is a single number in the
token's base units and applies to **every** token in `tokens`, so a shared cap across tokens of
different decimals is coarse; use one config per token if the caps must differ. Then register →
configure → simulate:

```bash
sailor mandate register --address <WITHDRAW_PERMISSION> --sma <SMA> --label "treasury-sweep"

# WithdrawPermission has no CLI --template encoder (only SwapPermission does today) — build the
# blob yourself and pass --params. --address is a known shared-template singleton, so the signing
# card's "what you're signing" explanation still renders automatically without --template/--label.
BLOB=$(cast abi-encode "f(address[],address,uint256)" \
  "[0x078D782b760474a361dDA0AF3839290b0EF57AD6,0x4200000000000000000000000000000000000006]" \
  0xOWNER_WALLET_confirm_with_user \
  5000000000)
sailor mandate configure --address <WITHDRAW_PERMISSION> --sma <SMA> --params "$BLOB"

sailor mandate simulate --address <WITHDRAW_PERMISSION> --sma <SMA> --calls ./probe.json
```

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sailor-templates` reuse-flow](../sailor-templates/references/reuse-flow.md) — follow it.
`sailor mandate register` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `WithdrawPermission` — `node .agents/skills/sailor-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** tokens, the single recipient, cap.
- **Blob:** `abi.encode(tokens[], allowedRecipient, maxAmountPerTx)` — **flat params, no
  wrapper**. No CLI `--template` encoder for this template — build via `cast abi-encode` /
  `encodeAbiParameters` and pass `--params` (see worked example above).
- **Simulate (mandatory — unaudited example):** withdraw to the recipient within cap passes; any
  other `to`, wrong token, over-cap, or `transferFrom` with `from != SMA` is rejected.

## Next

Once this permission is configured and simulate passes (must-pass AND must-fail cases), return to the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) for the next permission. When every permission in the plan is registered, configured, and simulate-verified, proceed to Station 4 — the sailor-agent-build skill (dispatch mechanics: [`sailor-transactions`](../sailor-transactions/SKILL.md)).
