# Sailor Setup Guide

This document is the source of truth for setting up and operating a Sailor agent. You (the LLM tool) walk the user through each stage. Track progress in `.sail/.wizard-state.json`. Never skip stages. Always ask before any action that costs gas or moves funds.

## Stage 0 — Welcome
Greet the user. Confirm their agent's name. Confirm the chain (default: the configured launch chain). Save: agentName, chain to .sail/.wizard-state.json.

## Stage 1 — RPC + Keys
Check `.sail/.env.local` for RPC_URL. If absent, instruct the user to sign up for Alchemy (free tier), create an app for the chosen chain, and paste the URL. Save it to `.sail/.env.local`. Generate the manager (agent) key. Write encrypted to `.sail/keys/manager.json` with a password the user provides. Generate the permissionSigner key. Default to using the same key as the user's owner (their wallet), but offer to separate. The Owner key NEVER leaves the user's wallet. Prompt them to confirm actions via MetaMask or WalletConnect when their signature is needed.

## Stage 2 — Deploy SMA
Explain in plain English what is about to happen: deploy a Safe, register it with the Sail kernel, set the permissionSigner and manager. Call `client.account.create(...)`. Wait for confirmation. Save the Safe address to `.sail/account.json`.

## Stage 3 — Choose strategy
The default is DCA-rebalancer (already scaffolded). Confirm with the user or accept a natural-language description. If they describe a different strategy, generate src/agent.ts and src/mandate.ts accordingly.

## Stage 4 — Review + sign mandate
For each permission in src/mandate.ts, decode the params and explain in plain English. Example: "SharedBoundedSwapPermission — allow swaps on Uniswap V3 only, between USDC and WETH only, max $50 per swap, max 0.5% slippage." User confirms each line. Sign with the permissionSigner key. Submit via `client.mandate.attachBatch`.

## Stage 5 — Dry-run
Build the agent's first tick. Call `client.dispatch.preview(...)` — uses the kernel's previewBatch. If approved, optionally call the Alchemy simulation API to show outcome. Report results to the user.

## Stage 6 — Pick a runner
Option A (Local): user runs `sailor run` on a cron schedule on their machine. Option B (GitHub Actions): walk through pushing the repo to GitHub, adding RPC_URL and the manager key as repo secrets. The workflow file is already in `.github/workflows/agent-tick.yml`.

## Stage 7 — Go
Start the local UI on localhost:3333 (`sailor ui`). Show the user their dashboard. The first scheduled tick fires.
