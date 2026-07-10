---
name: sailor-project-info
description: Anytime read-only utility — commands and state files that answer questions about the project, account, mandate, chains, keys, or environment. Use when the user asks "what's the state of…", "is X set up", "am I ready", "check my setup", "run a preflight", "which chains…", "what permissions are registered", or before any operation that needs current state.
---

# Sail project info

Every command here is read-only and supports `--json` for machine reading. Prefer `--json`; parse, don't scrape. None of them block on the browser.

| Command | Reports | Backed by |
|---|---|---|
| `sailor status` | One-screen setup progress: keys present, account, signed mandate, session, agent run state | Local: `.sail/account.json`, `mandate.json`, `session.json`, `keys/`, agent pid file |
| `sailor doctor --json` | Preflight: kernel dispatch model, permission health (per-permission evaluate probes), RPC reachability, gas balances of owner + agent wallets | On-chain reads via the configured RPC; `--account <address>` overrides the SMA |
| `sailor capabilities --json` | Feasibility map: resolved chain, kernel model, available mandate templates, strategy primitives | `deployments.ts` registry + on-chain typehash detection |
| `sailor chains --json` | Supported chains and their SailKernel addresses | Static registry; add `--verify` to `eth_getCode` each kernel (one RPC call per configured chain) |
| `sailor scan --json` | Owner's Safes, which are Sail SMAs, their managers/permissions/sessions, local keys — persisted to `.sail/state/context.json` | Safe Transaction Service + kernel reads; `--owner <address>` overrides the saved owner |
| `sailor owner show --json` | The saved project owner address | `.sail/state/owner.json` |
| `sailor keys show` | Address of each stored key (decrypts to derive the address; prompts for passphrase unless `SAIL_PASSPHRASE` is set) | `.sail/keys/*.json` |
| `sailor mandate list` | Permission contracts deployed from this project, with registration history | `.sail/state/mandates.json` |
| `sailor mandate templates --json` | How to author a permission + any community-deployed standalone template addresses on this chain (unaudited, informational) | `deployments.ts` `standaloneTemplates` |

## Which source answers what

- "Is the SMA deployed?" — `account.json` exists and has `safe`; `doctor` confirms on-chain.
- "What can the agent do right now?" — on-chain `getPermissions()` is the truth; `mandate sign` reconciles against it. `state/mandates.json` is an append-only historical record — a permission revoked on-chain still appears there.
- "Is the RPC working / is there gas?" — `sailor doctor --json`.
- "Same address on another chain?" — `account.json` `deployedChains`, verified by `sailor account predict`.
- "Is anything running?" — `.sail/runtime/ui.json` (dashboard), `.sail/runtime/server.json` (signing server), agent pid via `sailor status`.

Run `sailor doctor` before any operation that spends gas — it is the cheapest way to catch a dead RPC, an unfunded wallet, or a kernel mismatch first. (Full preflight semantics and its role as Station 1's exit verifier: [`sailor-onboarding`](../sailor-onboarding/SKILL.md).)

- "What is the permission registration fee?" — read live from the chain; mechanics and current value are owned by [`sailor-mandates`](../sailor-mandates/SKILL.md) (Registration fee section).

## Worked sample — `sailor doctor --json` on a fresh project

Genuine output shape (addresses shown as placeholders; run it for live values):

```json
{
  "chainId": 8453,
  "kernel": "0xKERNEL…",
  "dispatchModel": "selective",
  "dispatchTypehash": "0xTYPEHASH…",
  "capabilitySource": "onchain-typehash",
  "rpc": { "chainIdOnChain": 8453, "chainIdMatches": true },
  "wallet": { "owner": null, "manager": null },
  "passphrase": { "keystorePresent": false, "envSet": false },
  "account": null,
  "saltNonce": null,
  "permissions": [],
  "permissionsWithoutCode": [],
  "conjunctivePassThrough": "n/a (selective kernel)",
  "healthy": false
}
```

`healthy: false` here because no account or keys exist yet — expected on a fresh project.

---

This is an anytime utility, not a station — once you have your answer, return to the station you came from.
