# Sailor

> A toolkit for building and operating Sail Protocol SMAs with AI agents.

Sailor is the operator layer for [Sail Protocol](../SailProtocol): the tooling an agent builder uses to create a Separately Managed Account, bound it with permissions, and run a strategy against it. It wraps the on-chain primitives — SailKernel dispatch, MandateFactory registration, EIP-712 mandate signing — behind a TypeScript SDK, a CLI, and a local dashboard. An agent is an async function that receives context and returns intended transactions; Sailor previews each through the kernel, executes the approved ones, and records what happened. It does not deploy the protocol or author new permission templates — that lives in Sail Protocol. It sits one level up: turning a deployed SailKernel into something an operator can actually drive.

---

## What's inside

| Package | Name | Role |
|---|---|---|
| `packages/sdk` | `@sail/sdk` | TypeScript library wrapping SailKernel and MandateFactory |
| `packages/cli` | `sailor` | CLI for account setup, mandate signing, and agent execution |
| `packages/chains` | `@sail/chains` | Per-chain address registry (EVM-compatible) |
| `packages/ui` | `sailor-ui` | Local dashboard running on localhost:3333 |
| `templates/dca-rebalancer` | — | Starter template: DCA portfolio rebalancer (default for `sailor init`) |
| `templates/custom-mandate` | — | Solidity reference: allowlist mandate contracts (not a project template) |
| `templates/lifi-permissions` | — | Solidity reference: LiFi clone permission contracts (not a project template) |

---

## How it works

The path from nothing to a running agent is seven steps:

1. **Generate keys** — a manager key (the agent's dispatch signer) and a permissionSigner key, both generated and encrypted on disk.
2. **Deploy SMA** — a Safe registered with SailKernel, with the manager and permissionSigner addresses set at registration.
3. **Write a strategy** — an async `tick` function that receives a context and returns a list of intended dispatches.
4. **Sign a mandate** — a set of registered permissions that bound what the agent can do, authorized via EIP-712 by the permission signer through MetaMask or a local key.
5. **Dry-run** — the kernel's `previewBatch` confirms the named permission passes before anything executes on-chain.
6. **Run the agent** — locally on a cron schedule, or via GitHub Actions on a timer.
7. **Monitor** — the local dashboard on localhost:3333 reflects live mandate state, agent status, and activity.

---

## Roles

Sailor operates the three roles Sail Protocol separates:

| Role | Authority | Held by |
|---|---|---|
| **Owner** | Holds the Safe. Custody anchor. | The LP (Safe owner) — same wallet as MetaMask |
| **Permission Signer** | Signs mandate registration and revocation via EIP-712. | Same as Owner, or a separate key |
| **Manager** | Executes dispatches within permitted bounds. Signs each dispatch. | The agent key — encrypted in `.sail/keys/manager.json` |

---

## Installation

### Start a new agent project (recommended)

Open your AI coding assistant and run in its terminal:

```sh
npx sailor init my-agent
```

Then say **"start"** — your assistant takes it from there.

### Global CLI (for direct sailor commands)

```sh
npm install -g @sail.money/sailor
sailor init my-agent
```

---

## Quickstart

Prerequisites:

- Node.js 18+ (the CLI runs on 18; `pnpm install` needs Node 22+)
- A wallet (MetaMask or Rabby)
- An RPC URL (e.g. Alchemy free tier)
- A supported chain: **Base, Base Sepolia, Arbitrum, or Unichain** — these use the verified deployments bundled in `@sail/sdk`, so no `@sail/chains` entry is needed. Other chains require kernel + mandateFactory addresses in `@sail/chains` (see [State of the project](#state-of-the-project)).

```bash
npx sailor init my-agent && cd my-agent
npm install                    # or `pnpm install` (needs Node 22+)

# 1. Ground yourself — read-only, no gas, no wallet:
sailor capabilities            # what you can build on this chain
sailor doctor                  # kernel model + RPC reachability + gas balances

# 2. Set up the account in the browser wizard (choose chain, connect wallet,
#    generate the agent key, deploy your SMA):
sailor ui start                # open http://localhost:3333 and follow steps 1–4

# 3. Back in the terminal: configure .sail/.env.local, fund the agent key for gas,
sailor mandate prepare         # draft permissions → approve in the browser
sailor run                     # start the agent (use --once for a single tick)
```

The SMA is deployed through the browser wizard (it submits from your wallet), not a
terminal command — see the scaffolded project's `AGENTS.md` for the full 8-step flow.

---

## Templates

`sailor init` scaffolds a new agent project from a template. By default it
writes into the **current directory**; pass a name to create a subdirectory.

```bash
sailor init                              # scaffold into cwd
sailor init my-agent                     # create ./my-agent/ and scaffold there
sailor init --template dca-rebalancer    # explicit (same as default)
sailor init my-agent --template <name>   # named subdirectory + specific template
```

### Available templates

| Template | Description |
|---|---|
| `dca-rebalancer` | Dollar-cost-averaging portfolio rebalancer. Includes a full agent loop, Foundry workspace for permission contracts, GitHub Actions cron job, and the operator guide (`AGENTS.md`). **Default.** |

### What makes a valid template

A valid template is any directory under `templates/` that contains a
`package.json`. Directories without one (e.g. `custom-mandate`,
`lifi-permissions`) are Solidity reference sources, not project scaffolds, and
are excluded from the available list.

### Adding a template

1. Create a directory under `templates/<your-template-name>/`.
2. Add a `package.json` (the `name` field is patched to the project name on
   init).
3. Add a `.sail/` workspace structure if the agent needs local state.
4. The template will appear automatically in `sailor init --template <name>`.

Template files are bundled into the published `sailor` npm package via the
`files` field in the root `package.json`.

---

## Dashboard (`sailor ui`)

The Sailor dashboard is a local React app served at `http://localhost:3333`.
It shows live account state, mandate health, signer balances, and recent
activity — all read from the project's `.sail/` directory with no hosted
backend.

### Commands

```bash
sailor ui             # start the dashboard (same as sailor ui start)
sailor ui start       # start the dashboard at http://localhost:3333
sailor ui stop        # stop the running dashboard
sailor ui status      # show whether the dashboard is running + pid
```

### How it works

`sailor ui start` spawns a bundled Express server (`server.cjs`) that:

- Serves the pre-built React UI as static files on `/`
- Exposes a local API on `/api` that reads `.sail/` state from the current
  working directory

The server PID is written to `.sail/runtime/ui.json` on start. `sailor ui stop`
reads that file, sends `SIGTERM` to the server process, and removes the file.
This means you can start the dashboard in one terminal and stop it from another.

### Running in the background

```bash
# macOS / Linux
sailor ui start &
sailor ui status      # ● running  http://localhost:3333  (pid 12345)
sailor ui stop        # Stopped Sailor UI (pid 12345).

# Windows (PowerShell)
Start-Job { sailor ui start }
sailor ui status
sailor ui stop
```

---

## Agent-driven onboarding & custom mandates

For chains with a bundled Sail deployment (Base, Base Sepolia, Arbitrum, Unichain — shipped
in `@sail/sdk`, no `@sail/chains` entry required), an agent can drive the whole
setup through a browser **signing station**. The station is a local HTTP +
WebSocket daemon that bridges the CLI and the owner's wallet: the agent never
holds the owner key — it pushes signing requests, the owner approves them in the
browser, and the agent submits the transactions it's allowed to.

```bash
sailor keys generate                       # manager (agent) key
sailor station start &                      # signing daemon (serves the UI)
# owner opens the printed URL once and connects their wallet
sailor owner connect                        # detect & persist the owner
sailor scan                                 # discover the owner's Safes + state
sailor onboard --new-sma                    # create an SMA + (optionally) attach a mandate
```

Agents author their own permission contracts and deploy them from the scaffolded
Foundry workspace (`mandates/`, with `@sail/interfaces/IPermission.sol` vendored
under `.sail/contracts/`):

```bash
forge build
sailor mandate deploy --contract MyMandate \
  --args '["0xPermissionSigner", ["0xTarget"]]' \
  --attach --sma 0xSafe
```

`deploy` emits a contract-creation signing request (the owner signs it in the
browser); the deployed address is read from the receipt and tracked in
`.sail/state/mandates.json`. `attach` reads the signer nonce, has the owner sign
a `RegisterPermission` EIP-712 message, then the agent submits
`kernel.registerPermission` with the exact registration fee. Every command takes
`--json` for headless agent use; set `SAIL_PASSPHRASE` to unlock the manager key
non-interactively.

---

## Architecture

```
   ┌────────────────────┐                          ┌────────────────────┐
   │  Permission Signer │                          │    Manager/Agent   │
   │  MetaMask / local  │                          │ .sail/keys/manager │
   └─────────┬──────────┘                          └─────────┬──────────┘
             │                                               │
             │ EIP-712 mandate                               │ dispatch
             ▼                                               ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                            SailKernel                               │
   │                          (Sail Protocol)                            │
   └─────────┬───────────────────────┬───────────────────────┬───────────┘
             │                       │                       │
             │ registration          │ execution             │ evaluation
             ▼                       ▼                       ▼
   ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
   │   MandateFactory   │  │         Safe       │  │     Permissions    │
   │  (register perms)  │  │      (custody)     │  │  (named, per-call) │
   └────────────────────┘  └────────────────────┘  └────────────────────┘

          sailor CLI / @sail/sdk drive both signing paths above.
          .sail/ (account · mandate · activity) ──→ sailor-ui (localhost:3333)
```

The CLI and SDK sit between the operator and SailKernel: they build the EIP-712 payloads, submit dispatches, and read kernel state via viem. The permission signer authorizes the mandate — registration runs through MandateFactory — while the manager key signs each dispatch the kernel evaluates against a named permission before executing it through the Safe. All local state — the deployed account, the signed mandate, and the agent's activity log — lives under `.sail/` on disk, which the dashboard reads through a small local server. Sailor never holds the Owner key and runs no hosted backend; the wallet talks to the chain directly.

---

## Security model

- The agent signs dispatches; the kernel evaluates the named permission on every call. A permission returning false or exceeding its gas cap is treated as denial — fail-closed.
- The Owner key controls the Safe and is never read by Sailor. Mandate signing requires a deliberate action by the permission signer.
- The manager key is encrypted on disk using geth keystore v3 (scrypt + aes-128-ctr) and is never transmitted.
- The session can be paused instantly via `sailor session pause` or the dashboard stop button; this does not affect Safe custody.

---

## State of the project

Sailor is functional and published as [`@sail.money/sailor`](https://www.npmjs.com/package/@sail.money/sailor) on npm (v0.0.1). The SDK, CLI, keystore, mandate flows, agent runner, and dashboard are implemented and have been exercised end to end against Base Sepolia.

The Sail Protocol trusted core is deployed on Base, Base Sepolia, Arbitrum, and Unichain as staging deployments for testing ahead of a formal launch. All four run the selective dispatch model, with verified deployments bundled in `@sail/sdk`. These deployments are under an ongoing external audit by [Octane Security](https://octane.security) and are not final — do not use them with funds you are not prepared to lose. Permission templates are not yet deployed against the Base, Arbitrum, and Base Sepolia kernels; **Unichain** ships the full template suite (7 shared + 12 standalone, source-verified) and its template registries in `@sail/sdk` are populated. `@sail/chains` and the remaining template registries will be filled in as templates are deployed on the other chains and at mainnet launch.

---

## Deployments

The Sail Protocol trusted core is live on the following chains as **staging deployments** ahead of a formal launch, bundled in `@sail/sdk`. All run the selective dispatch model with zero fees. Permission templates are not yet deployed against the Base, Arbitrum, and Base Sepolia kernels; **Unichain** ships the full template suite (7 shared + 12 standalone, source-verified on uniscan.xyz) and has its onboarding allowlists seeded at genesis.

### Base (8453)

| Contract | Address |
|---|---|
| SailKernel | `0x6319d3dfDDe3804ba93D65752b00c52bFb05a1ab` |
| SailGovernance | `0x7E897D919872b1587577617ffFC42113679d0C50` |
| Timelock | `0x8eC3Ca951E193C6E3713A70022454d7A1f083281` |
| PermissionFactory | `0x7724EACd97C8601d5AC244Aadbf76ad87353Ff31` |
| StandardFeePolicy | `0x65850a8D5050aeAade68289ff96c4F119a24B82e` |
| SafeModuleEnabler | `0xC84EdE78f93291A1fab19F51c4c7e938AB302Edf` |
| Treasury | `0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6` |

### Arbitrum (42161)

| Contract | Address |
|---|---|
| SailKernel | `0x2716B12832DED0EF5688519c5Fe069EFc0374E02` |
| SailGovernance | `0xd6AbB7A1036ADc7958Abffec9Da03450c5a2Ec8e` |
| Timelock | `0x114CB7110C780f7E3a6093AfE0B52463a569857C` |
| PermissionFactory | `0x23681A8A4C9819D8EaB37E46B858da6F3c85E683` |
| StandardFeePolicy | `0xAdfB986D48480bC67a7cF3751d30599161632e0D` |
| SafeModuleEnabler | `0xabe2a6D03F592BC602cA1dBDCD885ba2493274f9` |
| Treasury | `0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6` |

### Base Sepolia (84532)

| Contract | Address |
|---|---|
| SailKernel | `0xf1D0F4C9893612627409948BAa9d82a01a373799` |
| SailGovernance | `0xEaD44bC6999E7b00b9b2E11c1660248DC2a30993` |
| Timelock | `0x97B863e392C9859336788D5Ec454527d33C95B74` |
| PermissionFactory | `0xdfF6a2272F667cDf78Af4681b9c88A219998db95` |
| StandardFeePolicy | `0x05570F7973b46Eb9Ed4518422891EFC26BD58b97` |
| SafeModuleEnabler | `0xB2C2B52d94412e3472C9fb2B52186eA12a935869` |
| Treasury | `0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6` |

### Unichain (130)

First chain to ship the full permission-template suite (7 shared + 12 standalone, source-verified on [uniscan.xyz](https://uniscan.xyz)). Genesis allowlist bootstrap — onboarding usable without the 48h timelock.

| Contract | Address |
|---|---|
| SailKernel | `0xD985029960a9B7C2E7E38e102C448b8b8539B156` |
| SailGovernance | `0xAb5C90ECfF2763f6f20f8E553E3b8778dD9C349A` |
| Timelock | `0xd44FbBB37f01e235E0EE5386948F216d36D0CEf2` |
| PermissionFactory | `0x8edDb62Aa49CeB837abf2653be2d93Ad9Fe6777D` |
| StandardFeePolicy | `0x7bBA8BE3c01c972757aA4a230A00D58aB600A1F1` |
| SafeModuleEnabler | `0xFE9227A9F2baf704060c604466df354a5A137b9B` |
| Treasury | `0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6` |

The 19 template addresses are in `@sail/sdk` (`knownTemplates` + `standaloneTemplates` for chain 130).

Addresses are sourced from `@sail/sdk` (`packages/sdk/src/deployments.ts`), the canonical registry.

---

## Contributing

Sailor and Sail Protocol are separate repositories with separate concerns. Protocol questions — SailKernel internals, permission templates, MandateFactory, fee policies — belong in the [SailProtocol](../SailProtocol) repository. Sailor questions — the SDK, CLI, dashboard, and agent templates — belong here.

---

## License

MIT
