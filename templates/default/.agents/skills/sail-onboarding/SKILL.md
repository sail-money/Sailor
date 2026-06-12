---
name: sail-onboarding
description: Walks the agent through setting up a new Sailor project or resuming a partially set-up one — SMA deployment, agent wallet creation, address prediction, and multi-chain deployment. Use when the project has no SMA yet, when .sail/account.json is missing or incomplete, when the user says "start" or "continue", or when deploying the SMA to an additional chain.
---

# Sail onboarding

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

In the browser. Run `sailor ui start`, open the printed URL, connect the owner wallet, choose the network, deploy the SMA, then create the agent wallet — a separate signing key the agent uses to submit transactions. Gas is needed in both: the owner wallet pays for SMA deploy and mandate signing; the agent wallet pays to submit dispatches once running. The owner key never leaves the browser.

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

- Owner wallet: SMA deployment, mandate signing, any additional-chain deployment.
- Agent wallet: every dispatch submission once the agent runs, plus permission registration fees on fee-charging chains.

During setup, always ask before anything that costs gas.
