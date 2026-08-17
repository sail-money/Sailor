# Sailor — Codebase Guide

This guide is for contributors to the Sailor codebase. The user-facing operating guide ships as the `sailor-navigator` skill (scaffold/.agents/skills/sailor-navigator/SKILL.md); scaffold/AGENTS.md is the user's own project-instructions file.

Sailor is the harness for building and operating DeFi agents on Sail Protocol. It does **not** deploy the protocol or author
permission templates — it targets already-deployed SailKernel instances and gives operators the
tooling to create SMAs, construct mandates, and build and run strategy agents. Sailor guides; the protocol enforces.

## Repo structure

| Package / path | Name | Role |
|---|---|---|
| `packages/sdk` | `@sail/sdk` | SailorClient, LocalKeyring, kernel ABIs, EIP-712 builders, deployment registry, per-chain address registry (publishes to npm as `@sail.money/sdk`) |
| `packages/cli` | `sailor` | CLI: init, update, keys, account, mandate, onboard, signer, ui, sandbox, run, service, trigger, session, scan, status, owner, doctor, capabilities, chains |
| `packages/ui` | `sailor-ui` | Local dashboard + browser-driven onboarding wizard (per-project port, 3333–3999) |
| `packages/sandbox` | `@sail/sandbox` | Native anvil fork engine behind Shipyard, the simulation sandbox — `startFork`/`stopFork`, chain-id/port tables, fork manifest. Internal; not published standalone |
| `scaffold` | — | Default agent starter: neutral blank scaffold + Foundry workspace + operating guide (`sailor-navigator` skill) |
| `scaffold/contracts` | — | Solidity reference: IPermission scaffold (not a project template) |

## Protocol roles

The code uses internal identifiers that differ from user-facing terms:

| User-facing term | Code identifier | Meaning |
|---|---|---|
| Owner | `owner` | Holds the Safe; custody anchor; never touches the agent runtime |
| Mandate signer | `permissionSigner` | Authorizes permission registration via EIP-712 |
| Agent wallet | `manager` | Signs dispatches; key at `.sail/keys/manager.json` |

Use the user-facing terms in all CLI output, prompts, and errors. The code identifiers are internal.

## Dispatch model

All twelve chains share the same kernel at the same CREATE2 address, verified on-chain via `DISPATCH_TYPEHASH()`:

| Kernel (all 12 chains) | Model | DISPATCH_TYPEHASH |
|---|---|---|
| `0x38b508756c976e876EFF05a29E731A4d348BA6ED` | **selective** | `0xbe50c539...` |

Supported chains: Ethereum (1), Base (8453), Arbitrum (42161), Optimism (10), Unichain (130), BSC (56), World Chain (480), HyperEVM (999), MegaETH (4326), Robinhood (4663), Base Sepolia (84532), Eth Sepolia (11155111).

All twelve kernels are live and bootstrapped (genesis allowlist set, `createAccount` verified working, zero fees). Shared permission templates (swap, swap-no-oracle, borrow, deposit, withdraw, transfer, approve-and-call-batch) are deployed and verified against the current kernel on every chain — `knownTemplates` is populated for all twelve entries (`standaloneTemplates` stays empty: it's the EIP-1167 clone-implementation registry, and these are shared multi-tenant templates). `packages/sdk/src/deployments.ts` is the canonical source of truth for kernel addresses, templates, and metadata.

**Always use `detectKernelCapabilities` for the real model** — it reads the on-chain typehash and
overrides the static label in `deployments.ts`. The static label is a fallback for offline use only.

Type strings:
```
conjunctive: Dispatch(address account,address target,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)
selective:   Dispatch(address account,address permission,address target,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)

conjunctive RegisterPermission: RegisterPermission(address account,address permission,uint256 nonce)
selective   RegisterPermission: RegisterPermission(address account,address permission,uint256 nonce,uint256 deadline)
```

`buildRegisterPermissionTypedData` accepts `hasDeadline` from `KernelCapabilities.registerPermissionHasDeadline`.
Pass the detected value — never hardcode the type shape.

## Active addresses

All twelve chain records in `packages/sdk/src/deployments.ts` are live — no commented-out or pending
addresses remain. This file is the source of truth this guide mirrors.

- `packages/sdk/src/deployments.ts` — `SailDeployment` records; canonical source of truth
- `packages/sdk/src/chains.ts` — `ChainConfig` per chainId; canonical per-chain registry

## Key files

| File | What it owns |
|---|---|
| `packages/sdk/src/deployments.ts` | Active + PENDING addresses, `dispatchModel` per chain |
| `packages/sdk/src/capabilities.ts` | On-chain typehash detection; capability cache |
| `packages/sdk/src/eip712.ts` | `buildRegisterPermissionTypedData`, `REGISTER_PERMISSION_TYPES` |
| `packages/cli/src/commands/onboard.ts` | SMA creation + permission registration flow |
| `packages/cli/src/commands/mandate-contracts.ts` | Deploy / register / revoke permission contracts |
| `packages/cli/src/lib/mandates.ts` | `MandateStore` — `.sail/state/mandates.json` source of truth |
| `packages/sdk/src/fees.ts` | `readPermissionRegistrationFee` (live governance read) + per-permission fee math/disclosure/preflight |
| `packages/ui/server.js` | Local API + WebSocket proxy; signing server relay |

Per-permission registration fee (read live from governance, surfaced at sign time / activity / preflight): see `scaffold/.agents/skills/sailor-mandates/SKILL.md` → "Registration fee".

## Build

```bash
pnpm install
pnpm build        # builds all packages; dependency order: sdk → sandbox → cli → ui
```

Build order matters — `cli` bundles `ui/server.js`, which imports from both `sdk` and `sandbox`.

## Test

```bash
pnpm test         # vitest + node:test — no chain needed, a few seconds
pnpm test:ui      # playwright — requires pnpm build first
```

Test fixtures live in `packages/ui/test/fixtures/` — isolated directories with pre-canned `.sail/`
state; no real RPC needed. `loadFixture(name, patches, { mode: 'sandbox' })` starts the same fixture
with the sandbox routes enabled. `packages/sandbox`'s own tests are anvil-free except one real
fork start/stop lifecycle test, skipped automatically where `anvil` isn't on `PATH`.

## RPC configuration

RPC URLs are resolved by `packages/cli/src/lib/chain.ts` `getRpcUrl(chainId)` in this order (first match wins):

1. `.sail/.env.local` — chain-specific var (e.g. `BASE_RPC_URL`, `ARBITRUM_RPC_URL`)
2. `.sail/.env.local` — generic `RPC_URL`
3. Shell environment — chain-specific var
4. Shell environment — generic `RPC_URL`

Two valid patterns for `.sail/.env.local`:

```
# Option A — single active chain
RPC_URL=https://your-base-endpoint
CHAIN_ID=8453
```

```
# Option B — per-chain (multi-chain projects; omit RPC_URL if all chains have a specific var)
CHAIN_ID=8453
BASE_RPC_URL=https://your-base-endpoint
ARBITRUM_RPC_URL=https://your-arbitrum-endpoint
UNICHAIN_RPC_URL=https://your-unichain-endpoint
ETH_MAINNET_RPC_URL=https://your-mainnet-endpoint
BASE_SEPOLIA_RPC_URL=https://your-base-sepolia-endpoint
SEPOLIA_RPC_URL=https://your-sepolia-endpoint
```

Per-chain vars always take precedence for their specific chain, so multi-chain projects resolve each endpoint correctly. `sailor chains --verify` uses this to check every chain that has a configured RPC.

## Sandbox

Named **Shipyard** in the interface and in user-facing docs (see `docs/shipyard.md`); "sandbox"
stays the command and the internal vocabulary. `sailor sandbox start` (alias `sailor shipyard`)
and the dashboard's Shipyard links both start a
**second, independent** `packages/ui/server.js` process — same code, different root and port —
rather than a mode flag on the live server. Two directories, never one:

| | Live | Sandbox |
|---|---|---|
| Root | `<project>/.sail/` | `<project>/.shipyard/sandbox/` |
| Port | deterministic per-project (`projectPort`, 3333–3999) | `projectPort` salted with `:sandbox` |
| Runtime file | `.sail/runtime/ui.json` | `.shipyard/sandbox/runtime/ui.json` |
| Chains | real RPCs the owner configures | up to `MAX_SANDBOX_CHAINS` (3) native anvil forks, chain ID preserved |

`startServer(sailDir, { mode })` (`packages/ui/server.js`) only registers `/api/sandbox/*`
(fork start/status/reset) when `mode === 'sandbox'` — the live server never has that code path at
all. `GET /api/mode` reports which one a given page is talking to; the frontend never infers this
from a client-side flag. `POST /api/sandbox/launch` (live → sandbox) and `POST /api/sandbox/exit`
(sandbox → live) each self-spawn the other server on demand (or find it already running via its
runtime file) and hand the browser its port to navigate to — see `ensurePeerServerRunning` in
server.js and the mirrored `runUiCommand`/`sandboxUiCommand` split in
`packages/cli/src/commands/ui.ts`.

`@sail/sandbox` (`packages/sandbox`) owns the fork engine itself (ported from the external
Shipyard harness tool's `lib/sim.ts`, viem test-client actions instead of shelling out to `cast`).
`anvil` on `PATH` is the only external requirement.

## Conventions

- `SAIL_DIR` — env var pointing to the project's `.sail/` directory (used by the UI server)
- `SAIL_PASSPHRASE` — unlocks `.sail/keys/manager.json` headlessly; read from `.sail/.env.local`
- `SERVE_DIST=1` — makes the UI server serve the built React app at `/`
- All CLI commands support `--json` for machine-readable output
- Addresses in `.sail/` files stored checksummed; bigints as decimal strings

## What NOT to do

- Do not change active kernel/mandateFactory/governance addresses without confirming on-chain state
- Do not use conjunctive EIP-712 type strings in new code
- Do not add new root-level markdown files to this repo
- Always run `pnpm build` before `pnpm test:ui`
- Do not commit `SAIL_PASSPHRASE` or private keys
