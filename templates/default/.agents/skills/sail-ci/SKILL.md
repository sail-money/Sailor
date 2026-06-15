---
name: sail-ci
description: Run the agent unattended — cloud (GitHub Actions cron + workflow_dispatch), a local OS service (sailor service install), or on-demand via the trigger seam (sailor trigger github) — with cadence guidance and the committed-keystore trust model. Use after sailor run --once works.
---

# Sail CI — automating the agent

Confirm `sailor run --once` works first. Three hosts run the same loop; pick by latency, privacy, and ops:

- **Cloud** — GitHub Actions cron + `workflow_dispatch`. Zero infra; cron drifts (see Cadence).
- **Local daemon** — `sailor service install`. Private, no committed keys, lower latency, no GitHub — you run the host.
- **Event-driven** — an external system fires a run via the trigger seam (a keeper/watcher on a price move or deposit). The direction, not yet built; today the seam is `sailor trigger github`.

## Cadence

Match the interval to volatility: **LP / perp → minutes; DCA / rebalance → daily; treasury → hourly–daily.** Actions cron is a *heartbeat/backstop* that drifts and skips under load — not low-latency; for that, use an external trigger or the local daemon.

## Cloud: GitHub Actions

`.github/workflows/agent-tick.yml` runs `npx sailor run --once` on cron (default hourly `0 * * * *`, a generic placeholder — tune `cron` to your strategy per Cadence above; `workflow_dispatch` enables manual/external runs), via `npm ci`. `CHAIN_ID` comes from the repo variable (default `8453`).

1. **Export** — `sailor keys export-ci` writes the geth-v3 encrypted `ci-keystore.json` (raw key never exposed) and allowlists it in `.gitignore`.
2. **Commit** the non-secret files (`npm install` first for the lockfile):

```bash
git add ci-keystore.json package-lock.json .sail/account.json .sail/config.json .sail/mandate.json
git commit -m "chore: add CI keystore and sail state" && git push
```

3. **Secrets** (Settings → Secrets and variables → Actions): `SAIL_PASSPHRASE`, `RPC_URL`. If not Base, set the repo **variable** `CHAIN_ID`.
4. **Drive with `gh`** (needs the `workflow` scope — `gh auth login --scopes workflow`):

```bash
gh secret set SAIL_PASSPHRASE && gh secret set RPC_URL
gh workflow run agent-tick.yml          # manual run
gh run list --workflow agent-tick.yml   # history
gh run view --log                       # latest logs
```

## On-demand / external trigger

```bash
sailor trigger github                   # fire workflow_dispatch — the same job cron runs
#   --reason <text>  --ref <branch>  --workflow <file>  --repo <owner/repo>  --json
```

Wakes the agent between cron ticks — the seam keepers, watchers, or your backend call.

## Local daemon

```bash
sailor service install --interval 300   # launchd/systemd/Task Scheduler; restarts on crash
sailor service status | stop | uninstall
sailor service logs -f                  # .sail/agent.log
```

`--project`/`--chain` scope it; `--force` overrides a TCC path or unresolved passphrase.

## Keys & trust

Cloud commits only the **encrypted** keystore; `SAIL_PASSPHRASE` is a secret, never committed (the same value the dashboard stores locally at `0600`). Whoever triggers or submits, the on-chain **mandate is the backstop**, bounding the manager regardless of host — choose cloud vs local with that in mind.

A failing run's logs show the same stderr as the local runner (`reverted: <txHash>`, `skipped: no registered permission…`) — debug with the sail-transactions skill.
