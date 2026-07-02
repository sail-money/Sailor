# Sailor

> The open-source toolkit — TypeScript SDK, CLI, and local dashboard — for operating agent-managed Separately Managed Accounts on [Sail Protocol](https://github.com/sail-money/protocol).

[![npm version](https://img.shields.io/npm/v/%40sail.money%2Fsailor)](https://www.npmjs.com/package/@sail.money/sailor)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Tests](https://github.com/sail-money/Sailor/actions/workflows/tests.yml/badge.svg)](https://github.com/sail-money/Sailor/actions/workflows/tests.yml)
[![node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

## What you can build

An autonomous or semi-autonomous agent that manages capital inside a **self-custodial Safe**, bounded by **onchain permissions it cannot exceed**. The owner holds the Safe and signs a mandate — a set of permission contracts encoding exactly what the agent may do (which venues, which tokens, what size). The agent executes within those bounds; anything outside them is rejected by the SailKernel before it touches funds, and the owner can revoke the agent's dispatch rights instantly without moving assets. The trust model — what the contracts enforce versus what stays off-chain — is specified in the [Sail Protocol repo](https://github.com/sail-money/protocol) and the [whitepaper](https://github.com/sail-money/protocol/blob/main/docs/whitepaper/Sail_Protocol_Whitepaper.pdf).

## What's in the box

| Piece | What it does |
|---|---|
| **SDK** (`@sail.money/sailor/sdk`) | `SailorClient`, encrypted keyring, EIP-712 signing, dispatch submission, deployment + chain registries, template encoders |
| **CLI** (`sailor`) | Everything from `sailor init` to `sailor run`: keys, SMA deployment, mandate lifecycle, agent loop, doctor, session control |
| **Dashboard** (`sailor ui`) | Local web UI for onboarding, balances, mandate health, activity, and owner signing |
| **Scaffolded skills** | Step-by-step procedures under `.agents/skills/` that your AI coding assistant follows to set up and operate the agent |

**About the scaffold.** `sailor init` scaffolds your project from `templates/default/`, which ships two things together: the `.agents/skills` your assistant follows, and the **worked example permissions** (`templates/default/examples/` → your project's `examples/`) those skills teach from — protocol-specific bounding patterns (Uniswap, Aave, GMX, ERC-4626, and more) plus an `IPermission` authoring workspace. The examples are shipped teaching material inside every scaffold, not repo furniture.

## Installation

### npm

```bash
# bash / zsh (macOS, Linux)
mkdir my-agent && cd my-agent && npm i @sail.money/sailor && npx sailor init
```

```powershell
# PowerShell (Windows)
mkdir my-agent ; cd my-agent ; npm i @sail.money/sailor ; npx sailor init
```

Requires Node.js **>= 18**. For a global CLI instead: `npm install -g @sail.money/sailor`.

### Docker (no Node.js required)

```bash
mkdir my-agent && cd my-agent
docker run -d --name agent -P -v "${PWD}:/workspace" sailmoney/sailor
docker exec agent sailor init
```

Project files live on your host via the volume mount; prefix `sailor` commands with `docker exec agent`. Full details: [docs/docker.md](./docs/docker.md).

## Quickstart

The recommended path is assistant-driven: open the scaffolded folder in Claude Code, Cursor, Codex, or any AI coding assistant and say **"start"** — the scaffold's `AGENTS.md` and skills walk the assistant through everything below. The direct-CLI version of the same journey:

```bash
npx sailor init my-agent && cd my-agent && npm install

# 1. Generate the agent's encrypted signing key (geth keystore v3 on disk)
sailor keys generate --type agent-wallet

# 2. Connect your wallet as owner, then deploy the SMA (a Safe) on-chain
sailor owner connect
sailor onboard --new-sma

# 3. Give the agent a mandate — register + configure a shared permission
#    template (swap, transfer, deposit, ...). The skills flow drives this
#    conversationally; directly, it is register then configure:
sailor mandate attach --address <templateAddress> --sma <yourSMA>
sailor mandate configure --address <templateAddress> --template SwapPermission --args-file swap-config.json

# 4. Run the agent loop (or --once for a single tick)
sailor run --once
```

**See an action get blocked.** The fail-closed guarantee is testable before anything is at risk — probe the mandate off-chain with `sailor mandate simulate` (an `eth_call`; spends no gas, signs nothing):

```bash
sailor mandate simulate --address <templateAddress> \
  --target <someContractOutsideYourMandate> \
  --calldata 0xa9059cbb... --expect fail
```

Each probed call prints a verdict — `PASS`, `FAIL`, or `REVERT` — which is the permission contract's real `evaluate()` decision, exactly what the kernel consults on a live dispatch. A call outside your mandate shows `FAIL` (and `--expect fail` exits non-zero on a mismatch, so you can wire it into CI). At runtime the same protection reads: `sailor run` skips any planned call no registered permission accepts — logged to the console (`skipped: no registered permission authorizes call to <target>`) and to `.sail/activity.jsonl` as `dispatch_denied` — and if a transaction ever reaches the kernel outside its bounds, the kernel reverts it. Deny by default, at every layer.

Longer walkthrough, including revocation: [docs/getting-started.md](./docs/getting-started.md).

## How the assistant is guided (skills)

The scaffold follows the open [Agent Skills](https://agentskills.io) standard: a slim, always-loaded `AGENTS.md` carries the project map and hard invariants, while detailed procedures live in on-demand skills under `.agents/skills/` — onboarding, transactions, mandate authoring, shared-template configuration (one skill per template), automation, and more. Shared templates are registered and configured *through* the skills because the safe order of operations (register → configure → simulate → verify) is encoded there once, instead of re-derived by every assistant. Skills are plain markdown; assistants that don't scan skills follow the routing table in `AGENTS.md` to the same files. See [docs/templates-and-skills.md](./docs/templates-and-skills.md).

## Documentation

| Doc | What's in it |
|---|---|
| [docs/getting-started.md](./docs/getting-started.md) | Long-form quickstart: install → first SMA → first mandate → first run → revocation |
| [docs/cli-reference.md](./docs/cli-reference.md) | The full `sailor` command surface, grouped by workflow |
| [docs/sdk-usage.md](./docs/sdk-usage.md) | `SailorClient` basics and every SDK subpath export, with examples |
| [docs/docker.md](./docs/docker.md) | Image, volumes, key handling, dashboard access, headless operation |
| [docs/templates-and-skills.md](./docs/templates-and-skills.md) | The shared-template catalog and how skills drive configuration and use |
| [docs/architecture.md](./docs/architecture.md) | The Sailor ↔ Sail Protocol boundary: what's onchain vs what this toolkit does |

## Security model

- The agent signs dispatches; the **kernel evaluates the named permission on every call**. A permission returning false, reverting, or exceeding its gas cap is a denial — fail-closed.
- The **Owner key controls the Safe and is never read by Sailor**. Mandate registration requires a deliberate signature from the permission signer in the browser signing station.
- The **manager (agent) key is encrypted on disk** (geth keystore v3: scrypt + aes-128-ctr) and never transmitted.
- The session can be **paused instantly** (`sailor session pause` or the dashboard) — revoking dispatch rights without touching Safe custody.
- All addresses are EIP-55 normalized before any on-chain call or state write.

Vulnerability reports: see [SECURITY.md](./SECURITY.md) (off-chain toolkit) — smart-contract issues go to the [protocol's policy](https://github.com/sail-money/protocol/blob/main/SECURITY.md).

## Deployments

The SDK bundles verified deployments for **11 chains** — mainnets: Ethereum (1), Base (8453), Arbitrum (42161), Optimism (10), Unichain (130), BSC (56), World Chain (480), HyperEVM (999), MegaETH (4326); testnets: Base Sepolia (84532), Ethereum Sepolia (11155111). Every core contract sits at the same address on every chain via CREATE2 (SailKernel: `0x38b508756c976e876EFF05a29E731A4d348BA6ED`), and the seven shared permission templates (swap, swap-no-oracle, borrow, deposit, withdraw, transfer, approve-and-call-batch) are deployed and registered as `knownTemplates` on all of them. Query it yourself: `sailor chains` or `getSailDeployment(chainId)` from the SDK; the canonical record is the protocol repo's [deployments/addresses.md](https://github.com/sail-money/protocol/blob/main/deployments/addresses.md).

These deployments are under an ongoing external **security review** by [Octane](https://octane.security) and are not final — do not use them with funds you are not prepared to lose.

## Contributing

Sailor will be continuously enhanced through community participation and feedback — contributions, issue reports, and design discussions are actively welcomed. Start with [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Agentic Finance Inc.
