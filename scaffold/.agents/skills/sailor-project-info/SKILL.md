---
name: sailor-project-info
description: Answer read-only questions about project state: account, mandate, chains, keys, and environment. Use when asked what's the state of, is this set up, or check my setup, or before any operation that needs current state.
---

# sailor-project-info — read-only state: account, mandate, chains, keys

Every command here is read-only and supports `--json` for machine reading. Prefer `--json`; parse, don't scrape. None of them block on the browser.

**Check both state roots.** Every command below reads the **live** root (`.sail/`) by default. A project onboarded through the sandbox path keeps its state under `.shipyard/sandbox/` (identical file shape), and a plain read will report it as empty. Before answering any "is X set up / what's the state" question, check for a sandbox and, if present, report both:

```bash
[ -f .shipyard/sandbox/account.json ] && sailor sandbox status   # sandbox exists + is the dashboard up?
SAIL_DIR=.shipyard/sandbox sailor status --json                  # sandbox state (SMA, keys, mandate)
sailor status --json                                             # live state
```

`SAIL_DIR=.shipyard/sandbox` makes any command here read the sandbox root. When both roots are populated, say which is which — never conflate a fork SMA with a live one. (Full sandbox model: `sailor-onboarding` "Two state roots".)

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
- "Is anything running?" — `.sail/runtime/ui.json` (dashboard), `.sail/runtime/server.json` (signing server), agent pid via `sailor status`; `.shipyard/sandbox/runtime/ui.json` or `sailor sandbox status` (sandbox dashboard).
- "Is this a sandbox or live SMA?" — `.shipyard/sandbox/account.json` = a fork SMA (zero real funds); `.sail/account.json` = live. `curl -s <dashboard-url>/api/mode` disambiguates a running dashboard.

Run `sailor doctor` before any operation that spends gas — it is the cheapest way to catch a dead RPC, an unfunded wallet, or a kernel mismatch first. (Full preflight semantics and its role as Station 1's exit verifier: `sailor-onboarding`.)

- "What is the permission registration fee?" — read live from the chain; mechanics and current value are owned by `sailor-mandates` (Registration fee section).

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
