# Self-hosted runner — reliable timing on a dedicated machine

(Who it's for / best for: see [`sailor-automation`](../SKILL.md)'s comparison table.) A self-hosted
runner polls GitHub directly — it picks up jobs immediately, with no shared queue and no drift.

## How it works

Same `agent-tick.yml` workflow as the GitHub Actions option. One change: `runs-on: ubuntu-latest` becomes `runs-on: [self-hosted, linux]`. The job then runs on your machine instead of GitHub's shared pool.

## Prerequisites

- A machine that is **always powered on** and **always connected to the internet**
- Do not use your personal computer — missed runs happen silently whenever it sleeps, restarts, or loses connectivity
- Recommended hardware: Raspberry Pi 4+, a dedicated mini PC (NUC, Intel BRIX, etc.), or a cloud VM on any provider

## Setup

### 1. Register the runner on GitHub

Go to your repo: **Settings → Actions → Runners → New self-hosted runner**

Follow the official GitHub guide for your OS:
https://docs.github.com/es/actions/how-tos/manage-runners/self-hosted-runners/add-runners

The guide walks you through downloading the runner application, configuring it, and starting it as a service so it restarts automatically on reboot.

### 2. Update the workflow

In your local copy of `.github/workflows/agent-tick.yml`, change:

```yaml
jobs:
  tick:
    runs-on: ubuntu-latest      # ← change this
```

to:

```yaml
jobs:
  tick:
    runs-on: [self-hosted, linux]   # ← your runner label
```

Commit and push. The next run will be picked up by your runner.

### 3. Verify

```bash
gh run list --workflow agent-tick.yml   # confirm runs show "self-hosted" runner
gh run view --log                        # check for errors
```

## Machine options

| Machine | Cost | Notes |
|---|---|---|
| Raspberry Pi 4 (2 GB+) | ~$45 one-time | Runs 24/7 on ~3W; plug into router via ethernet |
| Mini PC (NUC, BRIX) | ~$100–200 | More headroom; good if you run other services too |
| Cloud VM (Oracle Always Free) | Free | 2 AMD VMs permanently free; requires basic Linux knowledge |
| Cloud VM (any provider) | ~$4–10/month | AWS t3.micro, GCP e2-micro, Hetzner CX11, etc. |

## Your responsibility

Sail does not manage this machine. You are responsible for:
- OS updates and security patches
- Restarting the runner service if it stops (configure it to start on boot during setup)
- Monitoring that runs are completing as expected
