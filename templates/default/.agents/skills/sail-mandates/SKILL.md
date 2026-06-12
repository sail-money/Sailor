---
name: sail-mandates
description: The full permission-contract lifecycle — designing bounds with the user, authoring Solidity permissions, Foundry testing, deploying, simulating, and authorizing on the SMA, plus revoke/update/list and clone templates. Use when anything touches a permission contract or the mandate: writing or changing what the agent is allowed to do, deploying or attaching permissions, or verifying them before authorization.
---

# Sail mandates

The lifecycle is an ordered set of gates. **The order is the correctness model** — skipping a gate or reordering them is how funds get lost. Never authorize (attach) anything that has not passed every earlier gate.

## Gate 1 — Pin the strategy bounds with the user

Establish, explicitly: tokens, amounts, venues, slippage, recipients. Philosophy: **every meaningful financial bound is enforced on-chain in Solidity**; only frequency/cadence lives in agent TypeScript. If a bound matters and it is not in a permission contract, it is not a bound.

## Gate 2 — Enumerate every approve()

List every ERC-20 `approve()` the strategy implies. Each one needs its own bounded-approve coverage — a specific `(token, spender, maxAmount)` — authorized alongside the action permission. No supply, swap, or deposit permission covers approvals; the kernel rejects an uncovered `approve()`. Pair the approve and the action as `[approveCall, actionCall]` in one batch dispatch (see sail-transactions).

## Gate 3 — Author the permission contracts

Permission contracts live in `mandates/`. The user authors, reviews, and owns them. Start from the worked examples — see [references/examples-index.md](references/examples-index.md) for what each `examples/permissions/*.sol` teaches — adapt them, never present them as audited or as a closed menu.

- Implement `IPermission.evaluate(bytes txData, Context ctx) → bool` (single-call) or `IBatchPermission.evaluateBatch(Call[] calls, BatchContext ctx) → bool` (batch). Interfaces are vendored under `.sail/contracts/`.
- Use the `SailCalldata` library for bounded calldata decoding — slot-indexed reads after the 4-byte selector prevent silent truncation bugs.
- Bind recipients/beneficiaries to `ctx.account` wherever the protocol exposes them — funds must route to the SMA.
- **Selector correctness is life-or-death.** Verify every selector against the venue's authoritative deployed ABI — `cast sig "fn(types…)"` against the verified source — never from memory. A wrong selector fails closed (every legitimate call rejected) or worse, gates nothing. Real precedents: Venice staking is `stake(address,uint256)` = `0xadc9772e`, not `stake(uint256)` = `0xa694fc3a`; GMX v2's `createOrder` struct has changed across router versions — recompute the selector against the exact router the agent calls.

Prerequisite — Foundry. If `forge` is not found:

```bash
curl -L https://foundry.paradigm.xyz | bash   # then restart shell
foundryup
```

## Gate 4 — Write and run Foundry tests BEFORE any deployment

The scaffolded Foundry workspace ships no `test/` directory — create one. Write tests that call `evaluate()` (and `evaluateBatch()` for batch permissions) directly with calldata derived from the user's stated strategy:

- **Accept cases**: every call the strategy must make.
- **Reject cases**: out-of-bounds amounts, wrong tokens, wrong recipients, wrong selectors, unbound venues.

```bash
forge build
forge test
```

This gate comes before deployment because it is the only gate that exercises your boundary logic with full control of inputs, at zero cost. Do not deploy a permission whose tests do not pass.

## Gate 5 — Deploy (deploy only — never --attach yet)

```bash
sailor mandate deploy --contract <Name> --sma <SMA> --json   # BLOCKS — owner signs the contract-creation tx in the browser
```

The owner pays gas; the deployed address is read from the receipt and tracked in `.sail/state/mandates.json`. Add `--build` to run `forge build` first.

Constructor args: `--args '["0xToken","1000000"]'` (JSON array, inline, bash) or `--args-file args.json` (any shell — required on PowerShell). Full per-shell quoting rules: [references/constructor-args.md](references/constructor-args.md). Values are coerced to the constructor's ABI types (uint→bigint, etc.) and the array length is validated.

## Gate 6 — Simulate against must-pass AND must-fail samples

`evaluate()` lives on the deployed contract, so simulate after deploy and before the irreversible authorization. Generate sample calls from the user's stated strategy — ones the permission MUST accept and ones it MUST reject:

```bash
sailor mandate simulate --address <PermissionOrName> --sma <SMA> --calls calls.json --json
```

This is an off-chain `eth_call` — no gas, no signing. It reports what `evaluate()` returns per call, flags any target with no contract code on this chain (wrong or wrong-chain address), and checks whether each 4-byte selector actually routes on the target's bytecode. A mismatch between `expect` and the actual result exits non-zero. **Zero mismatches required before proceeding.** Simulate proves what the permission DOES; it does not guarantee it is correct.

`calls.json` schema: [references/calls-schema.md](references/calls-schema.md).

**Batch permissions:** simulate probes single-call `evaluate()` only — it does not exercise `evaluateBatch()`. Verify batch permissions by calling `evaluateBatch(calls, ctx)` directly via `cast call` with pass and fail batches before attaching.

## Gate 7 — Attach (authorize)

```bash
sailor mandate attach --address <PermissionOrName> --sma <SMA> --json   # BLOCKS — owner signs RegisterPermission EIP-712 in the browser
```

Only now is the permission live. The owner (mandate signer) signs in the browser; the agent submits the registration and pays gas plus any registration fee. The CLI verifies the signature came from the on-chain mandate signer — a wrong connected wallet is rejected. After confirmation it polls `getPermissions()` until the permission appears.

## Maintenance

- `sailor mandate revoke --address <P> --sma <SMA> --json` (or `--all`) — owner signs `RevokePermissions` in the browser (BLOCKS); agent submits. Revocations are recorded to the activity log; `state/mandates.json` keeps the historical record.
- `sailor mandate update --address <P> --name/--source-path/--artifact-path` — fix tracked metadata.
- `sailor mandate list` — everything deployed from this project, with attachments.
- `sailor mandate sign` — reviews the permission set and reconciles against live on-chain `getPermissions()` before writing `mandate.json`; permissions revoked on-chain are excluded even if still in local state. `--yes` for non-interactive use.
- `sailor account rotate-signer` — rotates the agent wallet and re-approves attached mandates (BLOCKS on browser); `--reattach-only` resumes after funding, `--list` shows known agent wallets.

## Clone templates (deploy-clone)

`sailor mandate deploy-clone --template boundedApprove --sma <SMA> --tokens <csv> --spenders <csv> --max <wei> --json` deploys + registers an EIP-1167 clone of a published implementation in one transaction (owner signs `RegisterPermission` for the predicted clone address — BLOCKS; agent submits `deployAndAttach`). The only template key is `boundedApprove`. Implementations come from the SDK deployment registry (`standaloneTemplates`) — currently **empty on all six chains** pending redeployment against the new kernel, so deploy-clone errors with a clear message and you should write and deploy a bounded-approve permission with `sailor mandate deploy` instead. Check availability with `sailor mandate templates --json`.
