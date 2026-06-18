---
name: sail-onboarding
description: Walks the agent through setting up a new Sailor project or resuming a partially set-up one — SMA deployment, agent wallet creation, address prediction, and multi-chain deployment. Use when the project has no SMA yet, when .sail/account.json is missing or incomplete, when the user says "start" or "continue", or when deploying the SMA to an additional chain.
---

# Sail onboarding

## Running the CLI

The published package is **`@sail.money/sailor`** — always use the scoped name with the registry. The bare name `sailor` is a different, unrelated npm package; never `npx sailor@<version>` or `npm i sailor`. Install it (`npm i -g @sail.money/sailor`, or as a project dep), after which the `sailor` bin works bare (`sailor <command>`) and `npx sailor <command>` resolves the installed bin. Every `sailor …` command in these skills assumes it is installed. Confirm the toolchain up front and pin a recent version — `npx @sail.money/sailor@latest --version` — because an old cached `npx` build can be missing newer commands (e.g. `mandate simulate`); if a documented command reports "unknown command", you are on a stale version, not hitting a missing feature.

After upgrading the CLI, run `sailor update` from the project root to pull in updated skills, `AGENTS.md`, `Dockerfile`, and other tooling files. User files (`src/`, `mandates/`, `.sail/`, `package.json`) are never touched.

Stage machine keyed off `.sail/`. Read the state, enter at the right stage, never re-run completed stages.

## Determine where the user is

| `.sail/` state | Stage |
|---|---|
| `config.json` has `chainId: null` | Stage 0 — chain not chosen; ask which chain, write it to `config.json` |
| No `account.json` | Stage 1 — SMA not deployed |
| `account.json` exists, `state/mandates.json` empty or absent | SMA live, no permissions — hand off to **sail-mandates** |
| `account.json` + tracked mandates | Fully onboarded — hand off to **sail-transactions** / running |

Supported chains: Ethereum (1), Base (8453), Arbitrum (42161), Unichain (130), Base Sepolia (84532), Eth Sepolia (11155111). `sailor chains --json` lists them with kernel addresses.

## Stage 1 — Deploy the SMA and create the agent wallet

In the browser. Run `sailor ui start`, open the printed URL, connect the owner wallet, choose the network, deploy the SMA, then create the agent wallet — a separate signing key the agent uses to submit transactions. **Both wallets need gas, and the split is not what it looks like:** the owner *signs* (SMA deployment, mandate authorization) but the **agent wallet submits and pays for every on-chain transaction** — including `mandate deploy` and `mandate attach` during setup, not just dispatches once running. Fund the agent wallet before Stage 3 or attach fails with `gas required exceeds allowance`. The owner wallet needs gas only for transactions it submits directly in the browser (the SMA deployment). The owner key never leaves the browser.

Headless alternative (the agent drives, the owner only signs in the browser):

```bash
sailor keys generate                 # create the agent wallet (interactive: role + passphrase)
sailor station start --json &        # signing daemon — BLOCKS; run in background
sailor owner connect --json          # BLOCKS up to 300s waiting for a wallet to connect in the browser
sailor scan --json                   # discover the owner's Safes and state
sailor onboard --new-sma --json      # deploy SMA — BLOCKS waiting for the owner's browser signature
```

`onboard --new-sma` pushes a `create-sma` signing request to the browser, waits for the owner to approve (default timeout 10 minutes), then persists the SMA to `.sail/account.json`. Tell the user: "approve the request in the signing station in your browser."

## Deterministic address (salt)

Every SMA deployment uses a CREATE2 salt (default `0`). The kernel binds the salt to the owner, the agent (manager) wallet, and the fee policy — so **create the agent wallet first, then predict**:

```bash
sailor account predict --owner <owner> --manager <agent-wallet> --json
```

The salt is saved to `.sail/account.json` (`saltNonce`) automatically on deploy. All supported chains share the same protocol addresses via CREATE2, so the same owner, manager, and salt produce the same SMA address on every chain. `predict` reads no keys and spends no gas. Use `--salt <n>` for a non-default salt, `--chain <id>` for one chain only.

If `predict` errors with "depends on the agent (manager) wallet", the agent wallet does not exist yet — generate it first.

## Multi-chain deployment

Once the SMA is live on one chain, deploy it at the same address on another supported chain:

```bash
sailor account predict --json                  # confirm the address matches first
sailor account deploy-chain --chain 42161 --json   # BLOCKS waiting for the owner's browser signature
```

The owner approves in the browser (switch the wallet to the target chain before signing); no new salt or agent wallet is needed. The command is idempotent — if the SMA already has code at the predicted address on the target chain it records the chain and exits cleanly. Deployed chains accumulate in `account.json` `deployedChains`.

If `deploy-chain` refuses with an address mismatch, the SMA was deployed against the old per-chain contracts (pre-CREATE2) and cannot be reproduced cross-chain — the fix it prints is to deploy a fresh SMA with `sailor onboard --new-sma`.

## Gas requirements

- Owner wallet: SMA deployment, mandate signing (EIP-712), any additional-chain deployment.
- Agent wallet: `mandate deploy`, `mandate attach`, `mandate revoke`, and every dispatch submission once the agent runs, plus permission registration fees on fee-charging chains.

`sailor doctor` — read-only preflight: kernel dispatch model, permission health, RPC reachability, gas balances in both wallets. Do not proceed to Stage 3 with a failing doctor.

During setup, always ask before anything that costs gas.
