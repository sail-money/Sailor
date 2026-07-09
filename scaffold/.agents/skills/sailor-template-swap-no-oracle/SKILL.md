---
name: sailor-template-swap-no-oracle
description: Gate an SMA's DEX swaps for a token without a price oracle by REUSING the shared SwapPermissionNoOracle singleton (Protocol/contracts/templates/SwapPermissionNoOracle.sol) — register + configure, no per-SMA deploy. Use when there is no Chainlink feed / no price feed / no oracle adapter for the token, on Uniswap V3/V3-02/V2 (and forks): router + token-in/out allowlists, a per-tx cap, recipient pinned to the SMA, and a per-pair live-pool "hallucination band". NOT manipulation-resistant — if the token HAS an oracle use sailor-template-swap instead; for the LI.FI aggregator author a bespoke permission via sailor-mandates. Deployed on all 11 Sailor-bundled chains (recorded in sailor-templates/deployed.json).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires SwapPermissionNoOracle deployed on the target chain (recorded in sailor-templates/deployed.json); run sailor-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/SwapPermissionNoOracle.sol
---

# sailor-template-swap-no-oracle — bounded DEX swap for oracle-less tokens

You typically arrive here from the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) with a complete strategy spec — this spoke covers the bounded-swap permission of that plan for a token with no oracle adapter.

Reuse the shared **`SwapPermissionNoOracle`** singleton instead of authoring/deploying a swap
contract. Register its address on the SMA and `configure()` your routers, token allowlists, cap,
and a **reference pool per tradeable pair**. Family overview + flow:
[`sailor-templates`](../sailor-templates/SKILL.md). For the oracle-gated tier see
[`sailor-template-swap`](../sailor-template-swap/SKILL.md).

> ⚠️ **Pick the right tier.** This template provides **NO manipulation-resistant slippage
> protection**. Its price band reads a *single pool's live spot price*, which any party can move
> within the same transaction (flash-loan / sandwich / MEV). It only catches an **honest mistake**
> — a confused manager/agent quoting a wildly wrong number (a "hallucination guard"). If the token
> has an independent, freshness-checked price feed, use [`sailor-template-swap`](../sailor-template-swap/SKILL.md)
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

Size the cap with `sailor-swap-quote`. Verify the SDK encoder's param tuple matches the source blob
above before using it (see [`sailor-templates`](../sailor-templates/SKILL.md) notes).

### Worked example — small DCA into a token without a price oracle (Unichain)

A 10-USDC-per-tick DCA from USDC into a token that has no oracle adapter, using a live
V3 reference pool with a 10% tolerance band.

> ⚠️ **This band is NOT manipulation-resistant.** `toleranceBps: 1000` (10%) only catches an
> honest mis-quote against the pool's *live* spot price — a flash-loan/sandwich can move that spot
> within the same transaction. The 10% is deliberately loose to fit a thin pool; it is not slippage
> protection. Keep `maxAmountPerTx` small so a manipulated fill can only ever move a small amount.

`tokensIn` (USDC) and `routers` (Uniswap V3 SwapRouter02) are the verified Unichain continuity
addresses. The **oracle-less token and its reference pool vary per token** — resolve the token address
via [`sailor-token-resolve`](../sailor-token-resolve/SKILL.md) and confirm the pool actually prices
the pair on-chain before configuring; the placeholders below are not real addresses.

```json
{
  "routers":        ["0x73855d06DE49d0fe4A9c42636Ba96c62da12FF9C"],
  "tokensIn":       ["0x078D782b760474a361dDA0AF3839290b0EF57AD6"],
  "tokensOut":      ["0xILLIQUID_TOKEN_resolve_via_sailor-token-resolve"],
  "maxAmountPerTx": "10000000",
  "referencePools": [
    {
      "tokenIn":      "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
      "tokenOut":     "0xILLIQUID_TOKEN_resolve_via_sailor-token-resolve",
      "pool":         "0xREFERENCE_POOL_verify_it_prices_this_pair_onchain",
      "kind":         1,
      "toleranceBps": 1000
    }
  ]
}
```

`maxAmountPerTx: "10000000"` = 10 USDC (6 decimals). One `referencePools` entry is required per
directional pair (the strict-coverage rule above) — a portfolio into several oracle-less tokens needs
one entry each. Then register → configure → simulate:

```bash
sailor mandate register  --address <SWAP_NO_ORACLE> --sma <SMA> --label "bounded-swap-no-oracle"
sailor mandate configure --address <SWAP_NO_ORACLE> --sma <SMA> \
  --template SwapPermissionNoOracle --args-file ./swap-no-oracle-config.json
sailor mandate simulate  --address <SWAP_NO_ORACLE> --sma <SMA> --calls ./probe.json
```

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sailor-templates` reuse-flow](../sailor-templates/references/reuse-flow.md) — follow it.
`sailor mandate register` registers only; `configureDirect` (owner tx) is the half that makes the
permission live.

Template-specific bits:

- **Singleton:** `SwapPermissionNoOracle` — `node .agents/skills/sailor-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** sell/buy tokens, per-swap cap, router/fee tier, recipient = SMA, and for each
  pair the reference pool + tolerance. **Explicitly confirm the no-oracle trade-off** with the user:
  this is a hallucination guard, not slippage/manipulation protection.
- **Blob:** `abi.encode(routers[], tokensIn[], tokensOut[], maxAmountPerTx, ReferencePool[])` —
  **flat params, no wrapper**; `ReferencePool{tokenIn, tokenOut, pool, kind, toleranceBps}`.
- **Simulate (mandatory — unaudited example):** an allowed swap passes; wrong recipient, over-cap,
  disallowed token, and an `amountOutMin` below the pool-implied floor are rejected.

## Notes
- The band is **not** manipulation-resistant — re-state this whenever authorizing. Prefer
  [`sailor-template-swap`](../sailor-template-swap/SKILL.md) wherever an oracle exists.
- `toleranceBps` is capped at 50% in source; a wider band is meaningless and rejected at configure.
- Unaudited example — step 4 is mandatory.
- Aggregator routing (opaque calldata) → author a bespoke permission via [`sailor-mandates`](../sailor-mandates/SKILL.md).

## Next

Once this permission is configured and simulate passes (must-pass AND must-fail cases), return to the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) for the next permission. When every permission in the plan is registered, configured, and simulate-verified, proceed to Station 4 — the sailor-agent-build skill (dispatch mechanics: [`sailor-transactions`](../sailor-transactions/SKILL.md)).
