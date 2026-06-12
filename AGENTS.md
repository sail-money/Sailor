# Sailor — Codebase Guide

This guide is for contributors to the Sailor codebase. The user-facing agent guide ships in templates/default/AGENTS.md.

Sailor is the operator toolkit for Sail Protocol. It does **not** deploy the protocol or author
permission templates — it targets already-deployed SailKernel instances and gives operators the
tooling to create SMAs, register permission contracts, and run strategy agents.

## Repo structure

| Package / path | Name | Role |
|---|---|---|
| `packages/sdk` | `@sail/sdk` | SailorClient, LocalKeyring, kernel ABIs, EIP-712 builders, deployment registry, per-chain address registry |
| `packages/cli` | `sailor` | CLI: init, keys, account, mandate, onboard, station, ui, run, session, scan, status, owner, doctor, capabilities |
| `packages/ui` | `sailor-ui` | Local dashboard + browser-driven onboarding wizard (per-project port, 3333–3999) |
| `templates/default` | — | Default agent starter: neutral blank scaffold + Foundry workspace + onboarding guide (AGENTS.md) |
| `examples/custom-mandate` | — | Solidity reference: IPermission scaffold (not a project template) |

## Protocol roles

The code uses internal identifiers that differ from user-facing terms:

| User-facing term | Code identifier | Meaning |
|---|---|---|
| Owner | `owner` | Holds the Safe; custody anchor; never touches the agent runtime |
| Mandate signer | `permissionSigner` | Authorizes permission registration via EIP-712 |
| Agent wallet | `manager` | Signs dispatches; key at `.sail/keys/manager.json` |

Use the user-facing terms in all CLI output, prompts, and errors. The code identifiers are internal.

## Dispatch model

All six chains share the same kernel at the same CREATE2 address, verified on-chain via `DISPATCH_TYPEHASH()`:

| Kernel (all 6 chains) | Model | DISPATCH_TYPEHASH |
|---|---|---|
| `0x02ABC18B65A328de2e749F56ba79ACF2718a6659` | **selective** | `0xbe50c539...` |

Supported chains: Ethereum (1), Base (8453), Arbitrum (42161), Unichain (130), Base Sepolia (84532), Eth Sepolia (11155111).

All six kernels are live and bootstrapped (genesis allowlist set, `createAccount` verified working, zero fees). No templates are deployed against the current kernel on any chain yet — `knownTemplates` and `standaloneTemplates` are empty for all six entries. `packages/sdk/src/deployments.ts` is the canonical source of truth for kernel addresses, templates, and metadata.

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

All six chain records in `packages/sdk/src/deployments.ts` are live — no commented-out or pending
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
| `packages/cli/src/commands/mandate-contracts.ts` | Deploy / attach / revoke permission contracts |
| `packages/cli/src/lib/mandates.ts` | `MandateStore` — `.sail/state/mandates.json` source of truth |
| `packages/ui/server.js` | Local API + WebSocket proxy; signing station relay |

## Build

```bash
pnpm install
pnpm build        # builds all packages; dependency order: sdk → cli → ui
```

Build order matters — `cli` imports from `sdk`.

## Test

```bash
pnpm test         # vitest — no chain needed, ~1.3s
pnpm test:ui      # playwright — requires pnpm build first
```

Test fixtures live in `packages/ui/test/fixtures/` — isolated directories with pre-canned `.sail/`
state; no real RPC needed.

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
