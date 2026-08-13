---
name: sailor-onboarding
description: Set up a new Sailor project or resume a partial one: deploy the SMA, create the agent wallet, and connect chains. Use when the project has no SMA yet, when account state is missing, or when asked to start, set up my wallet, or deploy my agent.
station: arrive
---

# sailor-onboarding — set up the project, keys, account, and chain (Station 1)

## What this owns

Station 1 (ARRIVE): get the project from nothing to a deployed SMA with a working agent wallet. Read
state to find where the project is, and enter at the right point — never re-run completed work.

Voice: explain *why*, not just *what* — the user is moving real funds. Use user-facing terms (SMA,
mandate, permissions, agent wallet, owner). Assume crypto-native; teach the Sail-specific model. Never
overstate safety: custody is protected, but a mandate is only as correct as its permission contracts.
The first-contact script and its deviations are in
[references/welcome-script.md](references/welcome-script.md).

## When to use

- The project has no SMA yet, or `.sail/account.json` is missing or incomplete.
- The user says "start", "set up my wallet", "connect my wallet", "deploy my agent", "fund the agent".
- Deploying the SMA to an additional chain.

## Running the CLI

Read `.sail/config.json → installMode` first: `"local"` (or absent) → run `sailor <command>` directly;
`"docker"` → prefix commands with `docker exec <containerName>` (read from the same config), but
read/write project files from local paths. Full detail: `sailor-servers` ("Docker installation").

The published package is **`@sail.money/sailor`** — always the scoped name. The bare `sailor` is an
unrelated package; never `npx sailor@<version>` or `npm i sailor`. Pin a recent version
(`npx @sail.money/sailor@latest --version`) — an old cached `npx` build can be missing newer commands.
After upgrading the CLI, run `sailor update` from the project root.

## Determine where the user is

**Check the sandbox root before deciding anything.** A Sailor project has two parallel `SAIL_DIR`s with
identical file shape: `.sail/` (live) and `.shipyard/sandbox/` (the native sandbox, named **Shipyard**).
`sailor status`/`doctor` read the **live** root only — a user who onboarded through Shipyard has an SMA
and mandate under `.shipyard/sandbox/`, invisible to a plain `.sail/` read. This is the single most
common Station-1 misread. Always check first:

```bash
[ -f .shipyard/sandbox/account.json ] && echo "SANDBOX SMA EXISTS" || echo "no sandbox SMA"
SAIL_DIR=.shipyard/sandbox sailor status   # reads the SANDBOX root
```

Prefix any command with `SAIL_DIR=.shipyard/sandbox` to read the sandbox root. If both roots are
populated, ask which one this session is about. (Full detection logic lives in `sailor-navigator`'s
"Two state roots".)

Read the **active root**, substitute it for `.sail/` below:

| state (in the active root) | Where you are |
|---|---|
| No `account.json` | Station 1 — hand the user to the setup UI for ALL of: chain choice, agent wallet + passphrase, SMA deploy. Never ask which chain or for a passphrase in chat. |
| `account.json` exists, no `strategies/*.md` | Station 1 complete → Station 2 (`sailor-strategy`). |
| + complete `strategies/<name>.md` + `strategies.json`, no tracked mandates | → Station 3 (`sailor-mandate-planner`). |
| + tracked mandates in `state/mandates.json` | → Stations 4–5 (`sailor-agent-build`, then `sailor-automation` + `sailor-extend`). |

Supported chains: `sailor chains --json` lists them with kernel addresses.

## Deploy the SMA and create the agent wallet

**Canonical path — the setup UI, for every first-time SMA.** Run `sailor ui start`, hand the user the
bare URL (no hash — it opens the wizard, never the signing page). In the wizard the user chooses the
network, connects the owner wallet, sets a passphrase and generates the agent wallet (the separate key
the agent signs with), then deploys the SMA. All of that is the user's decision in the UI; your job is to
get them there and narrate, not to decide it in chat.

**Both wallets need gas, and the split is not what it looks like:** the owner wallet pays for SMA
deployment and **`mandate deploy`** (a contract-creation transaction the owner signs). The **agent
wallet** pays for `mandate register` and every dispatch. Fund the agent wallet before registering
(Station 3) or it fails with "gas required exceeds allowance"; fund the owner wallet before Station 3
too. The owner key never leaves the browser, and never will (invariant 6).

**Headless alternative (CLI-only, only when the user explicitly wants it):**

```bash
sailor keys generate                 # agent wallet — passphrase prompt (never in chat)
sailor signer start --json &         # signing daemon — BLOCKS; run in background
sailor owner connect --json          # BLOCKS waiting for a browser wallet connect
sailor scan --json                   # discover the owner's Safes
sailor onboard --new-sma --json      # deploy SMA — BLOCKS for the owner's browser signature
```

`sailor ui start` must also be running before this path prints a usable URL.

## Deterministic address (salt)

Every SMA deploy uses a CREATE2 salt (default `0`). **Create the agent wallet first, then predict:**

```bash
sailor account predict --owner <owner> --manager <agent-wallet> --json
```

The salt is saved to `.sail/account.json` (`saltNonce`) on deploy. Same owner + manager + salt → same
SMA address on every chain (CREATE2). `predict` reads no keys, spends no gas. If it errors with "depends
on the agent (manager) wallet", generate the wallet first.

## Multi-chain deployment

```bash
sailor account deploy-chain --chain 42161 --json   # BLOCKS for the owner's browser signature
```

Idempotent — records the chain and exits cleanly if code already exists at the predicted address.
Deployed chains accumulate in `account.json` `deployedChains`.

## Gas requirements

- **Owner wallet:** SMA deployment, mandate signing, additional-chain deployment, `mandate deploy`.
- **Agent wallet:** `mandate register`, `mandate revoke`, every dispatch, plus the per-permission
  registration fee (owned by `sailor-mandates`, "Registration fee").

During setup, always ask before anything that costs gas.

## Station 1 exit verifier

`sailor doctor` — read-only preflight: kernel dispatch model, permission health, RPC reachability,
chain-id match, gas balances. **Station 1 is not complete until `doctor` is all green.** `doctor`'s RPC
check tolerates the public fallback, so Station 1 never needs the user's own RPC — `sailor-strategy`
asks for it at the first step that genuinely needs it (token resolution). Then → `sailor-strategy`.

In the sandbox, verify against the sandbox root: `SAIL_DIR=.shipyard/sandbox sailor doctor` (gas funding
on a fork is free).
