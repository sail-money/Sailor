# Sailor Project Workspace

This folder is the local workspace for one Sailor agent deployment.

## Layout

- `config.json` is the project manifest: name, chain, and state location.
- `keys/` stores encrypted local signing keys. Never commit these files.
- `runtime/` is for local UI and signing handoff state.
- `state/` is for persistent agent state, audit logs, and tx history.

AI coding agents should read this file and `config.json`, plus:
- `../AGENTS.md` — the index (setup + operating + which command shows what state)
- `../sail/WIZARD.md` — step-by-step account setup
- `../AGENT_PLAYBOOK.md` + `../docs/PERMISSION_MODEL.md` — operating the agent (read before any dispatch)

before changing strategy code or running commands that touch funds.
