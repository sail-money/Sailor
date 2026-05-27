# Custom Mandate — Sail Protocol

This template is for teams that need custom on-chain permission logic beyond what the standard
mandate set provides.

## What this is

A Foundry workspace pre-wired for SailProtocol's `IPermission` interface. Write your contract in
`mandates/`, compile with `forge build`, then deploy and register it against your SMA.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- An existing Sailor agent (created with `sailor init`)

## Workflow

```bash
forge build                   # compile mandates/
sailor mandate prepare        # generate deployment calldata
sailor ui                     # sign and register via browser wallet
```

## Structure

- `foundry.toml` — Foundry config with `@sail/` remapping to `.sail/contracts/`
- `.sail/contracts/interfaces/IPermission.sol` — interface copy (matches SailProtocol)
- `mandates/AllowlistTargetMandate.sol` — example: restrict calls to an allowlisted set of targets
