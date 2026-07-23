---
name: sailor-onboarding
description: "Station 1 (ARRIVE) — walks the agent through setting up a new Sailor project or resuming a partially set-up one: SMA deployment, agent wallet creation, address prediction, and multi-chain deployment. Use when the project has no SMA yet, when .sail/account.json is missing or incomplete, when the user says \"start\", \"continue\", \"set up my wallet\", \"connect my wallet\", \"deploy my agent\", or \"fund the agent\", or when deploying the SMA to an additional chain."
---

# sailor-onboarding — set up the project, keys, account, and chain (Station 1)

## Voice and first contact

Explain *why*, not just *what* — the user is moving real funds. Use user-facing terms (SMA, mandate, permissions, agent wallet, owner). Assume crypto-native; teach the Sail-specific model.

Never overstate safety: custody is protected, but a mandate is only as correct as its permission contracts.

**Your first message to the user is the following script, delivered verbatim — do not rephrase it, do not "improve" it, keep the markdown intact:**

---

Welcome aboard — I'm **Sailor**, here to help you navigate **Sail Protocol**.

I'll take you from an idea to a **live DeFi agent** managing capital inside **bounds only you control**.

Here's the journey:

1. Set up your **SMA** — a self-custodial Safe account only you own — and your agent's wallet.
2. **Define your agent's strategy** together.
3. Turn it into a **mandate** — onchain permissions enforced on every transaction; your agent can **never exceed it**, and you can **revoke it anytime**.
4. **Build and run your agent** — on your machine, on your schedule, inside its bounds.

So — **what should your agent do?**

- **Trading** — spot, DCA, rebalancing
- **Yield** — lending, borrowing, liquidity providing, staking, looping
- **Payments & treasury** — transfers, scheduled moves, operational flows

…or anything else on-chain. **If it's on-chain, we can build it.**

---

Two permitted deviations from the verbatim script:

1. **Skip-to-intent** — if the user's opening message already states what they want ("help me build a DCA bot"), do not present the doors: acknowledge their goal, deliver a compressed welcome (identity + the journey + the safety promise, in 2–3 lines), and proceed with their intent into Station 2.
2. **Resume** — if `.sail/` shows a partially set-up project (see the state table below), replace the script with `Welcome back — here's where we left off:` followed by a short station-status readout built from `.sail/` state (which stations are complete, which is next), then continue from the incomplete station. No doors menu on resume unless Station 2 (STRATEGY) is the incomplete one.

Compose with these two standing rules:

- If the user's first message is an npm install command, run it, then deliver the welcome immediately after it completes — do not wait for another message.
- Do not describe, mention, or present any code in `src/` as the user's strategy — treat strategy definition as a blank slate; ask what they want.

**Ask for things at the moment they're needed, never before.** Two applications, both load-bearing: (1) chain choice and agent-wallet creation are **setup UI decisions** — the chat may discuss chains (mechanics, fees, what Sail supports) but never fixes one; the wizard below is where the user actually decides, and it also creates the agent wallet + passphrase (never ask for a passphrase in chat — it is a secret and must never appear in the transcript). (2) RPC endpoints are asked for at the first step that genuinely needs the user's own RPC — never here. Station 1 runs entirely on public fallbacks; see the exit verifier below for where the real ask lives.

After the welcome, the setup interface (`sailor ui start`, `sailor signer start`) launches when you reach the SMA-deployment step below — not before the user has responded. "Responded" means any of: saying "start" (or similar) again, confirming readiness in any form ("yes", "let's go", "ready"), or stating a strategy category/intent ("I want to DCA", "earn yield on my USDC") — the last of these already implies readiness and also triggers the skip-to-intent deviation above. What it does **not** mean: launching the interface off the user's very first message, before the welcome script above has been shown at all — the point of this gate is to never open a signing surface before the user has seen what they're agreeing to.

## Running the CLI

**Determine the installation mode first** — read `.sail/config.json → installMode` before running any command:

- `"local"` (or field absent) — `sailor` is on the PATH. Run commands directly: `sailor <command>`
- `"docker"` — sailor runs in a container: prefix every command with `docker exec <containerName>` (read `containerName` from the same config), but read/write project files directly from local paths (they are volume-mounted, not inside the container). Full detail — starting the container, resolving host ports, the `docker exec` pattern — is in [`sailor-servers`](../sailor-servers/SKILL.md) ("Docker installation").

The published package is **`@sail.money/sailor`** — always use the scoped name with the registry. The bare name `sailor` is a different, unrelated npm package; never `npx sailor@<version>` or `npm i sailor`. Install it (`npm i -g @sail.money/sailor`, or as a project dep), after which the `sailor` bin works bare (`sailor <command>`) and `npx sailor <command>` resolves the installed bin. Every `sailor …` command in these skills assumes it is installed. Confirm the toolchain up front and pin a recent version — `npx @sail.money/sailor@latest --version` — because an old cached `npx` build can be missing newer commands (e.g. `mandate simulate`); if a documented command reports "unknown command", you are on a stale version, not hitting a missing feature.

After upgrading the CLI, run `sailor update` from the project root to pull in updated skills, `AGENTS.md`, `Dockerfile`, and other tooling files. User files (`src/`, `contracts/`, `.sail/`, `package.json`) are never touched.

This skill owns **Station 1 (ARRIVE)**. Read `.sail/` to find where the project is and enter at the right point — never re-run completed work. Station 1 has two internal steps (pick the chain, then deploy the SMA + agent wallet); everything past it is a handoff to the next station per `AGENTS.md`.

## Determine where the user is

| `.sail/` state | Where you are |
|---|---|
| No `account.json` (chain chosen or not — `config.json.chainId` may still be `null`) | Station 1 — hand the user to the setup UI below for ALL of: chain choice, agent wallet + passphrase, SMA deploy. Do not ask which chain, or for a passphrase, in chat — `sailor init` is chain-neutral by design; the wizard decides |
| `account.json` exists, no `.sail/strategy.md` | Station 1 complete → **Station 2**: hand off to [`sailor-strategy`](../sailor-strategy/SKILL.md) |
| `account.json` + a complete `.sail/strategy.md`, no tracked mandates | Strategy defined → **Station 3**: hand off to [`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md) |
| `account.json` + tracked mandates in `state/mandates.json` | Mandate exists → **Stations 4–5**: build/run the agent (dispatch mechanics in [`sailor-transactions`](../sailor-transactions/SKILL.md)), then run unattended ([`sailor-automation`](../sailor-automation/SKILL.md)) and offer notifications + a dashboard ([`sailor-extend`](../sailor-extend/SKILL.md)) |

Supported chains: Ethereum (1), Base (8453), Arbitrum (42161), Optimism (10), Unichain (130), BSC (56), World Chain (480), HyperEVM (999), MegaETH (4326), Robinhood (4663), Base Sepolia (84532), Eth Sepolia (11155111). `sailor chains --json` lists them with kernel addresses.

## Step 2 — Deploy the SMA and create the agent wallet

**Canonical path — the setup UI, for every first-time SMA.** Run `sailor ui start`, hand the user the printed bare URL (no hash — it opens the wizard, never the signing page). In the wizard the user: chooses the network, connects the owner wallet, sets a passphrase and generates the agent wallet — a separate signing key the agent uses to submit transactions — then deploys the SMA. All four of those are the user's decisions, made by clicking and typing in that UI; your job is to get them there and narrate what's happening, not to ask for or decide any of it in chat.

**Both wallets need gas, and the split is not what it looks like:** the owner wallet pays for every transaction it submits directly in the browser — SMA deployment, and (a common surprise) **`mandate deploy`**, a contract-creation transaction the owner signs and pays for, not the agent. The **agent wallet submits and pays for `mandate register` and every dispatch submission once the agent runs**. Fund the agent wallet before registering permissions (Station 3) or the transaction fails with a node error like "gas required exceeds allowance" (the exact message text varies by RPC); fund the owner wallet before Station 3 too, for the deploy step. The owner key never leaves the browser — and it never will: I will never ask for it, in any form, at any station, no matter what goes wrong (AGENTS.md invariant 6). If something ever seems to need it, that's a blocked path to report honestly, not a workaround to reach for.

**Advanced/headless alternative — CLI-only, no wizard.** Only reach for this when the user explicitly wants CLI-driven control over onboarding itself (not the common case — the wizard above is simpler and is where the decisions belong):

```bash
sailor keys generate                 # create the agent wallet — interactive terminal prompt for role
                                      # + passphrase (never in chat — see the rule above)
sailor signer start --json &         # signing daemon — BLOCKS; run in background
sailor owner connect --json          # BLOCKS up to 300s waiting for a wallet to connect in the browser
sailor scan --json                   # discover the owner's Safes and state
sailor onboard --new-sma --json      # deploy SMA — BLOCKS waiting for the owner's browser signature
```

`sailor ui start` must ALSO be running before this path prints a usable URL — the signing-page route it prints (`.../#/signer`) is served by the dashboard, not the daemon itself. `onboard --new-sma` pushes a `create-sma` signing request to the browser, waits for the owner to approve (default timeout 10 minutes), then persists the SMA to `.sail/account.json`. Tell the user: "approve the request on the signing page in your browser."

## Deterministic address (salt)

Every SMA deployment uses a CREATE2 salt (default `0`). The kernel binds the salt to the owner, the agent (manager) wallet, and the fee policy — so **create the agent wallet first, then predict**:

```bash
sailor account predict --owner <owner> --manager <agent-wallet> --json
```

The salt is saved to `.sail/account.json` (`saltNonce`) automatically on deploy. All supported chains share the same protocol addresses via CREATE2, so the same owner, manager, and salt produce the same SMA address on every chain. `predict` reads no keys and spends no gas. Use `--salt <n>` for a non-default salt, `--chain <id>` for one chain only.

If `predict` errors with "depends on the agent (manager) wallet", the agent wallet does not exist yet — generate it first.

## Multi-chain deployment

Once the SMA is live on one chain, deploy it at the same address on another supported chain:

```bash
sailor account predict --json                  # confirm the address matches first
sailor account deploy-chain --chain 42161 --json   # BLOCKS waiting for the owner's browser signature
```

The owner approves in the browser (switch the wallet to the target chain before signing); no new salt or agent wallet is needed. The command is idempotent — if the SMA already has code at the predicted address on the target chain it records the chain and exits cleanly. Deployed chains accumulate in `account.json` `deployedChains`.

If `deploy-chain` refuses with an address mismatch, the SMA was deployed against the old per-chain contracts (pre-CREATE2) and cannot be reproduced cross-chain — the fix it prints is to deploy a fresh SMA with `sailor onboard --new-sma`.

## Gas requirements

- Owner wallet: SMA deployment, mandate signing (EIP-712), any additional-chain deployment, and `mandate deploy` (a contract-creation transaction the owner pays for in the browser).
- Agent wallet: `mandate register`, `mandate revoke`, and every dispatch submission once the agent runs, plus the per-permission registration fee. Fund it before registering. Fee mechanics (per-permission charge, `N × fee`, disclosure, preflight) are owned by [`sailor-mandates`](../sailor-mandates/SKILL.md) (Registration fee section).

During setup, always ask before anything that costs gas.

## Station 1 exit verifier

`sailor doctor` — read-only preflight: kernel dispatch model, permission health, RPC reachability, chain-id match, gas balances in both wallets. **Station 1 is not complete until `doctor` is all green** (RPC connected, chain-id matches, keys present, gas funded). `doctor`'s RPC check tolerates the public fallback (no RPC_URL needed to go green) — Station 1 never needs the user's own RPC endpoint. Then → [`sailor-strategy`](../sailor-strategy/SKILL.md) (Station 2), which will ask for it at the first step that genuinely needs it (token resolution) — not here.
