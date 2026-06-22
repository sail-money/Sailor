---
name: sail-mandates
description: The full permission-contract lifecycle — designing bounds with the user, authoring Solidity permissions, Foundry testing, deploying, simulating, and authorizing on the SMA, plus revoke/update/list and clone templates. Use when anything touches a permission contract or the mandate: writing or changing what the agent is allowed to do, deploying or attaching permissions, or verifying them before authorization.
---

# Sail mandates

The lifecycle is an ordered set of gates. **The order is the correctness model** — skipping a gate or reordering them is how funds get lost. Never authorize (attach) anything that has not passed every earlier gate.

## Gate 1 — Pin the strategy bounds with the user

Every constraint a strategy needs is one of two kinds, and you must tell the operator which is which so they sign knowing what is enforced where:

- **Safety bounds** — protect against loss or theft: amount caps, recipient allowlists, venue/router allowlists, slippage/min-out floors, LTV ceilings, and the like. These are enforced **on-chain in a permission contract, default-ON**. Dropping one requires an explicit, stated justification — never a silent omission. **If a bound matters and it is not in a permission contract, it is not a bound.**
- **Strategy parameters** — express *how* the strategy runs, not a theft/loss surface: cadence/frequency, schedule, rebalance timing. These live in **agent logic** by nature — permissions are stateless, and these are not safety surfaces (the safety bounds hold regardless of timing). If the operator states one (e.g. a cadence), it is a required agent-side guard that must be **wired and confirmed before go-live** — not optional, never silently dropped — but do not try to push it on-chain.

**Enumerate** from the operator's stated strategy *and* from what the protocol can express for the venues involved — do not work from a fixed checklist. Explain what each constraint protects against, classify it as a safety bound (on-chain) or a strategy parameter (agent-side), and say so to the operator.

**Precedence.** Operator intent and the strategy's stated bounds outrank any example. If the operator asks for a constraint an example omits, include it — never let an example's shape narrow the mandate below what the operator requested.

Examples are illustrations, not the supported set. Sail supports any token, venue, protocol, pool, or contract expressible as a permission — never treat an example's specific addresses as the only ones available. When the operator names something not in your examples, resolve it from authoritative sources (official docs, canonical lists, block explorers) and verify on-chain before binding a mandate to it. Caps are denominated in base units — a token decimals mismatch (USDC is 6, most ERC-20s are 18) silently mis-sizes every bound; confirm decimals on-chain before sizing caps.

## Gate 2 — Enumerate approvals and pick the execution model

List every ERC-20 `approve()` the strategy implies — protocol permissions never cover `approve()`, so each needs explicit coverage. How it is covered depends on the model you choose (read [references/approvals.md](references/approvals.md) before writing any contract):

- **Per-call (default).** Approve and act are separate single-call dispatches, each gated by its own `IPermission`. Approve a sufficient allowance once and skip it when the on-chain allowance already covers the next action (the `examples/dca/` pattern). This is what the scaffolded `IPermission` supports out of the box.
- **Atomic batch (advanced).** Approve + action run as one `dispatchBatch`. A batch consults exactly ONE batch-aware `IBatchPermission` (`evaluateBatch`) that validates the whole sequence — NOT two narrow `IPermission`s. Use this only when atomicity matters; see `references/approvals.md`. Do not mix the models.

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

`test/BoundedCallPermission.t.sol` is the scaffolded example — copy it for each permission you author. Write tests that call `evaluate()` (and `evaluateBatch()` for batch permissions) directly with calldata derived from the user's stated strategy:

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

When a strategy needs several permissions, **deploy all of them first** (don't `--attach` yet). Each deploy is its own owner-signed contract-creation transaction — those cannot be combined — but attaching them is a single signature (Gate 7), so deploy the full set, then attach it in one step.

Constructor args: `--args '["0xToken","1000000"]'` (JSON array, inline, bash) or `--args-file args.json` (any shell — required on PowerShell). Full per-shell quoting rules: [references/constructor-args.md](references/constructor-args.md). Values are coerced to the constructor's ABI types (uint→bigint, etc.) and the array length is validated.

## Gate 6 — Simulate against must-pass AND must-fail samples

`evaluate()` lives on the deployed contract, so simulate after deploy and before the irreversible authorization. Generate sample calls from the user's stated strategy — ones the permission MUST accept and ones it MUST reject:

```bash
sailor mandate simulate --address <PermissionOrName> --sma <SMA> --calls calls.json --json
```

This is an off-chain `eth_call` — no gas, no signing. It reports what `evaluate()` returns per call, flags any target with no contract code on this chain (wrong or wrong-chain address), and checks whether each 4-byte selector actually routes on the target's bytecode. A mismatch between `expect` and the actual result exits non-zero. **Zero mismatches required before proceeding.** Simulate proves what the permission DOES; it does not guarantee it is correct.

`calls.json` schema: [references/calls-schema.md](references/calls-schema.md). How to design pass/fail cases: [references/simulate-calls.md](references/simulate-calls.md).

**Batch permissions:** simulate probes single-call `evaluate()` only — it does not exercise `evaluateBatch()`. Verify batch permissions by calling `evaluateBatch(calls, ctx)` directly via `cast call` with pass and fail batches before attaching.

## Gate 7 — Attach (authorize)

```bash
sailor mandate attach --address <PermissionOrName> --sma <SMA> --json              # one permission, one signature
sailor mandate attach --address <addr1>,<addr2>,<addr3> --sma <SMA> --json          # many permissions, ONE signature
```

Only now is the permission live. The owner (mandate signer) signs in the browser; the agent submits the registration and pays gas plus any registration fee. **Fund the agent wallet before attaching**, or this step fails with `gas required exceeds allowance`. The CLI verifies the signature came from the on-chain mandate signer — a wrong connected wallet is rejected. After confirmation it polls `getPermissions()` until the permissions appear.

When a strategy needs several permissions (e.g. a bounded-approve alongside the protocol permission), attach them all at once by passing a comma-separated list of addresses — the registration approvals collapse to a **single** browser signature via the kernel's `registerPermissions`. The earlier per-contract deploy approvals (Gate 5) are separate and unavoidable. A single permission attaches exactly as before with `--address <one>`.

## Registration fee

Registering a permission charges a **per-permission fee**, paid on-chain by the agent wallet at the moment of registration. It is a public protocol parameter — `permissionRegistrationFee()` on `SailGovernance` — read **live from the chain**, never hardcoded: it is `0.00001 ETH` on test deployments and higher in production, and the same flow surfaces whichever value the connected chain returns.

- **A mandate is a SET of permissions, so a mandate of N permissions costs `N × fee`.** Three permissions at `0.00001 ETH` each cost `0.00003 ETH` total.
- **When it's charged:** once per permission, on registration (the `attach` / `deploy-clone` step). Already-registered permissions are not re-charged when you re-run `sailor mandate sign`. Revoking does not refund.
- **Disclosure before signing:** `sailor mandate prepare` reads the live fee and records it in the draft, and `sailor mandate sign` prints `Registration fee: <total> ETH (<N> permissions × <fee> ETH)` before you confirm. The browser sign-time screen shows the same total.
- **Preflight:** before requesting the owner's signature, the agent wallet's ETH balance is checked against the total fee; an underfunded wallet fails early with `Insufficient ETH for the <X> ETH registration fee` instead of an on-chain revert. **Fund the agent wallet before attaching.**
- **Recorded:** each `permission_registered` activity entry carries the fee actually paid (`fee` in wei, `feeEth` formatted), so Recent Activity shows the real cost.

The exact fee on the kernel transaction is computed by `estimatePermissionFee` (it models the deployed governance's fee formula); the figure disclosed and previewed is the governance `permissionRegistrationFee` parameter.

## Maintenance

- `sailor mandate revoke --address <P> --sma <SMA> --json` (or `--all`) — owner signs `RevokePermissions` in the browser (BLOCKS); agent submits. Revocations are recorded to the activity log; `state/mandates.json` keeps the historical record.
- `sailor mandate update --address <P> --name/--source-path/--artifact-path` — fix tracked metadata.
- `sailor mandate list` — everything deployed from this project, with attachments.
- `sailor mandate sign` — reviews the permission set and reconciles against live on-chain `getPermissions()` before writing `mandate.json`; permissions revoked on-chain are excluded even if still in local state. `--yes` for non-interactive use.
- `sailor account rotate-signer` — rotates the agent wallet and re-approves attached mandates (BLOCKS on browser); `--reattach-only` resumes after funding, `--list` shows known agent wallets.

## Clone templates (deploy-clone)

`sailor mandate deploy-clone --template boundedApprove --sma <SMA> --tokens <csv> --spenders <csv> --max <wei> --json` deploys + registers an EIP-1167 clone of a published implementation in one transaction (owner signs `RegisterPermission` for the predicted clone address — BLOCKS; agent submits `deployAndAttach`). The only template key is `boundedApprove`. Implementations come from the SDK deployment registry (`standaloneTemplates`) — currently **empty on all six chains** pending redeployment against the new kernel, so deploy-clone errors with a clear message and you should write and deploy a bounded-approve permission with `sailor mandate deploy` instead. Check availability with `sailor mandate templates --json`.
