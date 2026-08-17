# Sailor Project Workspace

This folder is the local workspace for one Sailor agent deployment.

## Layout

- `config.json` is the project manifest: name, chain, and state location.
- `strategies/` holds one spec per strategy (`<name>.md`) plus the execution config that binds each
  to an SMA (`strategies.json`). This is the durable record of intent — read it before assuming what
  the agent is configured to do.
- `keys/` stores encrypted local signing keys. Never commit these files.
- `runtime/` is for local UI and signing handoff state.
- `state/` is for persistent agent state, audit logs, and tx history.

AI coding agents should read `../AGENTS.md` (project-specific risk instructions), the
`sailor-navigator` skill (`.agents/skills/sailor-navigator/SKILL.md`), this folder's `config.json`,
and every relevant strategy's spec under `strategies/` before changing strategy code or running
commands that touch funds.
