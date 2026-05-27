# DCA Rebalancer — Sail Protocol Agent

This folder is your Sail agent. It DCA-rebalances a token basket on a schedule.

Open this folder in **Claude Code**, **Cursor**, or **Codex** (or any LLM-powered IDE) and say:

> start

The setup guide in `sail/WIZARD.md` will guide you through every step — from RPC setup to first
on-chain tick. No manual config needed; just follow the prompts.

## Project layout

- `.sail/config.json` is the local project manifest.
- `.sail/keys/` stores encrypted manager and permission-signer keys when local signing is used.
- `.sail/state/` is for persistent agent state, audit logs, and tx history.
