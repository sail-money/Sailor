# Mandates

Solidity permission contracts live here. Each contract implements `@sail/interfaces/IPermission.sol`.
The SailKernel calls `evaluate(txData, ctx)` before any manager dispatch. Return `true` to permit,
`false` to block.

## Workflow

```bash
forge build
sailor mandate prepare
sailor ui
```

Keep all policy parameters constructor-configured so each deployment has a complete, reviewable
policy before it is attached to the SMA.
