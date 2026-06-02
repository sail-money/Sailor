# Sail agent playbook

Operational guide for an agent (or operator) running a Sail Protocol SMA via the
Sailor SDK/CLI. Read [docs/PERMISSION_MODEL.md](docs/PERMISSION_MODEL.md) first — the
conjunctive vs selective distinction underpins everything below.

Golden rule: **always ask the user before any action that costs gas or moves funds.**

## Step 0 — detect capabilities (always first)

Before signing or dispatching anything, learn what kernel you're on:

```ts
const caps = await client.capabilities();   // reads DISPATCH_TYPEHASH on-chain
```

or, from the CLI, run the full preflight:

```bash
sailor doctor            # kernel model + permission health, read-only, no gas
sailor doctor --json     # machine-readable
```

`sailor doctor` detects the dispatch model, lists registered permissions, and — on a
conjunctive kernel — flags any permission that does **not** pass through unrelated
calls (which would brick every dispatch). Fix those before doing anything else.

## Decision tree

```
Want to act on the SMA?
│
├─ Is the Sail module enabled + account registered?      → no:  finish onboarding (sailor onboard)
│
├─ sailor doctor green?                                   → no:  revoke/replace bricking permissions first
│
├─ Need a NEW kind of action the permissions don't allow? → yes: register a permission (owner signs)
│     • Conjunctive: the permission MUST pass through other calls. Prefer ONE
│       permission per domain that allows everything you need (e.g. a single
│       approve permission whitelisting all tokens you'll approve).
│     • Use a clone template when one exists (no Solidity):
│       getSailDeployment(chainId).cloneTemplates  → deployAndAttach
│
├─ One-off swap?                                          → client.strategy.swap({from,to,amount,slippage})
│
└─ Recurring/automated (DCA, rebalance)?                  → loop strategy.swap on a schedule;
                                                            approve a larger batch once so most
                                                            iterations are a single swap dispatch.
```

### Approvals

- An ERC-20 `approve` is itself a dispatch and must pass the registered permissions.
  On a conjunctive kernel that means an **approve permission that allows the token +
  spender + amount**, AND every other permission passing the approve through.
- The bounded-approve template uses **per-token caps** (token value/decimals differ:
  1 DAI = 1e18 vs 1 USDC = 1e6). One global cap can't bound both.
- `client.strategy.swap` only approves when the current router allowance is below the
  trade size, so steady-state swaps are a single dispatch. Pass `approveAmount` larger
  than `amount` to batch a bigger approval for DCA.

### Swap mandates (LiFi)

- The swap permission restricts: target = LiFi diamond, selector allowlisted, embedded
  receiver == the account, `minAmount` ≤ cap. Verify the route's selector is
  allowlisted (Base routes commonly use `0x5fd9ae2e`); add others via the permission
  signer if needed.
- Default slippage is 3% — LiFi's own 0.5% reverts (`CumulativeSlippageTooHigh`) on
  small trades.

### Automated jobs

- Sequential dispatches: `client.dispatch.single` auto-tracks the manager nonce per
  `(kernel, account)` and waits for the prior bump to propagate before signing the
  next — no manual nonce handling, even on a load-balanced RPC.
- Use a dedicated RPC endpoint (not a public replica) to minimize read-after-write lag.
- Pin post-tx reads to the receipt's block; a lagging node can otherwise make a
  confirmed action look failed.

## Failure-mode catalog

Every dispatch failure is decoded by the SDK — `client.dispatch.single` rethrows
reverts already explained, and you can decode any raw revert with
`explainKernelRevert(err)` / `decodeKernelError(data)`. Common ones:

| Error (selector) | What it means | Fix |
|---|---|---|
| `InvalidManagerSignature` (`0xeb6942f1`) | The signed EIP-712 Dispatch didn't recover to the registered manager. | Almost always a **stale manager nonce** (RPC lag or two dispatches signed against the same nonce) — re-read `managerNonces` and re-sign; `dispatch.single` now handles this. Or the **wrong Dispatch struct** for this kernel — use `capabilities()`. |
| `PermissionDenied(permission)` | A registered permission's `evaluate()` returned false / reverted / ran out of gas. | On a **conjunctive** kernel, a permission that doesn't pass through unrelated calls bricks everything — run `sailor doctor` and revoke/replace it. Otherwise the call genuinely violates that permission's bounds. |
| `NoPermissionsRegistered(account)` | Account has zero permissions; kernel denies by default. | Register at least one permission (owner signs). |
| `PermissionNotRegistered(permission)` | Named permission isn't registered. | Register it; or on a conjunctive kernel drop the permission arg (the SDK does). |
| `SessionInactive(account)` | Manager session is revoked. | `session.activate` before dispatching. |
| `DeadlineExpired(deadline,current)` | Signature deadline is in the past. | Sign with a deadline comfortably ahead of `block.timestamp`. |
| `SafeExecutionFailed()` | Permission passed, but the target call itself reverted. | Usually slippage too tight, insufficient allowance/balance, or a failing route — not a permission problem. |
| `ModuleNotEnabled()` | Sail module not enabled on the Safe. | Complete onboarding (enable the module) first. |
| `ProtocolPaused()` | Governance paused the protocol. | Wait for unpause. |
| `NotManager(caller,expected)` | Submitter isn't the registered manager. | Submit from the manager key. |
| `TooManyPermissions(account,limit)` | Per-account permission cap reached. | Revoke an unused permission first. |

When in doubt, the SDK hint string (in `error.kernelError.hint`) names the likely
cause and fix.

## Quick reference (SDK)

- `client.capabilities()` — detect dispatch model.
- `client.dispatch.single(safe, permission, call, manager, opts?)` — nonce-safe single dispatch (`opts`: `nonce`, `awaitNonce`, `gas`, `deadline`).
- `client.strategy.swap(safe, {from,to,amount,slippage,swapPermission?,approveAmount?}, manager)` — approve-when-low + LiFi swap.
- `explainKernelRevert(err)` / `decodeKernelError(data)` — human-readable revert.
- `getSailDeployment(chainId).cloneTemplates` — wizard-ready clone templates + their `initialize()` params.
- CLI: `sailor capabilities` (feasibility map), `sailor doctor` (preflight: model, permissions, RPC + gas), `sailor onboard`, `sailor mandate …`, `sailor station start`.
