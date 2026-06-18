# GitHub Actions — cloud-managed runner

**Who this is for:** any user. No infrastructure setup beyond a GitHub account.

**Best for:** daily DCA, slow rebalances, treasury strategies — anything where execution does not need to happen at a precise minute. If your strategy requires guaranteed timing (LP, perps, liquidations), use the [self-hosted runner](self-hosted-runner.md) or [Docker](docker-vm.md) options instead.

---

## How it works

Your repo contains `.github/workflows/agent-tick.yml`. GitHub runs this on a cron schedule using their shared runner pool and via `workflow_dispatch` for on-demand or externally triggered runs.

## Timing limitation

GitHub's cron queue is shared across all users. Under load, scheduled jobs drift 5–30 minutes or are skipped entirely. This is a platform constraint — there is no workaround on GitHub's shared runners.

**Use `workflow_dispatch` as your primary trigger** and treat cron as a heartbeat/backstop. Fire `workflow_dispatch` from an external event (price alert, on-chain event, keeper) via:

```bash
sailor trigger github
```

## Setup

Full setup walkthrough is in the main `sail-automation` skill. Summary:

1. `sailor keys export-ci` — generates `ci-keystore.json` (encrypted; safe to commit)
2. Commit state files and push
3. Set `SAIL_PASSPHRASE` and `RPC_URL` as GitHub Actions secrets
4. The workflow runs on the next cron tick or on `workflow_dispatch`

```bash
gh secret set SAIL_PASSPHRASE
gh secret set RPC_URL
gh workflow run agent-tick.yml    # trigger a manual run to verify
gh run view --log                 # check output
```

## Cron cadence

Edit the `cron:` line in `.github/workflows/agent-tick.yml`:

```yaml
schedule:
  - cron: "0 * * * *"    # hourly (default placeholder — change this)
  # - cron: "*/5 * * * *"  # every 5 min (only reliable with a self-hosted runner)
  # - cron: "0 0 * * *"    # daily
```

For sub-hourly cadence on GitHub's shared runners, the drift makes the schedule unreliable. Use the self-hosted runner option for that.
