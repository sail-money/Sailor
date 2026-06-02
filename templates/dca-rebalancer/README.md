# DCA Rebalancer — Sail Protocol Agent

This folder is your Sail agent. It DCA-rebalances a token basket on a schedule.

Open this folder in **Claude Code**, **Cursor**, or **Codex** (or any LLM-powered IDE) and say:

> start

Your AI coding assistant will walk you through every step — from network and wallet setup to your
first on-chain tick. See `AGENTS.md` for the details; no manual config needed.

## Project layout

- `.sail/config.json` is the local project manifest.
- `.sail/keys/` stores the encrypted agent wallet and mandate signer keys when local signing is used.
- `.sail/state/` is for persistent agent state, audit logs, and tx history.
