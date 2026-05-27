# Mandates

Solidity permission contracts for this Sailor agent live here.

A mandate implements `@sail/interfaces/IPermission.sol`. The kernel calls
`evaluate(txData, ctx)` before the manager's dispatch executes. Return `true`
to permit the call and `false` to block it.

## Workflow

```bash
forge build
sailor mandate prepare
sailor ui
```

Configure mandates through constructors so each deployment has a complete,
reviewable policy before it is attached to the SMA.
