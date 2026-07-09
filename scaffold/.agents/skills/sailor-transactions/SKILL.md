---
name: sailor-transactions
description: How dispatches and EVM transactions work in a Sailor project — the selective dispatch model, signing, batching, permission resolution, running the agent, and which CLI commands block on a browser signature. Use when building or debugging dispatches, writing agent tick code, running the agent, or reasoning about why a transaction was denied or reverted.
---

# Sail transactions

## The dispatch model

The deployed kernels run the **selective** model: every dispatch names one registered permission, and the kernel calls that permission's `evaluate()` (or `evaluateBatch()` for batches) on-chain before executing. A permission returning false, reverting, or exceeding its gas cap is a denial — fail-closed.

Never hardcode the model. `detectKernelCapabilities` (SDK) reads the on-chain `DISPATCH_TYPEHASH()` and is the only reliable source; the static label in `deployments.ts` is an offline fallback.

## Signing

Never hand-roll the EIP-712 dispatch struct. Use `buildDispatchSignature` from the SDK — it reads the on-chain typehash and builds the correct typed data for the detected model.

## Writing agent code

The runner (`sailor run`) calls `agent.tick(ctx)` from `src/agent.ts` and submits each returned `Dispatch`:

- A dispatch is `{ calls: [{ target, value, data }, …] }`. One call = single dispatch; multiple calls = batch dispatch (single on-chain tx, all-or-nothing).
- You do not name permissions: the runner probes each registered permission in registration order (off-chain `evaluate()` / `previewBatch` via `eth_call`) and routes to the first that accepts. Set `dispatch.permission` only as an explicit override to skip the probe.
- **Approve + action** is either two single-call dispatches or one batch `Dispatch` (`calls: [approve, action]` authorized by a single `IBatchPermission`) — the two models are not mixable. Which to use, and how to cover the `approve()`, is owned by [`../sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md); follow the one the mandate plan chose.
- `ctx` provides `read.balance/allowance/decimals`, `publicClient` (arbitrary reads), `log()`, and a persistent `data` slot.
- Return `[]` to skip a tick — no gas spent.

## Running

```bash
sailor run --once          # single tick — confirm it works before automating
sailor run                 # continuous; interval SAILOR_INTERVAL seconds (default 60)
sailor run --chain <id>    # override CHAIN_ID for this run
```

`run` needs `.sail/account.json`, `.sail/mandate.json`, a manager key, `CHAIN_ID` and an RPC URL (`.sail/.env.local`). Set `SAIL_PASSPHRASE` in `.env.local` to unlock the agent wallet non-interactively. Neither form blocks on a browser — the signed mandate is the authorization. Once the mandate is signed and the agent is running, the agent transacts autonomously within it — do not ask the user to confirm individual dispatches inside the mandate.

## Where results land

Everything appends to `.sail/activity.jsonl` (one JSON per line): `tick_start`/`tick_end`, `dispatch_approved`, `dispatch_executed` (with `txHash`), `dispatch_reverted` (with `txHash`, `gasUsed`), `dispatch_denied` (with `target`/`reason`, e.g. `no_permission_match`), `error`, and owner-side `owner_signed`/`owner_rejected` events. On stderr, reverts surface as `reverted: <txHash>  (gas used: N)`; denials as `skipped: no registered permission authorizes call to <target> (selector 0x…)` — the rejected selector is in this stderr line, not the JSON event. A failed dispatch never stops the loop.

## Commands that BLOCK on a browser signature

These open a signing channel, push a request, and wait (default timeout 10 minutes) for the owner to approve in the browser. When one is pending, tell the user: "approve the request in the signing station in your browser" and give them the station URL the command printed.

| Command | What the owner signs |
|---|---|
| `sailor onboard --new-sma` | `create-sma` transaction (owner pays gas) |
| `sailor account deploy-chain --chain <id>` | `create-sma` transaction on the target chain |
| `sailor account rotate-signer` | Delegate rotation + mandate re-approvals |
| `sailor mandate deploy` | `deploy-mandate` contract-creation transaction (owner pays gas) |
| `sailor mandate register` | `RegisterPermission` EIP-712 — one permission; a comma-separated `--address` list signs `RegisterPermissions` once for all (off-chain signature; agent submits and pays gas) |
| `sailor mandate deploy-clone` | `RegisterPermission` EIP-712 for the predicted clone address (use `mandate deploy` instead — deploy-clone is currently unavailable, no clone templates are deployed on any chain) |
| `sailor mandate revoke` | `RevokePermissions` EIP-712 (agent submits and pays gas) |
| `sailor owner connect` | Nothing — blocks up to 300s waiting for a wallet to connect |

All take `--json` for machine-readable output; in `--json` mode the blocking commands emit a `waiting_for_signature` status with the URL before blocking.

## Session control

`sailor session pause` instantly revokes dispatch rights without touching custody; `sailor session resume` restores them.
