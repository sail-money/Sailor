# LiFi clone-permission templates

Canonical source (for reference) of the EIP-1167 **clone** permission templates
used for LiFi-based swaps/DCA. The logic contracts are deployed once per chain and
registered in the SDK deployment registry
(`packages/sdk/src/deployments.ts` → `standaloneTemplates` / `cloneTemplates`).
Each account gets its own clone via `PermissionFactory.deployAndAttach`, configured
through `initialize()` (never the constructor).

These follow the `CloneInitializable` pattern: the constructor calls
`_disableInitializers()` to permanently lock the logic contract, and a one-time
`initialize()` (guarded by the `initializer` modifier) configures each clone.

> The `import` paths reference `../../.sail/contracts/{interfaces,templates/base}`
> from the Foundry project they were built in
> (`tests/base-mainnet-agent-01/`). This folder is **reference source** — sailor has
> no Foundry build. Build/deploy happens in that project via
> `scripts/deploy-clone-templates.ts`.

> **Note:** The kernels bundled in `@sail/sdk` (Base, Base Sepolia, Arbitrum) now all run the **selective** dispatch model — verified on-chain against each kernel's `DISPATCH_TYPEHASH`. These templates were written for the older conjunctive model and include pass-through logic (`return true` for calls outside their domain) that is not required on selective kernels. Review before deploying against a selective kernel; the pass-through logic is harmless but unnecessary.

## Contracts

### LifiDiamondSwapPermissionCloneable → `boundedLiFi`
Restricts manager swaps to the official LiFi Diamond:
target == diamond, selector allowlisted, embedded receiver == `ctx.account`,
`minAmount <= maxMinAmountPerTx`. Passes through any call whose target is not the
diamond (conjunctive-kernel rule).

`initialize(bytes4[] allowedSelectors, uint256 maxMinAmountPerTx, address permissionSigner)`

### LifiBoundedApprovePermissionCloneable → `boundedApprove`
Approve only the LiFi Diamond, only on tokens with a configured cap, up to that
cap. **Per-token caps** (`mapping(token => cap)`) because token value/decimals
differ (1 DAI = 1e18 vs 1 USDC = 1e6). Passes through non-approve calls.

`initialize(address[] tokens, uint256[] caps, address permissionSigner)`

## Deployed logic addresses

| Template | Chain | Address |
|---|---|---|
| boundedLiFi | Base mainnet (8453) | `0xF1abcF774250fD1A8147B56DA07Bf9021064650A` |
| boundedApprove | Base mainnet (8453) | `0x9c0b86daf9e75d759a5D165aD7366e52b3353fD8` |

Both verified `initialized() == true` (logic locked) post-deploy.

## Conjunctive-kernel note

Both Base kernels use the **conjunctive** dispatch model: every registered
permission is evaluated and ALL must return true. So a permission MUST pass through
calls outside its own domain (return `true`), or it bricks unrelated dispatches.
Both templates above do this.
