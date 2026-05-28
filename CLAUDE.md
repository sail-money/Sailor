# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Status

Implemented as a pnpm monorepo:

- `packages/sdk` (`@sail/sdk`) — `SailorClient` (account/mandate/dispatch/session/fees/principal), `LocalKeyring`, kernel + governance ABIs, permission templates, and the onboarding primitives: signing-handoff types, the bundled deployment registry (`getSailDeployment` for Base / Base Sepolia / Arbitrum), Safe setup initializer, `RegisterPermission` EIP-712 builder, and `estimatePermissionFee` (legacy `baseFee + byteLength*complexityRate` model, capped, with a flat-fee fallback).
- `packages/cli` (`sailor`) — commands: `init`, `keys`, `account`, `mandate (prepare|sign|deploy|attach|templates|list)`, `onboard`, `station (start|status|stop)`, `owner (connect|show)`, `scan`, `run`, `session`, `status`, `ui`. The `signing/` module is a local HTTP + WebSocket daemon bridging the agent and the browser wallet.
- `packages/ui` (`sailor-ui`) — React dashboard + the signing station at `#/station` (auto-shown when served by the daemon on ports 3141–3150).
- `packages/chains` (`@sail/chains`) — per-chain registry, empty until mainnet launch.

### Agent onboarding & custom mandates

The agent never holds the owner key. For owner-authorized actions it pushes a signing request to the signing station (`sailor station start`, or an ephemeral per-command server) and the owner approves it in the browser:

- **create-sma / deploy-mandate** — transaction requests submitted by the owner's wallet. A `deploy-mandate` request has no `to`: it is a contract-creation tx whose `data` is the compiled mandate's creation bytecode; the deployed address comes from `receipt.contractAddress` and is tracked in `.sail/state/mandates.json`.
- **register-permission** — a `RegisterPermission` EIP-712 message the owner signs off-chain; the agent (manager key) then submits `kernel.registerPermission(account, permission, sig)` with the exact fee from `estimatePermissionFee`.

Mandates are authored as Foundry contracts under `mandates/` (scaffolded by `sailor init`) and must be fully configured by their constructor, so one deploy tx + one attach signature completes setup. Every command supports `--json`; `SAIL_PASSPHRASE` unlocks the manager key headlessly.
