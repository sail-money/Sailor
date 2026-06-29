---
name: sail-template-approve-batch
description: Gate an SMA's "approve → call → reset" interactions by REUSING the shared ApproveAndCallBatchPermission singleton (Protocol/contracts/templates/ApproveAndCallBatchPermission.sol) — register + configure, no per-SMA deploy. Use when an agent must approve an ERC-20 to a protocol, make one consuming call, and reset the allowance to zero — all in one atomic batch — with token/spender/target/selector allowlists and a per-token approval cap. NOTE: `sailor mandate attach` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires ApproveAndCallBatchPermission deployed on the target chain (recorded in sail-templates/deployed.json); run sail-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/ApproveAndCallBatchPermission.sol
---

# sail-template-approve-batch — atomic approve/call/reset via the shared singleton

Reuse the shared **`ApproveAndCallBatchPermission`** singleton — the safest way to bracket a
single protocol interaction that needs an allowance. Family overview + flow:
[`sail-templates`](../sail-templates/SKILL.md).

## What it enforces (per account, from source)

Authorises exactly this 3-call batch:
```
[0] approve(spender, amount)   on an allowlisted ERC-20
[1] consuming call             on an allowlisted (target, selector)
[2] approve(spender, 0)        reset to zero (same atomic batch)
```
Invariants: `token ∈ tokens` and `amount ≤ maxApprovalAmount[token]`; `spender ∈ spenders`;
`(target, selector) ∈ consumingPairs`; the reset-to-zero is required;
if `requireAmountMatch`, the consuming call's leading `uint256` arg must equal the approve
amount. Malformed calldata reverts (kernel treats revert as deny).

> **Output recipient:** set `requireRecipientIsAccount = true` to have the consuming call's output
> recipient decoded and required to equal the SMA (selectors outside the decodable set are denied —
> fail-closed). When false (default) the recipient is NOT constrained — then only allowlist
> `(target, selector)` pairs whose semantics you trust to deliver output to the SMA.

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(Config{
  address[]       tokens;                    // approvable ERC-20s
  address[]       spenders;                  // allowed allowance recipients
  ConsumingPair[] consumingPairs;            // {address target; bytes4 selector} — pair bound together
  uint256[]       maxApprovalAmounts;        // index-parallel with tokens; per-token cap
  bool            requireAmountMatch;        // call[1] leading uint256 must equal approve amount
  bool            requireRecipientIsAccount; // true → decode call[1] output recipient, require == account (fail-closed)
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
  '([<token>],[<spender>],[(<target>,<selector>)],[<maxApproval>],<requireAmountMatch>,<requireRecipientIsAccount>)'
```
The leading word is the `0x20` struct offset — that is correct, not flat-param corruption. A
generic (un-named) revert inside `_applyConfig` means the blob did not decode to this exact tuple
(usually: flat params with no `0x20` offset, the two flat arrays instead of `ConsumingPair[]`, or a
missing trailing bool). The named errors (`TokensAndAmountsLengthMismatch`, `EmptyAllowlist`,
`AllowlistTooLong`) fire only after a successful decode.

## Steps

Register → configure → simulate → reconfigure mechanics live in
[`sail-templates` reuse-flow](../sail-templates/references/reuse-flow.md) — follow it.
`sailor mandate attach` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `ApproveAndCallBatchPermission` — `node SKILLS/sail-templates/catalog.mjs --chain
  <id>`.
- **Spec to confirm:** tokens+caps, spenders, `(target, selector)` consuming pairs,
  `requireAmountMatch`, `requireRecipientIsAccount`. Get each selector with `cast sig` and verify it
  delivers output to the SMA (or set `requireRecipientIsAccount` to enforce it on-chain).
- **Blob — ⚠️ NOT flat params.** `abi.encode(Config{ … })` — a **single wrapped struct**, so the
  blob starts with a `0x20` offset word. `consumingPairs` is `(address,bytes4)[]` (a struct array),
  and both trailing bools are required — see the verified `cast abi-encode` form above. Unlike
  transfer/withdraw/deposit/borrow/swap, wrapping is required here; a flat blob reverts at configure.
- **Simulate (mandatory — unaudited example):** the full allowed approve/call/reset batch passes;
  missing reset, off-list spender/target/selector, or over-cap approve is rejected.
