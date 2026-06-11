---
name: sail-ci
description: Automate a Sailor agent with GitHub Actions — export the encrypted CI keystore, commit the required non-secret state files, configure repository secrets, and trigger or inspect scheduled runs with the gh CLI. Use when the user wants the agent to run on a schedule or headlessly in CI.
---

# CI automation (Stage 4 — GitHub Actions)

Verify locally first: `sailor run --once` must complete a clean tick before automating anything.

1. **Export the CI keystore:**
   ```bash
   sailor keys export-ci
   ```
   Copies the encrypted agent wallet to `ci-keystore.json` in the project root and adds it to `.gitignore` as an allowed file. The keystore is geth v3 encrypted; the raw private key is never exposed.

2. **Commit the required files.** CI needs these non-secret files in the repo:
   ```bash
   npm install                  # generate package-lock.json if it doesn't exist
   git add ci-keystore.json package-lock.json .sail/account.json .sail/config.json .sail/mandate.json
   git commit -m "chore: add CI keystore and sail state" && git push
   ```
   `package-lock.json` is required by `npm ci` in the workflow. The `.sail` files contain only public addresses and flags — no secrets. The `.gitignore` already has `!` exceptions for all of these.

3. **Add two repository secrets** (Settings → Secrets → Actions):
   - `SAIL_PASSPHRASE` — the passphrase that encrypts the agent wallet
   - `RPC_URL` — the RPC endpoint

4. **Install and authenticate the `gh` CLI** — required to manage the workflow from the terminal:
   - macOS: `brew install gh`
   - Windows: `winget install --id GitHub.cli` or `scoop install gh`
   - Linux: https://github.com/cli/cli/blob/trunk/docs/install_linux.md

   The `workflow` scope is required — without it `gh` cannot trigger or inspect Actions runs:
   ```bash
   gh auth login --scopes workflow
   gh auth status                            # confirm workflow scope is listed
   gh workflow run agent-tick.yml            # manual trigger
   gh run list --workflow agent-tick.yml     # check run history
   ```

The scaffolded workflow at `.github/workflows/agent-tick.yml` picks up `ci-keystore.json`, unlocks it with `SAIL_PASSPHRASE`, and runs on the configured schedule. No private key ever appears in the workflow or in secrets.

## Hard rules

- Never commit `SAIL_PASSPHRASE`, `.sail/.env.local`, or anything under `.sail/keys/`.
- Do not put the raw private key in a secret — the encrypted keystore + passphrase is the mechanism.
- A failing scheduled run is a strategy incident, not a CI nuisance: check `gh run list`, read the tick log, and pause the session (`sailor session pause`) if dispatches are failing for permission reasons.
