---
name: sail-ci
description: Automate the agent on a schedule with GitHub Actions — exporting the encrypted keystore, committing the right files, configuring secrets, and driving the workflow with the gh CLI. Use when the user wants the agent to run on a schedule, in CI, or unattended after sailor run --once has been confirmed working.
---

# Sail CI — GitHub Actions automation

The scaffolded workflow at `.github/workflows/agent-tick.yml` runs `npx sailor run --once` on a cron schedule (default: every Monday 09:00 UTC — edit the `cron` line to the user's cadence; `workflow_dispatch` allows manual runs). It uses `npm ci`, copies `ci-keystore.json` to `.sail/keys/manager.json`, and unlocks it with `SAIL_PASSPHRASE`. `CHAIN_ID` comes from the repository variable `CHAIN_ID` (default `8453`). No private key ever appears in the workflow or in secrets.

Confirm `sailor run --once` works locally before automating.

## 1. Export the keystore

```bash
sailor keys export-ci
```

Copies the encrypted agent wallet to `ci-keystore.json` in the project root and adds a `!ci-keystore.json` allowlist entry to `.gitignore`. The keystore is geth v3 encrypted (scrypt + aes-128-ctr); the raw private key is never exposed — safe to commit.

## 2. Commit the required files

CI needs these non-secret files in the repo:

```bash
npm install                  # generate package-lock.json if it doesn't exist
git add ci-keystore.json package-lock.json .sail/account.json .sail/config.json .sail/mandate.json
git commit -m "chore: add CI keystore and sail state" && git push
```

`package-lock.json` is required by `npm ci`. `.sail/account.json`, `.sail/config.json`, and `.sail/mandate.json` contain only public addresses and flags — no secrets. The `.gitignore` already has `!` exceptions for all of these.

## 3. Add the two repository secrets

GitHub → Settings → Secrets and variables → Actions:

- `SAIL_PASSPHRASE` — the passphrase that encrypts the agent wallet
- `RPC_URL` — the RPC endpoint

(If the chain is not Base, also set the repository **variable** `CHAIN_ID` to the right chain id.)

## 4. Install and authenticate the gh CLI

Required to manage the workflow from the terminal (trigger runs, check logs, add secrets without the browser):

- macOS: `brew install gh`
- Windows: `winget install --id GitHub.cli` or `scoop install gh`
- Linux: https://github.com/cli/cli/blob/trunk/docs/install_linux.md

Authenticate with the `workflow` scope — without it, `gh` cannot trigger or inspect Actions runs:

```bash
gh auth login --scopes workflow
gh auth status                            # confirm workflow scope is listed
```

## 5. Drive it

```bash
gh secret set SAIL_PASSPHRASE             # prompts for the value
gh secret set RPC_URL
gh workflow run agent-tick.yml            # manual trigger
gh run list --workflow agent-tick.yml     # run history
gh run view --log                         # logs of the latest run
```

A failing run's logs show the same stderr the local runner produces (`reverted: <txHash>`, `skipped: no registered permission…`) — debug with the sail-transactions skill.
