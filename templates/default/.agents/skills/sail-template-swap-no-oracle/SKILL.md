---
name: sail-template-swap-no-oracle
description: Gate an SMA's DEX swaps for tokens that have NO oracle by REUSING the shared SwapPermissionNoOracle singleton (Protocol/contracts/templates/SwapPermissionNoOracle.sol) — register + configure, no per-SMA deploy. Use for a bounded swap mandate on Uniswap V3/V3-02/V2 (and forks) where no manipulation-resistant price feed exists: router + token-in/out allowlists, a per-tx cap, recipient pinned to the SMA, and a per-pair live-pool "hallucination band". NOT manipulation-resistant — if the token HAS an oracle use sail-template-swap instead; for the LI.FI aggregator use sail-lifi-swap. NOT YET DEPLOYED on any chain — reference-only until the singleton is deployed.
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires SwapPermissionNoOracle deployed on the target chain (recorded in sail-templates/deployed.json); run sail-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/SwapPermissionNoOracle.sol
---

# sail-template-swap-no-oracle — bounded DEX swap for oracle-less tokens

Reuse the shared **`SwapPermissionNoOracle`** singleton instead of authoring/deploying a swap
contract. Register its address on the SMA and `configure()` your routers, token allowlists, cap,
and a **reference pool per tradeable pair**. Family overview + flow:
[`sail-templates`](../sail-templates/SKILL.md). For the oracle-gated tier see
[`sail-template-swap`](../sail-template-swap/SKILL.md).

> ⚠️ **NOT YET DEPLOYED.** As of `deployed.json` (2026-06-23), `SwapPermissionNoOracle` is **not
> deployed on any chain** — the catalog reports it as "not yet on any tracked chain" and there
> is no usable address. This skill is **reference-only** until the singleton is deployed and its
> address recorded in `deployed.json`. Until then, use [`sail-template-swap`](../sail-template-swap/SKILL.md)
> where an oracle exists, or author a bespoke permission via `sailor mandate deploy`.

> ⚠️ **Pick the right tier.** This template provides **NO manipulation-resistant slippage
> protection**. Its price band reads a *single pool's live spot price*, which any party can move
> within the same transaction (flash-loan / sandwich / MEV). It only catches an **honest mistake**
> — a confused manager/agent quoting a wildly wrong number (a "hallucination guard"). If the token
> has an independent, freshness-checked price feed, use [`sail-template-swap`](../sail-template-swap/SKILL.md)
> instead. Only reach for this when no such oracle exists.

## What it enforces (per account, from source)

Supported selectors (any other ⇒ `false`) — identical decode region to `SwapPermission`:

| Selector | Function | Venue |
|---|---|---|
| `0x414bf389` | `exactInputSingle((tokenIn,tokenOut,fee,recipient,deadline,amountIn,amountOutMinimum,sqrtPriceLimitX96))` | Uniswap V3 SwapRouter |
| `0x04e45aaf` | `exactInputSingle((tokenIn,tokenOut,fee,recipient,amountIn,amountOutMinimum,sqrtPriceLimitX96))` | Uniswap V3 SwapRouter02 |
| `0x38ed1739` | `swapExactTokensForTokens(amountIn,amountOutMin,path[],to,deadline)` | Uniswap V2 Router |

Structural invariants: `target ∈ routers`; `tokenIn`/`path[0] ∈ tokensIn`; `tokenOut`/`path[last]
∈ tokensOut`; `recipient`/`to == SMA` (funds can't leave the account); `amountIn ≤ maxAmountPerTx`.

**Price band (the only difference from `SwapPermission`):** for the swap's `(tokenIn, tokenOut)`
pair, read the live spot price of the operator-named reference pool and require
`amountOutMin ≥ expectedOut × (10_000 − toleranceBps)/10_000` **and** `amountOutMin > 0`. Fails
closed (denies) if the pool is missing, unreadable, illiquid, doesn't price the pair, or the floor
truncates to zero.

> **V2 intermediate hops are NOT checked** — only `path[0]`/`path[last]`. Restrict to V3 or ensure
> any plausible intermediate token is acceptable. Does NOT cover Universal Router, Uniswap V4, or
> aggregators (opaque calldata).

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(address[] routers, address[] tokensIn, address[] tokensOut,
           uint256 maxAmountPerTx, ReferencePool[] referencePools)

struct ReferencePool { address tokenIn; address tokenOut; address pool;
                       PoolKind kind /* 0=V2, 1=V3 */; uint256 toleranceBps; }
```
| Field | Notes |
|---|---|
| `routers` | DEX routers the agent may call |
| `tokensIn` / `tokensOut` | sell-side / buy-side allowlists |
| `maxAmountPerTx` | per-swap cap, base units (e.g. `25_000_000` = 25 USDC) |
| `referencePools` | one per directional `(tokenIn, tokenOut)` pair — see coverage rule below |
| `ReferencePool.pool` | a V2 pair or V3 pool that actually prices the pair (validated at configure) |
| `ReferencePool.kind` | `0` = V2 (`getReserves`), `1` = V3 (`slot0`+`liquidity`) |
| `ReferencePool.toleranceBps` | band width, **≤ 5_000 (50%)** or configure reverts. e.g. `1_000` = 10% |

**Strict coverage rule:** `configure()` reverts `MissingReferencePool` unless every non-self
directional combination of `tokensIn × tokensOut` has a `ReferencePool`. The pool's
`token0()`/`token1()` must match the pair (orientation is precomputed at configure time), else it
reverts `PoolTokenMismatch`. `pool == 0` reverts `ZeroPool`.

Size the cap with `uniswap-v3-quote`. Verify the SDK encoder's param tuple matches the source blob
above before using it (see [`sail-templates`](../sail-templates/SKILL.md) notes).

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sail-templates` reuse-flow](../sail-templates/references/reuse-flow.md) — follow it.
`sailor mandate attach` registers only; `configureDirect` (owner tx) is the half that makes the
permission live.

> **Prerequisite:** `SwapPermissionNoOracle` must be deployed on the target chain first (see the
> not-deployed warning above) and recorded in `deployed.json`.

Template-specific bits:

- **Singleton:** `SwapPermissionNoOracle` — `node SKILLS/sail-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** sell/buy tokens, per-swap cap, router/fee tier, recipient = SMA, and for each
  pair the reference pool + tolerance. **Explicitly confirm the no-oracle trade-off** with the user:
  this is a hallucination guard, not slippage/manipulation protection.
- **Blob:** `abi.encode(routers[], tokensIn[], tokensOut[], maxAmountPerTx, ReferencePool[])` —
  **flat params, no wrapper**; `ReferencePool{tokenIn, tokenOut, pool, kind, toleranceBps}`.
- **Simulate (mandatory — unaudited example):** an allowed swap passes; wrong recipient, over-cap,
  disallowed token, and an `amountOutMin` below the pool-implied floor are rejected.

## Notes
- The band is **not** manipulation-resistant — re-state this whenever authorizing. Prefer
  [`sail-template-swap`](../sail-template-swap/SKILL.md) wherever an oracle exists.
- `toleranceBps` is capped at 50% in source; a wider band is meaningless and rejected at configure.
- Unaudited example — step 4 is mandatory.
- Aggregator routing (opaque calldata) → [`sail-lifi-swap`](../sail-lifi-swap/SKILL.md).
