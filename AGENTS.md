# Sailor — Codebase Guide

Sailor is the operator toolkit for Sail Protocol. It does **not** deploy the protocol or author
permission templates — it targets already-deployed SailKernel instances and gives operators the
tooling to create SMAs, register permission contracts, and run strategy agents.

## Repo structure

| Package / path | Name | Role |
|---|---|---|
| `packages/sdk` | `@sail/sdk` | SailorClient, LocalKeyring, kernel ABIs, EIP-712 builders, deployment registry |
| `packages/cli` | `sailor` | CLI: init, keys, account, mandate, onboard, station, ui, run, session, scan, doctor |
| `packages/chains` | `@sail/chains` | Per-chain address registry (kernel, mandateFactory, governance) |
| `packages/ui` | `sailor-ui` | Local dashboard + browser-driven onboarding wizard at localhost:3333 |
| `templates/dca-rebalancer` | — | Default project scaffold: DCA rebalancer + Foundry workspace |
| `templates/custom-mandate` | — | Solidity reference: IPermission scaffold (not a project template) |

## Protocol roles

The code uses internal identifiers that differ from user-facing terms:

| User-facing term | Code identifier | Meaning |
|---|---|---|
| Owner | `owner` | Holds the Safe; custody anchor; never touches the agent runtime |
| Mandate signer | `permissionSigner` | Authorizes permission registration via EIP-712 |
| Agent wallet | `manager` | Signs dispatches; key at `.sail/keys/manager.json` |

Use the user-facing terms in all CLI output, prompts, and errors. The code identifiers are internal.

## Dispatch model

Active kernels vary by chain — verified on-chain via `DISPATCH_TYPEHASH()`:

| Chain | Kernel | Model | DISPATCH_TYPEHASH |
|---|---|---|---|
| Base 8453 | `0xbEd6F78c6d89547Fb9B43d599621dd80ce57F154` | **conjunctive** | `0x7510c80e...` |
| Base Sepolia 84532 | `0x7d3BDAAB150af93f057C38e9baef88061B17dE1D` | **conjunctive** | `0x7510c80e...` |
| Arbitrum 42161 | `0xD985029960a9B7C2E7E38e102C448b8b8539B156` | **selective** | `0xbe50c539...` |

The PENDING (post-Octane redeploy) kernels — commented out in `deployments.ts` and `chains/src/index.ts`
— implement the **selective** model but are NOT usable until timelock allowlists are set.

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

Canonical addresses are kept in sync across two files:

- `packages/chains/src/index.ts` — `ChainConfig` per chainId
- `packages/sdk/src/deployments.ts` — `SailDeployment` with full deployment metadata

**PENDING** (post-Octane redeploy) addresses exist as **commented blocks only** in both files.
Do not activate them. `createAccount()` reverts on PENDING kernels until timelock allowlists are
populated. Only activate when explicitly instructed and after confirming allowlists are live.

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
pnpm build        # builds all packages; dependency order: sdk → chains → cli → ui
```

Build order matters — `cli` imports from `sdk` and `chains`.

## Test

```bash
pnpm test         # vitest — no chain needed, ~1.3s
pnpm test:ui      # playwright — requires pnpm build first
```

Test fixtures live in `packages/ui/test/fixtures/` — isolated directories with pre-canned `.sail/`
state; no real RPC needed.

## Conventions

- `SAIL_DIR` — env var pointing to the project's `.sail/` directory (used by the UI server)
- `SAIL_PASSPHRASE` — unlocks `.sail/keys/manager.json` headlessly; read from `.sail/.env.local`
- `SERVE_DIST=1` — makes the UI server serve the built React app at `/`
- All CLI commands support `--json` for machine-readable output
- Addresses in `.sail/` files stored checksummed; bigints as decimal strings

## What NOT to do

- Do not change active kernel/mandateFactory/governance addresses without confirming on-chain state
- Do not activate PENDING addresses until timelock allowlists are confirmed live
- Do not use conjunctive EIP-712 type strings in new code
- Do not add new root-level markdown files to this repo
- Always run `pnpm build` before `pnpm test:ui`
- Do not commit `SAIL_PASSPHRASE` or private keys
