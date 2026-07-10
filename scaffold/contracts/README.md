# Write Your Own Permission — Sail Protocol

Sail Protocol accepts ANY contract implementing `IPermission`. There is no fixed set of
permission types. `BoundedCallPermission` here is a general, protocol-agnostic primitive —
extend it with calldata-specific checks for the venue at hand (see the `sailor-mandates` skill's
authoring-patterns reference for the method and named gotchas). Every financial bound your
mandate enforces should live in Solidity — the kernel checks `evaluate()` on every dispatch. The
agent's TypeScript can be changed without your signature; the permission contract cannot. You own
what you deploy.

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
    uint256 configEpoch;    // kernel registrationEpoch(account, permission) at dispatch;
                            // ignore it unless your permission takes post-deploy configuration
}
```

- `evaluate` — your policy. Return `true` to permit the call, `false` to block it. Runs under a
  150,000-gas `staticcall` (`SailKernel.PERMISSION_GAS_CAP`); a revert or gas overage is treated
  as `false`.
- `discriminator` — a stable `bytes32` name for your permission (e.g. `keccak256("MyMandate")`).

Keep all policy parameters constructor-configured so each deployment is a complete, reviewable
policy before it is registered on the SMA.

## Workflow

```bash
# 1. Write your contract in mandates/ (start from BoundedCallPermission.sol)
# 2. Compile
forge build

# 3. Deploy
sailor mandate deploy --contract <Name>            # prints the deployed address
```

Prove it before you authorize it — simulate against calls the permission MUST accept and calls it
MUST reject (off-chain `eth_call`, no gas, signs nothing):

```bash
sailor mandate simulate --address <deployedAddress> --calls calls.json
```

Only once simulate is clean should you register:

```bash
sailor mandate register --address <deployedAddress> --sma <SMA>
```

To register several permissions, deploy (and simulate) each one first, then register them all in
a single signature by passing a comma-separated list:

```bash
sailor mandate register --address <addr1>,<addr2>,<addr3> --sma <SMA>
```

These register commands open the browser signing page so the owner authorizes the registration
(EIP-712 `RegisterPermission`); the agent submits the on-chain transaction.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- An existing Sailor agent (created with `sailor init`)

## Responsibility

> **You are responsible for the correctness of your permission logic. Sailor registers whatever
> contract address you provide. A bug can block all agent activity or authorize transactions you did
> not intend. Review carefully before registering.**

## Extracting calldata parameters safely

When you need to bound a specific call argument (amount cap, recipient check, slippage floor),
use `SailCalldata` instead of manual `abi.decode`. The two common bugs it prevents:

1. **Forgetting the length check** — decoding before checking `txData.length` can revert or
   silently return wrong values. `SailCalldata.hasParams(txData, N)` is the one-line guard.
2. **Wrong slot index** — off-by-one decodes the wrong parameter. Named helpers make the
   intent explicit: `asAddress(txData, 0)`, `asUint256(txData, 1)`, `asAddress(txData, 2)`.

```solidity
import {SailCalldata} from "./SailCalldata.sol";

function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
    if (ctx.target != POOL)        return false;
    if (ctx.selector != SEL_SUPPLY) return false;
    // supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
    if (!SailCalldata.hasParams(txData, 4)) return false;
    address asset      = SailCalldata.asAddress(txData, 0);
    uint256 amount     = SailCalldata.asUint256(txData, 1);
    address onBehalfOf = SailCalldata.asAddress(txData, 2);
    // ...
}
```

Available helpers: `asAddress`, `asUint256`, `asInt256`, `asBytes32`, `asBool`,
`asUint128`, `asUint64`, `asUint32`, `asUint24`, `asUint16`, `asBytes4`.
Only covers static (fixed-size) types. For `bytes`, `string`, or dynamic arrays,
use `abi.decode(txData[4:], ...)` after the `hasParams` guard.

## Structure

- `foundry.toml` — Foundry config with `@sail/` remapping to `.sail/contracts/`
- `.sail/contracts/interfaces/IPermission.sol` — interface copy (matches SailProtocol)
- `mandates/BoundedCallPermission.sol` — general primitive: allowlisted targets, optional selector filter, max ETH value
- `mandates/SailCalldata.sol` — safe calldata parameter extraction helpers
- `test/BoundedCallPermission.t.sol` — Foundry test scaffold; copy it for each permission you author (see Gate 4 in the `sailor-mandates` skill)
