# Sail Protocol Agent

A blank Sail Protocol agent project. Open this folder in your AI coding assistant and say:

> start

Your assistant will walk you through every step — chain selection, SMA deployment, strategy design, mandate authoring, and automation.

## Project layout

- `src/agent.ts` — your agent's tick loop (implement your strategy here)
- `src/mandate.ts` — your strategy parameters and contract addresses
- `mandates/` — Foundry workspace for your IPermission contracts
- `examples/dca/` — worked reference: DCA (USDC→WETH) on Base via Uniswap V3
- `examples/custom-mandate/` — neutral IPermission authoring scaffold + Foundry test
- `.sail/` — local project state (keys, account, activity log)
