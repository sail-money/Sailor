# Sailor

> A toolkit for building and operating Sail Protocol SMAs with AI agents.

Sailor is the operator layer for [Sail Protocol](../SailProtocol): the tooling an agent builder uses to create a Separately Managed Account, bound it with permissions, and run a strategy against it. It wraps the on-chain primitives — SailKernel dispatch, MandateFactory registration, EIP-712 mandate signing — behind a TypeScript SDK, a CLI, and a local dashboard. An agent is an async function that receives context and returns intended transactions; Sailor previews each through the kernel, executes the approved ones, and records what happened. It does not deploy the protocol or author new permission templates — that lives in Sail Protocol. It sits one level up: turning a deployed SailKernel into something an operator can actually drive.

---

## What's inside

| Package | Name | Role |
|---|---|---|
| `packages/sdk` | `@sail.money/sdk` | TypeScript library wrapping SailKernel and MandateFactory |
| `packages/cli` | `@sail.money/sailor` | CLI for account setup, mandate signing, and agent execution |
| `packages/chains` | `@sail.money/chains` | Per-chain address registry (EVM-compatible) |
| `packages/ui` | `sailor-ui` | Local dashboard running on localhost:3333 |
| `templates/default` | — | Default agent starter (neutral; what `sailor init` scaffolds) |
| `templates/custom-mandate` | — | Solidity reference: IPermission scaffold (not a project template) |
| `templates/lifi-permissions` | — | Solidity reference: LiFi clone permission contracts (not a project template) |

---

## How it works

The path from nothing to a running agent is five stages, guided by your AI coding assistant through the scaffolded `AGENTS.md`:

1. **Deploy your SMA and create your agent wallet** — done in the browser. Your owner wallet never leaves it.
2. **Define your strategy** — describe what you want your agent to do. The assistant asks the right questions to establish on-chain bounds (tokens, amounts, venues), then helps design the permission contracts.
3. **Build, test, and sign your mandate** — the assistant authors the permission contracts, proves in plain English what each one permits and blocks, deploys them, and walks you through signing to authorize.
4. **Run** — `sailor run` executes your agent locally on a schedule, or via the GitHub Actions workflow the scaffold provides.
5. **Extend** *(optional)* — the assistant can wire notifications (Telegram, email) and build a custom dashboard tailored to your strategy.

Run `npx sailor init my-agent`, open the scaffolded folder in Claude Code, Cursor, Codex, or any AI coding assistant, and say **"start"**. The `AGENTS.md` in the project drives the assistant through all five stages.

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

- Node.js 18+
- A wallet (MetaMask or Rabby)
- An RPC URL (e.g. Alchemy free tier)
- A supported chain: **Base, Base Sepolia, Arbitrum, or Unichain** — verified deployments are bundled in `@sail.money/sdk`, no `@sail.money/chains` entry needed. Other chains require addresses in `@sail.money/chains`.

### Recommended — assistant-driven

```bash
npx sailor init my-agent && cd my-agent
npm install
```

Open this folder in Claude Code, Cursor, Codex, or any AI coding assistant and say **"start"**. The scaffolded `AGENTS.md` guides the assistant through all five stages — SMA deployment, strategy definition, mandate authoring, running, and automation. No manual steps required.

### Direct CLI reference (advanced)

For users who prefer the terminal:

```bash
sailor capabilities    # what you can build on this chain — read-only, no gas
sailor doctor          # kernel model + RPC reachability + gas balances
sailor ui start        # open http://localhost:3333 to deploy SMA + create agent wallet
sailor run --once      # single tick — confirm it works before automating
sailor run             # start the agent (continuous)
sailor keys export-ci  # copy the encrypted agent wallet to ci-keystore.json for CI commits
sailor mandate sign    # sign a mandate — reconciles against live on-chain permissions first
```

`sailor run` writes reverted transactions to stderr as `reverted: <txHash> (gas used: N)`; successful dispatches are appended to `.sail/activity.jsonl`.

---

## Templates

`sailor init` scaffolds a new agent project from a template. By default it
writes into the **current directory**; pass a name to create a subdirectory.

```bash
sailor init                              # scaffold into cwd
sailor init my-agent                     # create ./my-agent/ and scaffold there
sailor init --template default           # explicit (same as default)
sailor init my-agent --template <name>   # named subdirectory + specific template
```

### Available templates

| Template | Description |
|---|---|
| `default` | Neutral agent starter. Includes a blank agent loop, Foundry workspace for permission contracts, GitHub Actions cron job, and the operator guide (`AGENTS.md`). For a complete worked example see `examples/dca/`. **Default.** |

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
in `@sail.money/sdk`, no `@sail.money/chains` entry required), an agent can drive the whole
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

`sailor mandate sign` reconciles against the live on-chain `getPermissions()` call
before building the mandate payload — permissions revoked on-chain are excluded even
if they remain in the local `.sail/state/mandates.json` (which is an append-only
historical record and is never modified by the reconciliation).

### GitHub Actions CI

The scaffolded `.github/workflows/agent-tick.yml` runs `sailor run --once` on a
cron schedule using `npm ci` (no pnpm required). Setup:

1. `sailor keys export-ci` — copies the encrypted agent wallet to `ci-keystore.json`
   in the project root and allowlists it in `.gitignore`. The geth v3 keystore is
   safe to commit; the raw private key is never exposed.
2. Commit `ci-keystore.json`, `.sail/account.json`, and `.sail/mandate.json`.
3. Add two repository secrets (Settings → Secrets → Actions):
   - `SAIL_PASSPHRASE` — the passphrase that encrypts the agent wallet
   - `RPC_URL` — your RPC endpoint

The workflow copies `ci-keystore.json` to `.sail/keys/manager.json`, then calls
`npx sailor run --once` with `SAIL_PASSPHRASE` set so the key is unlocked
non-interactively. No private key ever appears in the workflow file or in secrets.

---

## Packages

Sailor ships as two independent npm packages:

| Package | Contents |
|---|---|
| `@sail.money/sailor` | CLI binary, UI server, templates, examples |
| `@sail.money/sdk` | TypeScript SDK — `SailorClient`, EIP-712 helpers, deployment registry |

Installing sailor pulls in the SDK automatically. To use the SDK on its own:

```bash
npm install @sail.money/sdk
```

Both packages use the `@sail.money` scope. Dev builds carry a prerelease version suffix and are tagged `dev`; production releases are tagged `latest`:

| | `@sail.money/sailor` | `@sail.money/sdk` |
|---|---|---|
| Production (tag push) | `1.0.0` → `latest` | `1.0.0` → `latest` |
| Dev (manual dispatch) | `1.0.0-dev.42` → `dev` | `1.0.0-dev.42` → `dev` |

```bash
npm install @sail.money/sailor        # latest stable
npm install @sail.money/sailor@dev    # latest dev build
```

### Publishing flow

SDK publishes first; sailor publishes after with a pinned dependency on the exact SDK version just built. Both packages share the same build number so their versions always match.

`package-publish.json` at the repo root is the manifest CI uses when publishing sailor: it omits `packages/sdk/dist` from `files` since the SDK ships as a proper npm dependency instead. The repo `package.json` keeps the SDK dist bundled so `file:` installs and local testing continue to work unchanged.

### GitHub Packages and import paths

`@sailagent/sailor` and `@sailagent/sdk` are also published to GitHub Packages for internal testing — no public npm registry required. GitHub Packages requires packages to be scoped to the owning organisation (`@sailagent`), so the SDK import path differs from the npm one. If you install from GitHub Packages and need to import the SDK in your own code, add an alias to your `package.json`:

```json
"dependencies": {
  "@sail.money/sdk": "npm:@sailagent/sdk"
}
```

This lets you keep `import from '@sail.money/sdk'` in your code regardless of which registry you installed from.

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

          sailor CLI / @sail.money/sdk drive both signing paths above.
          .sail/ (account · mandate · activity) ──→ sailor-ui (localhost:3333)
```

The CLI and SDK sit between the operator and SailKernel: they build the EIP-712 payloads, submit dispatches, and read kernel state via viem. The permission signer authorizes the mandate — registration runs through MandateFactory — while the manager key signs each dispatch the kernel evaluates against a named permission before executing it through the Safe. All local state — the deployed account, the signed mandate, and the agent's activity log — lives under `.sail/` on disk, which the dashboard reads through a small local server. Sailor never holds the Owner key and runs no hosted backend; the wallet talks to the chain directly.

---

## Security model

- The agent signs dispatches; the kernel evaluates the named permission on every call. A permission returning false or exceeding its gas cap is treated as denial — fail-closed.
- The Owner key controls the Safe and is never read by Sailor. Mandate signing requires a deliberate action by the permission signer.
- The manager key is encrypted on disk using geth keystore v3 (scrypt + aes-128-ctr) and is never transmitted.
- The session can be paused instantly via `sailor session pause` or the dashboard stop button; this does not affect Safe custody.
- All addresses passed to the CLI are normalized with `getAddress()` (EIP-55 checksum). Mixed-case or lowercase inputs are accepted and canonicalized before any on-chain call or state write.

---

## State of the project

Sailor is functional and published as [`@sail.money/sailor`](https://www.npmjs.com/package/@sail.money/sailor) on npm (v0.0.1). The SDK, CLI, keystore, mandate flows, agent runner, and dashboard are implemented and have been exercised end to end against Base Sepolia.

The Sail Protocol trusted core is deployed on Base, Base Sepolia, Arbitrum, and Unichain as staging deployments for testing ahead of a formal launch. All four run the selective dispatch model, with verified deployments bundled in `@sail.money/sdk`. These deployments are under an ongoing external audit by [Octane Security](https://octane.security) and are not final — do not use them with funds you are not prepared to lose. Permission templates are not yet deployed against the Base, Arbitrum, and Base Sepolia kernels; **Unichain** ships the full template suite (7 shared + 12 standalone, source-verified) and its template registries in `@sail.money/sdk` are populated. `@sail.money/chains` and the remaining template registries will be filled in as templates are deployed on the other chains and at mainnet launch.

---

## Deployments

The Sail Protocol trusted core is live on the following chains as **staging deployments** ahead of a formal launch, bundled in `@sail.money/sdk`. All run the selective dispatch model with zero fees. Permission templates are not yet deployed against the Base, Arbitrum, and Base Sepolia kernels; **Unichain** ships the full template suite (7 shared + 12 standalone, source-verified on uniscan.xyz) and has its onboarding allowlists seeded at genesis.

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

The 19 template addresses are in `@sail.money/sdk` (`knownTemplates` + `standaloneTemplates` for chain 130).

Addresses are sourced from `@sail.money/sdk` (`packages/sdk/src/deployments.ts`), the canonical registry.

---

## Contributing

Sailor and Sail Protocol are separate repositories with separate concerns. Protocol questions — SailKernel internals, permission templates, MandateFactory, fee policies — belong in the [SailProtocol](../SailProtocol) repository. Sailor questions — the SDK, CLI, dashboard, and agent templates — belong here.

---

## License

MIT
