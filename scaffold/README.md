# Sail Protocol Agent

A blank Sail Protocol agent project. Open this folder in your AI coding assistant and say:

> start

Your assistant will walk you through the five stations — **ARRIVE** (project, keys, account, chain) → **STRATEGY** (define what the agent does) → **MANDATE** (the onchain bounds it runs inside) → **AGENT** (the tick loop) → **SAIL** (launch, operate, exit). `AGENTS.md` is the map: each station's owning skill, entry gate, and exit check.

## Project layout

- `src/agent.ts` — your agent's tick loop (implement your strategy here)
- `src/mandate.ts` — your strategy parameters and contract addresses
- `mandates/` — Foundry workspace for your IPermission contracts
- `contracts/` — neutral IPermission authoring scaffold + Foundry test
- `.sail/` — local project state (keys, account, activity log)

The canonical agent-loop skeleton lives in the `sailor-agent-build` skill (`.agents/skills/sailor-agent-build/SKILL.md`) — adapt it into `src/agent.ts`.
