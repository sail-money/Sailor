---
name: sailor-template-approve-batch
description: Gate an SMA's "approve → call → reset" interactions by REUSING the shared ApproveAndCallBatchPermission singleton (Protocol/contracts/templates/ApproveAndCallBatchPermission.sol) — register + configure, no per-SMA deploy. Use when an autonomous, recurring, or unattended agent must approve an ERC-20 to a protocol, make one consuming call, and reset the allowance to zero — all in one atomic batch — so no standing allowance is ever left open, with token/spender/target/selector allowlists and a per-token approval cap. NOTE: `sailor mandate register` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires ApproveAndCallBatchPermission deployed on the target chain (recorded in sailor-templates/deployed.json); run sailor-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/ApproveAndCallBatchPermission.sol
---

# sailor-template-approve-batch — atomic approve/call/reset via the shared singleton

You typically arrive here from the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) with a complete strategy spec — this spoke covers the atomic approve/call/reset permission that lets an autonomous agent run an approve-then-act step unattended.

Reuse the shared **`ApproveAndCallBatchPermission`** singleton — the safest way to bracket a
single protocol interaction that needs an allowance. Family overview + flow:
[`sailor-templates`](../sailor-templates/SKILL.md). This template is the **atomic-batch** approve
model; when to choose it over the per-call model is owned by
[`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md).

## What it enforces (per account, from source)

Authorises exactly this 3-call batch:
```
[0] approve(spender, amount)   on an allowlisted ERC-20
[1] consuming call             on an allowlisted (target, selector)
[2] approve(spender, 0)        reset to zero (same atomic batch)
```
Invariants: `tokens`, `spenders`, and `consumingPairs` must each be non-empty with no zero
addresses/selectors (`EmptyAllowlist` reverts at configure otherwise); `token ∈ tokens` and
`amount ≤ maxApprovalAmount[token]`; `spender ∈ spenders`; `(target, selector) ∈ consumingPairs`;
the pre-batch allowance on `(token, spender)` must be zero; the consuming call must target the
approved `spender` and pull the approved `token`; the reset-to-zero is required; if
`requireAmountMatch`, the consuming call's leading `uint256` arg must equal the approve amount.
Malformed calldata reverts (kernel treats revert as deny).

> **Output recipient — `allowUnconstrainedRecipient` (opt-out, default-safe).** By DEFAULT
> (`allowUnconstrainedRecipient = false`, i.e. omitted) the consuming call's output recipient is
> decoded and **must equal the SMA** — the safe posture — and any selector outside the decodable
> set below is denied (fail-closed). Set `allowUnconstrainedRecipient = true` ONLY to deliberately
> leave the recipient unconstrained (e.g. to authorize a selector outside the decodable set); then
> only allowlist `(target, selector)` pairs whose semantics you trust to deliver output to the SMA.
> ⚠️ This is an **opt-out** flag, not an opt-in — do not set it `true` thinking that "requires"
> or "pins" the recipient; that gets you the opposite (unconstrained) behavior on-chain.
>
> **Decodable set** (recipient AND consumed-asset both resolvable at a fixed calldata offset —
> any other selector is denied regardless of `allowUnconstrainedRecipient`, since the consumed
> asset can never be bound to the approved token): `swapExactTokensForTokens` (V2), V3
> `exactInputSingle` (both the SwapRouter and SwapRouter02 layouts), Aave V2 `deposit` / Aave V3
> `supply`, ERC-4626 `deposit` / `mint`.

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(Config{
  address[]       tokens;                       // approvable ERC-20s
  address[]       spenders;                     // allowed allowance recipients
  ConsumingPair[] consumingPairs;               // {address target; bytes4 selector} — pair bound together
  uint256[]       maxApprovalAmounts;           // index-parallel with tokens; per-token cap
  bool            requireAmountMatch;           // call[1] leading uint256 must equal approve amount
  bool            allowUnconstrainedRecipient;  // OPT-OUT (default false = call[1] output recipient decoded, must == account)
})
struct ConsumingPair { address target; bytes4 selector; }
```
`maxApprovalAmounts.length` must equal `tokens.length` (configure reverts otherwise).
`consumingPairs` is a **struct array** `(address target, bytes4 selector)[]` — NOT two flat
`address[]`/`bytes4[]` arrays. A selector is authorised only on the target it is paired with.

**ABI tuple (verified round-trip):** `(address[],address[],(address,bytes4)[],uint256[],bool,bool)`.
Encode with cast — note `selector` is a `bytes4` (left-aligned), and both trailing bools are required:
```bash
cast abi-encode 'cfg((address[],address[],(address,bytes4)[],uint256[],bool,bool))' \
  '([<token>],[<spender>],[(<target>,<selector>)],[<maxApproval>],<requireAmountMatch>,<allowUnconstrainedRecipient>)'
```
`allowUnconstrainedRecipient` is an **opt-out** — leave it `false` unless you deliberately want
the consuming call's output recipient unconstrained (see the field note above).
The leading word is the `0x20` struct offset — that is correct, not flat-param corruption. A
generic (un-named) revert inside `_applyConfig` means the blob did not decode to this exact tuple
(usually: flat params with no `0x20` offset, the two flat arrays instead of `ConsumingPair[]`, or a
missing trailing bool). The named errors (`TokensAndAmountsLengthMismatch`, `EmptyAllowlist`,
`AllowlistTooLong`) fire only after a successful decode.

Then register → configure → simulate. `ApproveAndCallBatchPermission` has no CLI `--template`
encoder (only `SwapPermission` does today), so `$BLOB` from the `cast abi-encode` above goes
straight into `--params` — `--address` is a known shared-template singleton, so the signing
card's "what you're signing" explanation still renders automatically without `--template`/
`--label`:
```bash
sailor mandate register  --address <APPROVE_AND_CALL_BATCH_PERMISSION> --sma <SMA> --label "approve-and-call"
sailor mandate configure --address <APPROVE_AND_CALL_BATCH_PERMISSION> --sma <SMA> --params "$BLOB"
sailor mandate simulate  --address <APPROVE_AND_CALL_BATCH_PERMISSION> --sma <SMA> --calls ./probe.json
```

## Steps

Register → configure → simulate → reconfigure mechanics live in
[`sailor-templates` reuse-flow](../sailor-templates/references/reuse-flow.md) — follow it.
`sailor mandate register` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `ApproveAndCallBatchPermission` — `node .agents/skills/sailor-templates/catalog.mjs --chain
  <id>`.
- **Spec to confirm:** tokens+caps, spenders, `(target, selector)` consuming pairs,
  `requireAmountMatch`, `allowUnconstrainedRecipient`. Get each selector with `cast sig` and verify
  it delivers output to the SMA (leave `allowUnconstrainedRecipient = false`, the default, to
  enforce that on-chain — set `true` only to deliberately opt out).
- **Blob — ⚠️ NOT flat params.** `abi.encode(Config{ … })` — a **single wrapped struct**, so the
  blob starts with a `0x20` offset word. `consumingPairs` is `(address,bytes4)[]` (a struct array),
  and both trailing bools are required — see the verified `cast abi-encode` form above. Unlike
  transfer/withdraw/deposit/borrow/swap, wrapping is required here; a flat blob reverts at configure.
- **Simulate (mandatory — unaudited example):** the full allowed approve/call/reset batch passes;
  missing reset, off-list spender/target/selector, or over-cap approve is rejected.

## Next

Once this permission is configured and simulate passes (must-pass AND must-fail cases), return to the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) for the next permission. When every permission in the plan is registered, configured, and simulate-verified, proceed to Station 4 — the sailor-agent-build skill (dispatch mechanics: [`sailor-transactions`](../sailor-transactions/SKILL.md)).
