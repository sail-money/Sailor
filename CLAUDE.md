# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

`sail-operator` is a toolkit for building and operating Sail Protocol onchain SMAs run by agents. It sits alongside two sibling repos:

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

Repository is in initial setup. No source code exists yet.
