# CLI reference

The full `sailor` command surface, grouped by workflow. Every command supports `--help`; most
support `--json` for machine-readable output. The doc-drift gate (`pnpm run docs:check`) verifies
each command named here exists in the CLI source.

## Project setup

| Command | What it does |
|---|---|
| `sailor init [dir]` | Scaffold a new agent project (`--template <name>`, `--chain <id>`, `--rpc-url <url>`, `--force` to re-init) |
| `sailor update` | Re-sync agent tooling files (skills, `soul.md`, `Dockerfile`) from the latest template — user code and state untouched |

## Blueprints

| Command | What it does |
|---|---|
| `sailor blueprint start <artifact> <dir>` | Create a fresh project, verify/import the artifact, install dependencies, typecheck, and launch blueprint-specific onboarding (`--chain <id>`, `--yes`, `--agent <executable>`, `--no-agent`) |
| `sailor blueprint verify <artifact>` | Verify manifest shape, content hashes, digest, and declared compatibility (`--chain <id>`, `--json`) |
| `sailor blueprint inspect <artifact>` | Show the artifact contents, surface changes, compatibility, and provenance claims without verifying it |
| `sailor blueprint import <artifact> [dir]` | Verify and apply a blueprint to an existing Sailor scaffold (`--chain <id>`, `--dry-run`, `--yes`) |

Blueprint verification proves integrity, not publisher identity. `start` consumes a local artifact
and has no dependency on the tool that produced it.

## Keys and owner

| Command | What it does |
|---|---|
| `sailor keys generate` | Generate + encrypt a key (`--type agent-wallet` or `mandate-signer`; `--passphrase`, else `SAIL_PASSPHRASE`, else prompt; `--force` to overwrite) |
| `sailor keys show` | Addresses of stored keys |
| `sailor keys export-ci` | Export key material for CI use |
| `sailor owner connect` | Open the signing page, wait for your wallet, save it as owner (`--timeout <seconds>`) |
| `sailor owner show` | Show the saved project owner |

## SMA lifecycle

| Command | What it does |
|---|---|
| `sailor account predict` | Deterministic SMA address before deploying (`--owner`, `--manager`, `--salt`, `--chain`, `--json`) |
| `sailor onboard` | Set up an SMA end to end (`--new-sma` to create, `--sma <address>` to reuse, `--template <kindOrAddress>` to register a permission, `--skip-mandate`, `--salt <n>`) |
| `sailor account deploy-chain` | Deploy the same SMA address on an additional chain (same owner/manager/salt) |
| `sailor account rotate-signer` | Rotate the delegated agent wallet and re-approve mandates (`--to`, `--generate`, `--skip-reattach`, `--reattach-only`, `--list`, `--sma`) |
| `sailor scan` | Discover the owner's SMAs, permissions, and local keys (`--owner <address>`) |
| `sailor status` | Current account, permission, and session status |

## Mandate lifecycle

| Command | What it does |
|---|---|
| `sailor mandate templates` | How to author your own permission + any community-deployed addresses |
| `sailor mandate deploy` | Deploy a Foundry-compiled permission via the signing UI (`--contract <Name>` or `--artifact <path>`, `--args <json>` / `--args-file`, `--build`, `--register --sma <address>`) |
| `sailor mandate register` | Register already-deployed permission(s) on an SMA — comma-separated list = one signature (`--label`) |
| `sailor mandate configure` | Configure a shared template's per-account bounds (`--template <name> --args-file <path>` or `--params <hex>`; `--simulate-only` for a gas-free preflight; `--force`) |
| `sailor mandate simulate` | Probe a permission's `evaluate()` off-chain — no gas, no signing (inline `--target/--calldata/--value/--expect/--label`, or `--calls <file>` for a batch) |
| `sailor mandate sign` | Review and confirm the permissions authorized for your SMA (`--yes` for CI) |
| `sailor mandate prepare` | Prepare a mandate draft for review/signing in the UI |
| `sailor mandate revoke` | Revoke permission(s) — owner-authorized (`--address <permissionOrName>` or `--all`) |
| `sailor mandate list` | Permissions deployed from this project |
| `sailor mandate update` | Update tracked-permission metadata (`--name`, `--source-path`, `--artifact-path`) |
| `sailor mandate deploy-clone` | Deploy + register a standalone clone permission from a published template — use `mandate deploy` today; `deploy-clone` requires clone templates and none are deployed yet |

> **Change a mandate's bounds** (new cap/allowlist) with `sailor mandate configure --force` — re-encode the blob on the same registered singleton, no re-register. `sailor mandate update` changes only *tracked metadata* (name, source/artifact paths), never bounds.

## Signing server

| Command | What it does |
|---|---|
| `sailor signer start` | Start the persistent browser-signing daemon (blocks — run in the background) |
| `sailor signer status` / `stop` | Inspect / stop it |

(`sailor station …` is a hidden, deprecated alias of `signer` kept for v1.2.0 compatibility.)

## Run and automate

| Command | What it does |
|---|---|
| `sailor run` | The agent execution loop (`--once` for a single tick, `--chain <id>`, `--reason <text>`) |
| `sailor service install` | Install the agent as an OS service that restarts on crash — launchd / systemd / Task Scheduler (`--interval <s>`, `--project <path>`, `--chain <id>`, `--force`) |
| `sailor service status` / `stop` / `uninstall` / `logs` | Manage the installed service |
| `sailor trigger github` | Fire the scaffold's GitHub Actions agent workflow on demand (`--workflow`, `--ref`, `--reason`, `--repo`) |
| `sailor session pause` / `resume` | Instantly revoke / restore the agent's dispatch rights — Safe custody untouched |

## Dashboard

| Command | What it does |
|---|---|
| `sailor ui start` | Local dashboard (per-project port in 3333–3999; `--expose tailscale` serves it HTTPS on your tailnet — never public) |
| `sailor ui stop` / `status` | Stop / inspect it |

## Shipyard (simulation sandbox)

Local forks of the real chains, with fake money, on a second dashboard of their own. Requires
Foundry (`anvil`). Full guide: [shipyard.md](./shipyard.md).

| Command | What it does |
|---|---|
| `sailor sandbox start` | Start the Shipyard dashboard on its own port, rooted at `.shipyard/sandbox/` (bare `sailor sandbox` does the same) |
| `sailor sandbox stop` | Stop the dashboard and its forks, saving chain state so the next start resumes the same world (`--keep-forks` stops only the dashboard) |
| `sailor sandbox status` | Show whether the Shipyard dashboard is running |

(`sailor shipyard …` is an alias of `sandbox`, so either spelling works.)

## Diagnostics

| Command | What it does |
|---|---|
| `sailor doctor` | Kernel health, dispatch model, RPC reachability, gas balances (`--account <address>`) |
| `sailor capabilities` | What you can build on this chain — read-only, no gas |
| `sailor chains` | Supported chains + kernel addresses (`--verify` checks each via `eth_getCode`) |

---

Feedback: missing flag or wrong description? [Open an issue](https://github.com/sail-money/Sailor/issues).
