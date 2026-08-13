# Local daemon — run on the project machine

(Who it's for / best for: see `sailor-automation`'s comparison table.)

## Setup

Installs a system service that runs `sailor run --once` on a fixed interval. No keystore export or CI variable setup needed — the keys are already on disk in the project environment.

```bash
sailor service install --interval 300   # every 5 min; tune to your strategy
sailor service status                   # check running state
sailor service logs -f                  # tail .sail/agent.log
sailor service stop                     # pause without uninstalling
sailor service uninstall                # remove the service entirely
```

The service is installed as:
- **macOS** — a `launchd` plist in `~/Library/LaunchAgents/`
- **Linux** — a `systemd` user unit
- **Windows** — a Task Scheduler entry

`--project` and `--chain` scope the service to a specific project or chain. `--force` overrides a TCC path error or unresolved passphrase prompt.

## Limitations

- The machine must be powered on and internet-connected when the job fires
- Missed runs are silent — there is no retry
- Not suitable for 24/7 strategies unless the machine is always on

If you want a portable setup that can move to a cloud deployment later, use [Docker](docker-vm.md) instead — same machine, same result, but the image runs anywhere.
