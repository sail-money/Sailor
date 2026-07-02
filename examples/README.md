# examples/

Reference material for building Sail permission contracts. Nothing here is part of
Sail Protocol and nothing here is audited.

## What's in here

### `permissions/`

Protocol-specific permission examples (Uniswap, Aave, GMX, Vault, Pendle, and others).
These are copied into your project by `sailor init` so you have local starting points to
adapt. They are not a supported or exhaustive library — review them before using.

### `custom-mandate/`

A standalone Foundry workspace scaffold for authoring your own `IPermission` contract as a
separate project. Fork it, rename it, and build from `BoundedCallPermission.sol`.
