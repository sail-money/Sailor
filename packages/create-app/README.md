# create-sailor-agent

Scaffold a Sail Protocol SMA agent from inside your coding agent.

## Usage

Open your AI coding assistant (Claude Code, Cursor, Codex, Windsurf, or any tool
with an integrated terminal). In the terminal:

```sh
npx create-sailor-agent my-agent
```

Then say: **"start"**

That's it. Your assistant reads the project guide and walks you through deploying
your SMA, writing your mandate, and running your first strategy.

## What gets scaffolded

- A DCA-rebalancer starter strategy (`src/agent.ts`)
- A Foundry workspace for authoring permission contracts (`mandates/`)
- A GitHub Actions automation workflow (`.github/workflows/agent-tick.yml`)
- The operator guide your coding assistant uses (`AGENTS.md`)
- Project config and workspace (`.sail/`)

## How it works

Sail Protocol gives your agent a mandate it must execute within — and can never exceed.
Your capital stays in your SMA (a Safe you own). The agent signs every transaction,
but the kernel checks it against your mandate first. Anything outside the lines reverts.
You can revoke the agent in one block.

[Sail Protocol](https://sail.money) · [Sailor on GitHub](https://github.com/SailAgent/Sailor)
