---
name: sailor-template-transfer
description: Gate an SMA's ERC-20 transfers by REUSING the shared TransferPermission singleton (Protocol/contracts/templates/TransferPermission.sol) — register + configure, no per-SMA deploy. Use for payment, payroll, paying contributors, treasury moves, or any strategy that sends approved tokens — within a per-tx cap, only to a recipient allowlist (a whitelist of partner protocols, CEX deposit addrs, co-manager wallets). For returning funds to a single fixed Safe, prefer sailor-template-withdraw. NOTE: `sailor mandate register` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires TransferPermission deployed on the target chain (recorded in sailor-templates/deployed.json); run sailor-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/TransferPermission.sol
---

# sailor-template-transfer — bounded transfer to an allowlist via the shared singleton

You typically arrive here from the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) with a complete strategy spec — this spoke covers the bounded-transfer permission of that plan.

Reuse the shared **`TransferPermission`** singleton. Family overview + flow:
[`sailor-templates`](../sailor-templates/SKILL.md).

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

### Worked example — weekly payroll to a contributor allowlist (Unichain)

Pay three contributors in USDC, capped at 1,000 USDC per transfer, on a weekly cadence (the
schedule is an agent-side guard — permissions are stateless). The token (USDC) is the verified
Unichain continuity address; **recipients are user-supplied — confirm each is checksummed and a
valid address on the target chain (via [`sailor-token-resolve`](../sailor-token-resolve/SKILL.md)
for the token, and with the user for the payees) before configuring.** The recipient placeholders
below are not real addresses.

```json
{
  "allowedRecipients": [
    "0xRECIPIENT_A_user_supplied",
    "0xRECIPIENT_B_user_supplied",
    "0xRECIPIENT_C_user_supplied"
  ],
  "allowedTokens":  ["0x078D782b760474a361dDA0AF3839290b0EF57AD6"],
  "maxAmountPerTx": "1000000000"
}
```

`maxAmountPerTx: "1000000000"` = 1,000 USDC (6 decimals) — the cap is **per transfer, uniform
across the whole allowlist** (one cap per config, not per recipient). Then register → configure →
simulate:

```bash
sailor mandate register --address <TRANSFER_PERMISSION> --sma <SMA> --label "payroll"

# TransferPermission has no CLI --template encoder (only SwapPermission does today) — build the
# blob yourself and pass --params. --address is a known shared-template singleton, so the signing
# card's "what you're signing" explanation still renders automatically without --template/--label.
BLOB=$(cast abi-encode "f(address[],address[],uint256)" \
  "[0xRECIPIENT_A_user_supplied,0xRECIPIENT_B_user_supplied,0xRECIPIENT_C_user_supplied]" \
  "[0x078D782b760474a361dDA0AF3839290b0EF57AD6]" \
  1000000000)
sailor mandate configure --address <TRANSFER_PERMISSION> --sma <SMA> --params "$BLOB"

# ONE mandatory safety gate — generate the lean probes from the same $BLOB, then run simulate once.
# See sailor-templates/references/reuse-flow.md step 5.
node scripts/probe-mandate.mjs --template TransferPermission --params "$BLOB" --sma <SMA> --address <TRANSFER_PERMISSION>
```

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sailor-templates` reuse-flow](../sailor-templates/references/reuse-flow.md) — follow it.
`sailor mandate register` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `TransferPermission` — `node .agents/skills/sailor-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** recipients, tokens, cap.
- **Blob:** `abi.encode(allowedRecipients[], allowedTokens[], maxAmountPerTx)` — **flat params, no
  wrapper**. No CLI `--template` encoder for this template — build via `cast abi-encode` /
  `encodeAbiParameters` and pass `--params` (see worked example above).
- **Simulate (mandatory — unaudited example):** allowed recipient/token within cap passes; off-list
  recipient, wrong token, over-cap, or `transferFrom` with `from != SMA` is rejected.

## Next

Simulate passing → back to the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) for the next permission.
