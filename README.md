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
| `packages/ui` | `sailor-ui` | Local dashboard running on localhost:5173 |
| `packages/create-app` | `create-sailor-agent` | `npx` scaffolder for new agent projects |
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
7. **Monitor** — the local dashboard on localhost:5173 reflects live mandate state, agent status, and activity.

---

## Roles

Sailor operates the three roles Sail Protocol separates:

| Role | Authority | Held by |
|---|---|---|
| **Owner** | Holds the Safe. Custody anchor. | The LP (Safe owner) — same wallet as MetaMask |
| **Permission Signer** | Signs mandate registration and revocation via EIP-712. | Same as Owner, or a separate key |
| **Manager** | Executes dispatches within permitted bounds. Signs each dispatch. | The agent key — encrypted in `.sail/keys/manager.json` |

---

## Quickstart

Prerequisites:

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- A wallet (MetaMask or Rabby)
- An RPC URL (Alchemy free tier)
- A Sail Protocol SMA deployed on an EVM chain (kernel + mandateFactory addresses required in `@sail/chains`)

```bash
mkdir my-agent && cd my-agent
npx sailor init                # scaffold into current directory
pnpm install
sailor keys generate           # generates manager key
sailor account create          # deploys SMA via SailKernel
sailor mandate prepare         # writes mandate draft to .sail/
# open localhost:5173 → connect wallet → sign mandate
sailor run --once              # dry-run: preview + execute one tick
sailor run                     # continuous: runs every 60s
```

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
| `dca-rebalancer` | Dollar-cost-averaging portfolio rebalancer. Includes a full agent loop, mandate configuration, GitHub Actions cron job, and the Sailor setup guide (`sail/WIZARD.md`). **Default.** |

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

## Agent-driven onboarding & custom mandates

For chains with a bundled Sail deployment (Base, Base Sepolia, Arbitrum — shipped
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
          .sail/ (account · mandate · activity) ──→ sailor-ui (localhost:5173)
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

Sailor is functional but depends on a deployed SailKernel instance. Sail Protocol is currently in audit and is not deployed on mainnet, so `@sail/chains` ships with an empty registry; the `SailorClient`-based paths (`account create`, `mandate sign`, `run`) report a missing chain configuration until kernel and mandateFactory addresses are present there.

The agent-driven onboarding, signing-station, and custom-mandate deploy/attach flows do not need `@sail/chains`: they target the verified deployments bundled in `@sail/sdk` (Base, Base Sepolia, Arbitrum), and have been exercised end to end against Base Sepolia. The SDK, CLI, keystore, mandate flows, agent runner, and dashboard are implemented. `@sail/chains` will be updated with mainnet addresses at launch.

---

## Contributing

Sailor and Sail Protocol are separate repositories with separate concerns. Protocol questions — SailKernel internals, permission templates, MandateFactory, fee policies — belong in the [SailProtocol](../SailProtocol) repository. Sailor questions — the SDK, CLI, dashboard, and agent templates — belong here.

---

## License

MIT
