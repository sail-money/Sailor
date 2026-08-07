# Sailor Project Workspace

This folder is the local workspace for one Sailor agent deployment.

## Layout

- `config.json` is the project manifest: name, chain, and state location.
- `keys/` stores encrypted local signing keys. Never commit these files.
- `runtime/` is for local UI and signing handoff state.
- `state/` is for persistent agent state, audit logs, and tx history.

AI coding agents should read the `sailor-navigator` skill (`.agents/skills/sailor-navigator/SKILL.md`) and this folder's `config.json`
before changing strategy code or running commands that touch funds.
