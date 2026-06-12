---
name: sail-onboarding
description: Set up a Sail SMA project or resume a half-finished setup — deploy the SMA, create the agent wallet, choose the chain and RPC, and extend the account to additional chains. Use when the user says start or continue, when .sail/account.json is missing, or when deploying the SMA on another chain.
---

# Sailor onboarding (Stage 1)

## Running the CLI

The project does not install `sailor` as a dependency, so invoke it with **`npx sailor <command>`** unless it is installed globally (`npm i -g @sail.money/sailor`, then `sailor` works bare). Every `sailor …` command in these skills assumes one of those. Confirm the toolchain up front and pin a recent version — `npx sailor@latest --version` — because an old cached `npx` build can be missing newer commands (e.g. `mandate simulate`); if a documented command reports "unknown command", you are on a stale version, not hitting a missing feature.

## Resume from state, never from memory

Read `.sail/` first (file map in AGENTS.md):

- No `.sail/account.json` → run Stage 1 below.
- `account.json` exists but `.sail/mandate.json` is missing → Stage 1 is done; go to the `sail-mandates` skill.
- Both exist → the agent is ready to run; see `sail-transactions` (running) or `sail-ci` (automation).

`sailor status` prints this summary in one screen.

## Stage 1 — deploy the SMA and create the agent wallet

Browser-driven; the owner key never leaves the browser.

1. Start the dashboard: `sailor ui start`, then open the printed URL (localhost:3333). Server lifecycle and health: `sail-servers` skill.
2. The user connects their **owner wallet** in the browser and chooses the network. `sailor chains` lists supported chains (`--verify` probes configured RPCs).
3. Create the **agent wallet**: `sailor keys generate` — an encrypted keystore at `.sail/keys/manager.json` protected by a passphrase the user chooses. **Both wallets need gas, and the split is not what it looks like:** the owner *signs* (SMA deployment, mandate authorization) but the **agent wallet submits and pays for every on-chain transaction** — including `mandate deploy` and `mandate attach` during setup, not just dispatches once running. Fund the agent wallet before Stage 3 or attach fails with `gas required exceeds allowance`. The owner wallet needs gas only for transactions it submits directly in the browser (the SMA deployment).
4. **Predict before paying.** Every SMA deployment uses a CREATE2 salt (CLI default: `0`). The kernel binds the salt to the owner wallet, agent (manager) wallet, and fee policy — so create the agent wallet first, then:
   ```bash
   sailor account predict --owner <owner-wallet> --manager <agent-wallet>
   ```
   The salt is saved in `.sail/account.json` automatically. All supported chains share the same protocol addresses via CREATE2, so the same owner, manager, and salt produce the **same SMA address on every chain**.
5. Deploy the SMA in the browser. The owner approves the deployment in the signing UI. (`sailor onboard` runs a guided CLI version of this flow.)

If a terminal flow needs the owner's wallet without the full dashboard, `sailor owner connect` opens the signing station, waits for the wallet, and saves it as the project owner; `sailor owner show` prints it later.

## Chain and RPC configuration

`.sail/config.json` ships with `chainId: null` — write the user's choice there once made. The RPC endpoint goes in `.sail/.env.local` (never committed), in either pattern:

```
# Option A — single active chain
RPC_URL=https://your-endpoint
CHAIN_ID=8453

# Option B — per-chain vars (multi-chain projects)
CHAIN_ID=8453
BASE_RPC_URL=https://your-base-endpoint
ARBITRUM_RPC_URL=https://your-arbitrum-endpoint
```

**Per-chain var names are fixed — the CLI reads only these exact names; any other name (e.g. `BASE_MAINNET_RPC_URL`) is silently ignored:**

| Chain | Var |
|---|---|
| Ethereum (1) | `ETH_MAINNET_RPC_URL` |
| Base (8453) | `BASE_RPC_URL` |
| Arbitrum (42161) | `ARBITRUM_RPC_URL` |
| Unichain (130) | `UNICHAIN_RPC_URL` |
| Base Sepolia (84532) | `BASE_SEPOLIA_RPC_URL` |
| Sepolia (11155111) | `SEPOLIA_RPC_URL` |

`sailor chains` prints the canonical name for each supported chain (the source of truth, in case the set grows). Resolution order: chain-specific var in `.env.local` → generic `RPC_URL` in `.env.local` → chain-specific shell var → generic shell var. Per-chain vars always win for their chain.

## Multi-chain deployment

Once the SMA is live on one chain, deploy it at the same address elsewhere:

```bash
sailor account predict                      # confirm the address matches first
sailor account deploy-chain --chain 42161   # owner approves in the browser
```

No new salt or agent wallet is needed.

## Verify before moving on

`sailor doctor` — read-only preflight: kernel dispatch model, permission health, RPC reachability, gas balances in both wallets. Do not proceed to Stage 3 with a failing doctor.
