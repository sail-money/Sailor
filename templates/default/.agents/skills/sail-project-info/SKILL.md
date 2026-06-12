---
name: sail-project-info
description: Fetch the current state of a Sailor project — keys, SMA deployment, registered permissions, kernel capabilities, supported chains, RPC health, and gas balances. Use when answering what is deployed or healthy, before any gas-spending action, or when discovering an owner's existing SMAs.
---

# Project information

Every command below supports `--json` — prefer it when you will parse the output. All are read-only; none cost gas or require the owner.

| Command | Answers |
|---|---|
| `sailor status` | One-screen summary: keys, SMA deployment, signed mandate, agent run state |
| `sailor doctor` | Preflight: kernel dispatch model, permission health (including the conjunctive pass-through probe), RPC reachability, gas balances |
| `sailor capabilities` | Feasibility map: supported chains, kernel model, available mandate templates, strategy primitives |
| `sailor chains` | Supported chains and kernel addresses; `--verify` probes every configured RPC |
| `sailor scan [--owner <addr>]` | Discovers the owner's SMAs, permissions, and local keys; writes `.sail/state/context.json` |
| `sailor owner show` | The saved project owner address |
| `sailor keys show` | Address of each stored local key |
| `sailor mandate list` | Permission contracts deployed from this project |
| `sailor mandate templates` | Authorization templates and community-deployed clone addresses |
| `sailor account predict` | Deterministic SMA address for owner + manager + salt — check before spending gas |
| `sailor ui status` / `sailor station status` | Server health — see the `sail-servers` skill |

## Picking the right source

- Prefer the CLI over hand-parsing `.sail/` files — the commands merge local state with on-chain reality; the raw files only record what this project did locally.
- Run `sailor doctor` before anything that costs gas.
- Run `sailor scan` when the project folder may be out of sync with the chain (for example, an SMA created from another machine or project).
- Dispatch-model questions (selective vs conjunctive): `sailor doctor` reads the on-chain `DISPATCH_TYPEHASH`; background in `docs/PERMISSION_MODEL.md`. Never assume the model from a version string or chain name.
