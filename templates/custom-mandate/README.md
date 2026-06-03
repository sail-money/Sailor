# Write Your Own Permission — Sail Protocol

Sail Protocol accepts ANY contract implementing `IPermission`. There is no fixed set of
permission types. `BoundedCallPermission` here is a general primitive; `examples/permissions/`
shows protocol-specific patterns. Every financial bound your mandate enforces should live in
Solidity — the kernel checks `evaluate()` on every dispatch. The agent's TypeScript can be changed
without your signature; the permission contract cannot. You own what you deploy.

---

Sailor does not ship a blessed library of financial permission contracts. You author, review, and
deploy your own `IPermission` contract, and Sailor makes deploying and registering it easy.

## What a permission contract is

A permission contract is an on-chain policy that the SailKernel consults before it lets your agent
(the manager) execute any transaction from your SMA. On every dispatch the kernel calls
`evaluate(txData, ctx)` on each registered permission via `staticcall` — return `true` to allow the
call, `false` to block it. The contract holds your rules (allowed targets, size caps, token
allowlists, time windows, …) so the agent can only ever act inside the bounds you deployed.

## The IPermission interface

```solidity
interface IPermission {
    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool);
    function discriminator() external view returns (bytes32);
}

struct Context {
    address account;        // the SMA (Safe) the dispatch executes from
    address manager;        // the delegated signer authorized to dispatch
    address submitter;      // the address that submitted the dispatch transaction
    address target;         // the contract the call is directed at
    bytes4  selector;       // the 4-byte function selector being called
    uint256 value;          // msg.value (native asset) sent with the call
    uint256 blockTimestamp; // block.timestamp at evaluation
    uint256 blockNumber;    // block.number at evaluation
}
```

- `evaluate` — your policy. Return `true` to permit the call, `false` to block it. Runs under a
  100k-gas `staticcall`; a revert or gas overage is treated as `false`.
- `discriminator` — a stable `bytes32` name for your permission (e.g. `keccak256("MyMandate")`).

Keep all policy parameters constructor-configured so each deployment is a complete, reviewable
policy before it is attached to the SMA.

## Workflow

```bash
# 1. Write your contract in mandates/ (start from BoundedCallPermission.sol)
# 2. Compile
forge build

# 3. Deploy and attach in one step
sailor mandate deploy --contract <Name> --attach --sma <SMA>
```

Or deploy first and attach later (two-step):

```bash
sailor mandate deploy --contract <Name>            # prints the deployed address
sailor mandate attach --address <deployedAddress> --sma <SMA>
```

Both attach paths open the browser signing station so the owner authorizes the registration
(EIP-712 `RegisterPermission`); the agent submits the on-chain transaction.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- An existing Sailor agent (created with `sailor init`)

## Responsibility

> **You are responsible for the correctness of your permission logic. Sailor registers whatever
> contract address you provide. A bug can block all agent activity or authorize transactions you did
> not intend. Review carefully before attaching.**

## Structure

- `foundry.toml` — Foundry config with `@sail/` remapping to `.sail/contracts/`
- `.sail/contracts/interfaces/IPermission.sol` — interface copy (matches SailProtocol)
- `mandates/BoundedCallPermission.sol` — general primitive: allowlisted targets, optional selector filter, max ETH value
