---
name: sailor-template-withdraw
description: "Gate an SMA's exits from vaults / lending pools by REUSING the shared WithdrawPermission singleton (Protocol/contracts/templates/WithdrawPermission.sol) — register + configure, no per-SMA deploy. Use to exit, unwind, redeem, or cash out a position that supplies ERC-4626 vaults (withdraw/redeem) or Aave v2/v3 (withdraw), with a target allowlist and a per-tx cap; proceeds always land in the SMA itself. To move ERC-20 tokens the SMA already holds OUT to a fixed recipient, use sailor-template-transfer instead. NOTE: `sailor mandate register` only registers — you must also configure per-account (see steps)."
compatibility: A Sailor project (`@sail.money/sailor/sdk`, `sailor` CLI). Requires WithdrawPermission deployed on the target chain (recorded in sailor-templates/deployed.json); run sailor-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/WithdrawPermission.sol
---

# sailor-template-withdraw — bounded vault / lending-pool exit via the shared singleton

You typically arrive here from the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) with a complete strategy spec — this spoke covers the bounded-exit permission of that plan.

Reuse the shared **`WithdrawPermission`** singleton. Family overview + flow:
[`sailor-templates`](../sailor-templates/SKILL.md). This is the counterpart to
[`sailor-template-deposit`](../sailor-template-deposit/SKILL.md): deposit supplies a venue,
withdraw exits it. The operator/agent chooses the vault (ERC-4626) or lending market (Aave
v2/v3) — this template gates the exit, not the choice of venue.

> **Routing.** This template gates *protocol exits*. It does **not** gate plain ERC-20
> transfers. To move tokens the SMA already holds out to a fixed destination, use
> [`sailor-template-transfer`](../sailor-template-transfer/SKILL.md) with a one-entry recipient
> allowlist. An exit and a payout are two permissions, not one.

## What it enforces (per account, from source)

Selectors (any other ⇒ `false`):

| Function | Venue | Cap applies to |
|---|---|---|
| `withdraw(uint256 assets, address receiver, address owner)` | ERC-4626 | `assets` |
| `redeem(uint256 shares, address receiver, address owner)` | ERC-4626 | **`shares`** |
| `withdraw(address asset, uint256 amount, address to)` | Aave v2 LendingPool / v3 Pool | `amount` (assets) |

Invariants: `value == 0` (a call carrying native value is rejected); `targets`/`tokens` must be
non-empty with no zero addresses (`EmptyAllowlist`/`ZeroAddress` revert at configure otherwise);
`target ∈ targets`; `amount`/`shares ≤ maxAmountPerTx`; and every address argument naming a
recipient or position owner equals the account — on the ERC-4626 paths **both `receiver` AND
`owner`**, on the Aave path `to`. On the Aave path the withdrawn `asset` must additionally be in
`tokens`. Max 50 entries per allowlist. An unconfigured account denies every call.

> **`receiver` and `owner` are both pinned, and both matter.** `receiver` keeps the proceeds in
> the account; `owner` stops the manager burning a third party's shares through a share allowance
> granted to the account. Redeemed funds can only ever be paid to the account itself, and shares
> can only ever be burned from the account's own position.

> **The token allowlist binds the Aave path only.** Aave carries the `asset` in calldata, so it
> can be checked. The ERC-4626 paths name no asset — a vault there is constrained by the
> **target** allowlist alone, and its underlying asset is never inspected. Allowlist only vaults
> you trust; `tokens` will not save you there. Note that `tokens` must still be non-empty even in
> a vault-only config, where it has no effect.

> **`redeem`'s cap is in shares, not underlying.** At a high share price the effective asset cap
> is `maxAmountPerTx × sharePrice`. These templates are intentionally oracle-free, so sizing a
> redeem cap is the operator's job. `withdraw` and the Aave path cap the asset amount directly.

Unlike [`sailor-template-deposit`](../sailor-template-deposit/SKILL.md), these exits need no
ERC-20 approve: the account burns its own shares or aTokens, so there is no allowance
precondition to arrange.

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(address[] targets, address[] tokens, uint256 maxAmountPerTx)
```
| Field | Notes |
|---|---|
| `targets` | vault / lending-pool addresses the agent may exit |
| `tokens` | asset allowlist — consulted on the Aave path only; must be non-empty regardless |
| `maxAmountPerTx` | per-exit cap (assets, or shares for `redeem`), base units |

### Worked example — unwind a USDC position on Unichain

Let the agent exit one ERC-4626 vault and one Aave market, capped per exit; proceeds land in the
SMA (`receiver`/`owner`/`to == SMA` is enforced on-chain). USDC is the verified Unichain
continuity address; the **vault and lending-pool addresses vary per chain/market — verify each
on-chain (the contract exists and exposes the expected interface) before configuring.** The
target placeholders below are not real addresses.

```json
{
  "targets": [
    "0xVAULT_4626_verify_onchain",
    "0xLENDING_POOL_verify_onchain"
  ],
  "tokens": ["0x078D782b760474a361dDA0AF3839290b0EF57AD6"],
  "maxAmountPerTx": "5000000000"
}
```

`maxAmountPerTx: "5000000000"` = 5,000 USDC (6 decimals) on the `withdraw` and Aave paths. On the
ERC-4626 `redeem` path the same number is **5,000,000,000 shares** — a different quantity
entirely. The cap is one number applied to every target in `targets`, so a config spanning venues
of different decimals or share prices is coarse; use one config per venue if the caps must
differ. Then register → configure → simulate:

```bash
sailor mandate register --address <WITHDRAW_PERMISSION> --sma <SMA> --label "usdc-unwind"

# WithdrawPermission has no CLI --template encoder (only SwapPermission does today) — build the
# blob yourself and pass --params. --address is a known shared-template singleton, so the signing
# card's "what you're signing" explanation still renders automatically without --template/--label.
BLOB=$(cast abi-encode "f(address[],address[],uint256)" \
  "[0xVAULT_4626_verify_onchain,0xLENDING_POOL_verify_onchain]" \
  "[0x078D782b760474a361dDA0AF3839290b0EF57AD6]" \
  5000000000)
sailor mandate configure --address <WITHDRAW_PERMISSION> --sma <SMA> --params "$BLOB"

# ONE mandatory safety gate — generate the lean probes from the same $BLOB, then run simulate once.
# The probes exercise all three gated selectors against the permission; they are not live calls,
# so a target that implements only one of the two interfaces still probes correctly.
# See sailor-templates/references/reuse-flow.md step 5.
node scripts/probe-mandate.mjs --template WithdrawPermission --params "$BLOB" --sma <SMA> --address <WITHDRAW_PERMISSION>
```

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sailor-templates` reuse-flow](../sailor-templates/references/reuse-flow.md) — follow it.
`sailor mandate register` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `WithdrawPermission` — `node .agents/skills/sailor-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** targets, tokens, cap (note the shares caveat for `redeem`).
- **Blob:** `abi.encode(targets[], tokens[], maxAmountPerTx)` — **flat params, no wrapper**. No
  CLI `--template` encoder for this template — build via `cast abi-encode` / `encodeAbiParameters`
  and pass `--params` (see worked example above).
- **Simulate (mandatory — unaudited example):** an allowed exit within cap passes on each of the
  three selectors; off-list target, off-list asset on the Aave path, over-cap, `receiver` or
  `owner` other than the SMA, non-zero native value, and any unrecognized selector are rejected.

## What this cannot protect against

- **The venue itself.** An allowlisted vault or pool is not vetted. The template constrains where
  proceeds go and how much exits per call — not the venue's honesty or solvency. A vault that
  cannot honour a redemption is outside its reach.
- **The 4626 paths are not asset-constrained.** The token allowlist is consulted only on the Aave
  path. On the ERC-4626 paths the target allowlist is the sole constraint.
- **Cumulative outflow.** The cap is per-transaction, not cumulative. A manager may make many
  at-cap exits.
- **Reconfiguration.** The permission signer can reconfigure `targets`, `tokens`, and
  `maxAmountPerTx` at any time with a fresh nonce. These bounds are only as trustworthy as that
  key.
- **Share-price drift on `redeem`.** A shares-denominated cap floats in underlying value. It is
  not a bound on the assets received.
- **Venues whose exits pay `msg.sender`.** Compound v2/v3 and Aave v4 carry no calldata
  recipient, so the pinned-destination invariant cannot be checked from calldata. Those selectors
  are intentionally unrecognized and deny; they need a dedicated permission.

## Next

Simulate passing → back to the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) for the next permission.
