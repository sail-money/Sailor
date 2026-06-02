# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Scope — read first.** This is the **Sailor toolkit/monorepo**, for people developing
> Sailor itself. End users do **not** work here: they scaffold a project with `sailor init`
> and operate in *that* folder, guided by its own `AGENTS.md` → which is the canonical agent
> doc. If you are setting up or running an agent (not developing the toolkit), open a
> scaffolded project instead of this repo.
>
> The **`sail` CLI** mentioned under "Related Tooling" below is a **separate sibling tool**
> from the SailFramework repo — it is *not* the `sailor` CLI shipped here. The operator CLI
> in this repo is `sailor` (`sailor doctor`, `sailor capabilities`, `sailor init`, …). Don't
> conflate the two.

## Purpose

`Sailor` is a toolkit for building and operating Sail Protocol onchain SMAs run by agents. It sits alongside two sibling repos:

- **SailProtocol** — the Solidity kernel (~590 lines). Handles Safe-based SMA instantiation, permission registry, manager dispatch, fee accounting, and principal tracking. Not upgraded; all policy logic lives in user-deployed `IPermission` contracts.
- **SailFramework** — TypeScript monorepo (`@sail/sdk`, `@sail/framework`, `@sail/studio`). Owns project authoring, policy DSL, permission template generation, fork rehearsal, the `sail` CLI, and Studio UI.

This repo is the operator-facing layer: tooling for agents and managers who execute within registered permissions, rather than for developers deploying the protocol or authoring new policy templates.

## Sail Protocol Primer

The protocol separates three roles:

| Role | Authority |
|------|-----------|
| **Owner** | Holds the Safe; custody anchor |
| **Permission Signer** | Authorizes the mandate (which `IPermission` contracts apply) via EIP-712 |
| **Manager** | Executes transactions within bounds; verified via ECDSA or ERC-1271 |

Manager dispatch goes through `SailKernel.dispatch()`, which calls `evaluate(txData, ctx)` on each registered `IPermission` via `staticcall` with a 100k gas cap. A permission revert or gas overage is treated as `false`, not a kernel revert.

`IPermission` interface (from SailProtocol):
```solidity
interface IPermission {
    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool);
    function discriminator() external view returns (bytes32);
}

struct Context {
    address account;   // the Safe
    address manager;   // the delegated signer
    address target;    // call target
    bytes4  selector;  // call selector
    uint256 value;     // msg.value
}
```

## Related Tooling

The `sail` CLI (installed from SailFramework) is the primary local operator tool:

```bash
sail doctor --project . --json          # readiness check
sail agent readiness <agent> --project . --json
sail mandate check <agent> --project .
sail operation prepare protocol-setup --agent <agent> --chain base --project .
sail start --project .
```

Install or update the CLI from the SailFramework checkout:
```bash
cd ~/SailFramework && git pull && ./install-sail
```

## Packages

- `packages/sdk` (`@sail/sdk`) — `SailorClient` (account/mandate/dispatch/session/fees/principal), `LocalKeyring`, kernel + governance ABIs, permission templates, and the onboarding primitives: signing-handoff types, the bundled deployment registry (`getSailDeployment` for Base / Base Sepolia / Arbitrum / Unichain), Safe setup initializer, `RegisterPermission` EIP-712 builder, and `estimatePermissionFee`.
- `packages/cli` (`sailor`) — commands: `init [dir] [--template]`, `keys`, `account`, `mandate (prepare|sign|deploy|attach|templates|list)`, `onboard`, `station (start|status|stop)`, `owner (connect|show)`, `scan`, `run`, `session`, `status`, `ui (start|stop|status)`. The `signing/` module is a local HTTP + WebSocket daemon bridging the agent and the browser wallet.
- `packages/ui` (`sailor-ui`) — React dashboard + browser-driven onboarding wizard + the signing station at `#/station`.
- `packages/chains` (`@sail/chains`) — per-chain registry.

## User onboarding flow

When a user installs sailor (`npm install sailor`) and opens their project, the full setup journey is **8 steps**:

### Steps 1–4 — handled by the browser wizard (`sailor ui start` → `#/signing`)

1. **Choose network** — Base, Arbitrum One, Ethereum, Unichain (+ their Sepolia testnets)
2. **Connect wallet** — owner wallet via RainbowKit; this wallet owns the Safe and signs mandates
3. **Create agent key** — generates an encrypted keystore at `.sail/keys/manager.json`; passphrase becomes `SAIL_PASSPHRASE`
4. **Deploy Safe** — calls `SailKernel.createAccount` via wagmi; writes `.sail/account.json`

The Done screen generates a copy-ready AI prompt covering steps 5–8, which the user pastes into their AI chat to continue.

### Steps 5–8 — terminal, with AI help

5. **Configure RPC & API keys** — add to `.sail/.env.local`:
   ```
   RPC_URL=https://...          # RPC endpoint for chosen chain
   SAIL_API_KEY=...             # from api.sail.money
   SAIL_PASSPHRASE=...          # set during step 3
   ```
6. **Fund agent key** — send ETH to the manager address (shown on dashboard) for gas
7. **Set permissions (mandate)** — `sailor mandate prepare` → opens browser signing page → sign EIP-712
8. **Start agent** — `sailor run`

## UI server

`sailor ui start` starts a detached Express server on port 3333. It reads project state from the `.sail/` directory and serves:

- `GET /api/overview` — SMA + mandate + signer balances (on-chain read, snapshot-cached)
- `GET /api/activity` — decision journal from `activity.jsonl`
- `GET /api/positions` — latest vault positions from `state/positions-<chainId>.json`
- `GET /api/agent-status` — PID check + `activity.jsonl` recency (detects remote/CI agents)
- `GET|POST /api/onboard/state|generate-key|build-create-tx|complete|save-config` — wizard endpoints
- `GET /api/station/pending` — proxy to signing daemon (authenticated via `x-sailor-secret`)
- `WS /api/station/ws` — WebSocket proxy relay to daemon (holds secret server-side)

The server is started with `SERVE_DIST=1` to serve the built UI at `/`. PID tracked at `.sail/runtime/ui.json`.

## Testing

```bash
pnpm test          # vitest API tests (29 tests, ~1.3s, no blockchain needed)
pnpm test:ui       # Playwright UI smoke tests (11 tests, needs pnpm build first)
```

Tests use isolated fixture directories (`packages/ui/test/fixtures/`) with pre-canned `.sail/` state. The `onboarded/` fixture includes a pre-built overview snapshot so no RPC is needed.

## Agent onboarding & custom mandates

The agent never holds the owner key. For owner-authorized actions it pushes a signing request to the signing station (`sailor station start`, or an ephemeral per-command server) and the owner approves it in the browser:

- **create-sma** — transaction submitted by the owner's wallet via the wizard or `sailor onboard`
- **register-permission** — a `RegisterPermission` EIP-712 message the owner signs off-chain; the agent (manager key) then submits `kernel.registerPermission(account, permission, sig)` with the exact fee from `estimatePermissionFee`

Mandates are authored as Foundry contracts under `mandates/` (scaffolded by `sailor init`) and must be fully configured by their constructor. Every command supports `--json`; `SAIL_PASSPHRASE` unlocks the manager key headlessly.
