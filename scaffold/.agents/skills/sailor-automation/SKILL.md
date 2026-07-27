---
name: sailor-automation
description: "Run the agent unattended — four options by reliability and infra overhead: (1) GitHub Actions cloud runner (zero infra, cron drifts), (2) self-hosted runner (reliable timing, user-managed machine), (3) Docker image — run locally or on any cloud VM via a registry, (4) local daemon on the project machine (no Docker, simplest). See references/ for each option. Use after sailor run --once works."
---

# sailor-automation — running the agent unattended (Station 5)

Confirm `sailor run --once` works first. Four options; pick by latency, infra comfort, and uptime needs:

| Option | Who it's for | Timing | Infra needed |
|---|---|---|---|
| [GitHub Actions](references/github-actions.md) | Any user, no infra knowledge | Low — cron drifts | None |
| [Self-hosted runner](references/self-hosted-runner.md) | Users who need time-precise execution | High — dedicated runner | Dedicated machine |
| [Docker](references/docker-vm.md) | Users with basic container knowledge | High — persistent process | Docker + any machine |
| [Local daemon](references/local-daemon.md) | Any user, runs on the project machine | Medium — depends on uptime | None |

## Per-strategy schedules (different execution ratios)

Any option above runs `sailor run` — which by default executes **all active** execution strategies each fire. To run strategies at **different cadences**, give each scheduler its own `--strategy <name>` and its own schedule: e.g. one GitHub Action `sailor run --once --strategy Yield` every 5 min, a second `sailor run --once --strategy Rebalance` hourly. Same project, different execution ratios. See [`sailor-operate`'s execution-strategies reference](../sailor-operate/references/execution-strategies.md) for the strategy model and the `sailor strategy …` setup commands.

## Which option fits you?

**1. Do you want to run the agent in the cloud or on a local / dedicated machine?**

→ **Local / dedicated machine**
  The machine must be running 24/7 and connected to the internet — missed runs are silent.
  Two options (no further questions needed):

  - **[Local daemon](references/local-daemon.md)** — `sailor service install`. Simplest option: no extra tools, no extra steps. Runs directly in the project environment on the same machine.

  - **[Docker](references/docker-vm.md)** — build the image and run it as a container on any machine that has Docker installed. Good if you want a portable setup or plan to move to a cloud deployment later — same image, no code changes.

→ **Cloud**
  Three options depending on timing requirements:

  - **[GitHub Actions](references/github-actions.md)** — zero additional setup. Simplest cloud path. Execution timing is not guaranteed: cron drifts on GitHub's shared runners. Fine for daily DCA, hourly rebalances, treasury strategies.

  - **Timing-sensitive (LP, liquidations, perps)?** Two options:

    - **[Self-hosted runner](references/self-hosted-runner.md)** — install GitHub's runner on a machine you control (physical or cloud VM). Same workflow file as GitHub Actions, one line change. The runner picks up jobs immediately with no shared queue.

    - **[Docker on a cloud VM](references/docker-vm.md)** — provision a VM on any provider, build the image locally, push to a registry, pull and run on the VM. Works with AWS, GCP, Azure, Oracle, Fly.io, and any other provider.

## Cadence

Match the interval to volatility: **LP / perp → minutes; DCA / rebalance → daily; treasury → hourly–daily.** GitHub Actions cron drifts (see above) — for LP/perp cadence, use the self-hosted runner or local execution options instead.

## Keys & trust

Cloud options commit only the **encrypted** keystore (`ci-keystore.json`); `SAIL_PASSPHRASE` is a secret, never committed. Local options (daemon, Docker) use keys already on disk — no export needed.

Regardless of host, the on-chain **mandate is the backstop** — it bounds the manager's permissions no matter where or how the agent runs.

A failing run's logs show the same stderr as the local runner (`reverted: <txHash>`, `skipped: no registered permission…`) — debug with the sailor-transactions skill.

## Once it's running

This skill covers **launch**. Everything after — reading activity, tuning bounds, pausing, revoking, and exiting funds to the owner — lives in [`sailor-operate`](../sailor-operate/SKILL.md).
