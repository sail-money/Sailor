# Sail Agent — Setup & Operating Guide

You are an AI assistant helping the user set up and run an autonomous on-chain agent
using Sail Protocol. This file is your index. The two phases — **set up** (once) and
**operate** (ongoing) — have their own source-of-truth docs:

| Phase | Source of truth | When |
|-------|-----------------|------|
| **Set up** the account | [`sail/WIZARD.md`](sail/WIZARD.md) | first run, until the agent dispatches its first tx |
| **Operate** the agent | [`AGENT_PLAYBOOK.md`](AGENT_PLAYBOOK.md) + [`docs/PERMISSION_MODEL.md`](docs/PERMISSION_MODEL.md) | every time you act on the SMA |

## On every session start — do this first

Run the following immediately, before anything else:

```
sailor ui status
```

- If it says **not running**, start it automatically:
  ```
  sailor ui start
  ```
  Then tell the user: "I've started the Sail UI. Open http://localhost:3333 in your browser to continue."
- If it says **running**, confirm the URL to the user and proceed.

Then read [`docs/PERMISSION_MODEL.md`](docs/PERMISSION_MODEL.md) once — the conjunctive
vs selective distinction changes how every dispatch is signed and can brick the whole
account if misunderstood.

## Setup (steps 1–8)

Setup is split into two phases: browser (steps 1–4) then terminal (steps 5–8).
[`sail/WIZARD.md`](sail/WIZARD.md) is the detailed, stage-by-stage source of truth;
the summary below is the map.

The local UI at **http://localhost:3333** guides steps 1–4 interactively. When step 4
is complete, it generates a prompt — the user pastes that here to continue.

### Steps 1–4 — in the browser at localhost:3333
1. **Choose networks** — which chains the agent will operate on
2. **Connect owner wallet** — the wallet that controls the account and authorises permissions
3. **Generate agent key** — a separate signing key the agent uses to submit transactions (never holds custody)
4. **Deploy account** — creates the on-chain account (SMA — a smart contract wallet your agent operates within)

### Steps 5–8 — here in the terminal
5. **Set RPC & API keys** — create `.sail/.env.local`:
   ```
   RPC_URL=https://...        # node endpoint for the chosen chain
   SAIL_API_KEY=...           # from api.sail.money
   SAIL_PASSPHRASE=...        # passphrase chosen in step 3 — unlocks the agent key
   ```
6. **Fund the agent key** — send a small amount of ETH to the agent address (shown on the dashboard at localhost:3333) to cover gas
7. **Set permissions** — run `sailor mandate prepare` to draft the permission set, then approve it in the browser at localhost:3333
8. **Run the agent** — `sailor run`

## Know your state — which command shows what

Before acting, ground yourself in the actual state. Each command answers a different
question; all support `--json` for headless reads.

| Question | Command | Reads |
|----------|---------|-------|
| What's my local setup progress (keys, account, mandate, agent run state)? | `sailor status` | local `.sail/` files |
| Who is the **owner** (the user's wallet)? | `sailor owner show` | saved owner (set by `sailor owner connect`) |
| What's the **agent (manager) key address**? | `sailor keys show` | local keystore |
| What Safes does the owner have, and which are Sail SMAs (manager, permissionSigner, session, mandates)? | `sailor scan` | on-chain + Safe service → `.sail/state/context.json` |
| Kernel model + permission health + **RPC reachability + owner/manager gas balances** (read-only, no gas)? | `sailor doctor` | on-chain kernel, permissions, balances |
| What can I actually build on this chain (templates, strategy primitives)? | `sailor capabilities` | bundled deployment registry |
| What's the kernel dispatch model, in code? | `await client.capabilities()` | on-chain `DISPATCH_TYPEHASH` |

**Gas / balances:** `sailor doctor` reports the owner and manager native (ETH) balances,
flags an **unfunded** or **low** manager, and warns if the RPC serves the wrong chain.
The same balances appear on the dashboard at **localhost:3333** (`/api/overview`). Before
`sailor run`, confirm the **manager** address is funded for gas — the manager pays for
every dispatch, so an unfunded manager fails even when permissions are perfect.

## Operating the agent

Once setup is done, [`AGENT_PLAYBOOK.md`](AGENT_PLAYBOOK.md) is the source of truth:
capability detection (always step 0), the act-on-the-SMA decision tree, approval/swap
guidance, and the revert failure-mode catalog. Read it before dispatching anything.

## Interpreting what the user asks for

Users arrive with very different backgrounds. Match the request to what the protocol
can actually do — never invent capabilities. **Run `sailor capabilities` first** to see
the concrete feasibility map (supported chains, kernel model, mandate templates with
their params, strategy primitives, Intelligence API) and ground your answer in it.

- **What's buildable here:** strategies expressed as `client.strategy.swap` (one-off or
  looped for DCA/rebalance) and dispatches gated by registered permissions. New kinds of
  action need a permission: prefer a clone template (`getSailDeployment(chainId).cloneTemplates`,
  no Solidity) or author a Foundry mandate under `mandates/`. Vault/allocation advice can
  come from the Sail Intelligence API (`api.sail.money`). `sailor capabilities` lists all of
  these for the resolved chain.
- **Experienced DeFi user** ("DCA $50 USDC→WETH daily on Base, 0.5% slippage"): translate
  directly into a mandate + strategy with those exact bounds. Confirm each permission line
  in plain English before signing (see WIZARD stage 4).
- **Newcomer with a vague goal** ("earn yield safely"): propose a concrete, buildable
  strategy, query Intelligence for vault options, and explain the trade-offs before any
  gas is spent.
- **Out of scope** (buying NFTs, leveraged shorts, anything not expressible as a permitted
  on-chain call): say so plainly and explain why, rather than scaffolding something that
  will revert. When unsure whether something is buildable, run `sailor capabilities`
  first.

## Key files

| File | What it is |
|------|------------|
| `.sail/config.json` | Chain and contract addresses |
| `.sail/account.json` | Deployed SMA address |
| `.sail/.env.local` | RPC URL, API key, passphrase |
| `.sail/keys/manager.json` | Encrypted agent signing key |
| `.sail/state/context.json` | Last `sailor scan` snapshot (owner, Safes, mandates) |
| `.sail/activity.jsonl` | Log of every agent decision |

## Ground rules
- Complete setup steps in order — each depends on the previous
- **Never execute a transaction without confirming with the user first** (the golden rule)
- Detect the kernel model (`sailor doctor`) before any dispatch
- Keep localhost:3333 running during steps 7 and 8
- `SAIL_PASSPHRASE` in `.env.local` lets the agent sign without user interaction
