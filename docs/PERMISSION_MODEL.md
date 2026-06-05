# Sail permission model: conjunctive vs selective

The deployed SailKernel ships in **two incompatible dispatch models**. Which one a
chain runs changes how dispatches are signed *and* how permissions must be written.
Get this wrong and every dispatch reverts with an opaque selector. This is the single
most important thing to understand before operating an SMA.

## TL;DR

| | **Conjunctive** (older) | **Selective** (newer) |
|---|---|---|
| Chains today (bundled kernels) | None — all bundled kernels moved to selective | Base (8453), Base Sepolia (84532), Arbitrum (42161), Unichain (130) |
| `dispatch(...)` | `(account, target, value, data, sig, deadline)` — **no `permission`** | `(account, permission, target, value, data, sig, deadline)` |
| Which permissions are checked | **ALL** registered permissions; **all must return true** | only the **one** permission named in the call |
| EIP-712 `Dispatch` struct | no `permission` field | includes `permission` |
| Batch (`dispatchBatch`/`previewBatch`) | **not available** | available |
| **Permission design rule** | **MUST pass through calls outside its domain** | may return false freely |

Don't guess from a version string — **detect it on-chain** (see below).

## The conjunctive pass-through rule (the big footgun)

On a conjunctive kernel the kernel calls `evaluate(txData, ctx)` on **every**
registered permission and ANDs the results. A single `false` blocks the whole
dispatch (`PermissionDenied`).

So a permission that only cares about, say, approvals **must still return `true` for
every call it doesn't govern**:

```solidity
function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
    // Pass through calls outside this permission's domain (conjunctive model).
    if (ctx.selector != APPROVE) return true;   // <-- without this line, this
                                                 //     permission bricks swaps,
                                                 //     transfers, everything.
    // ...domain-specific checks for approve...
}
```

A permission that returns `false` (or reverts, or runs out of gas — both treated as
`false`) on unrelated calls **bricks the entire account**: no dispatch of any kind
can pass. We hit exactly this during bring-up with permissions that "blocked each
other." The fix was to redeploy every permission with pass-through semantics.

Corollary: on a conjunctive kernel you **cannot** have two permissions that each
enforce a different token's approve — each would reject the other's token. To support
approving both DAI and USDC you need **one** approve permission that allows both (see
`templates/lifi-permissions/`), not two narrow ones.

Selective kernels don't have this problem: each dispatch names one permission and
only that one is consulted.

## Detect the model on-chain

The SDK reads each kernel's public `DISPATCH_TYPEHASH` constant and matches it
against the canonical hashes for each model. Never assume.

```ts
const caps = await client.capabilities();
// caps.dispatchModel: "conjunctive" | "selective"
// caps.dispatchTypehash, caps.source ("onchain-typehash" | "static-hint")
```

Verified typehashes:

- conjunctive `DISPATCH_TYPEHASH` = `0x7510c80e…`
  `Dispatch(address account,address target,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)`
- selective `DISPATCH_TYPEHASH` =
  `Dispatch(address account,address permission,address target,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)`

`client.dispatch.single(...)` already signs the correct struct and uses the correct
ABI for the detected model — you don't sign by hand. `client.dispatch.batch` /
`preview` throw a clear error on conjunctive kernels (no `dispatchBatch`).

## Roles (unchanged across models)

| Role | Authority |
|------|-----------|
| **Owner** | Holds the Safe; custody anchor. |
| **Permission Signer** | Authorizes which `IPermission` contracts apply (EIP-712 `RegisterPermissions` / `RevokePermissions`). Signed in the browser signing station — the agent never holds this key. |
| **Manager** | Executes dispatches within the registered permissions (ECDSA / ERC-1271). The agent's hot key. |

## Preflight before spending gas

Run `sailor doctor` (read-only, no gas, no keys):

- detects the dispatch model,
- lists registered permissions,
- on a conjunctive kernel, **probes each permission for pass-through** and flags any
  that would brick dispatch.

See [AGENTS.md](../AGENTS.md) for the operational decision tree and the
revert failure-mode catalog.
