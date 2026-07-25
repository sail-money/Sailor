---
name: sailor-template-swap-no-oracle
description: "Gate an SMA's DEX swaps by REUSING the shared SwapPermissionNoOracle singleton (Protocol/contracts/templates/SwapPermissionNoOracle.sol) — register + configure, no per-SMA deploy. The DEFAULT bounded-swap tier for regular trade sizes, on Uniswap V3/V3-02/V2 (and forks): router + token-in/out allowlists, a per-tx cap, recipient pinned to the SMA, and a per-pair live-pool sanity band (catches a bad quote, not a manipulation attack). For trades large relative to pool depth, or a token that already has a price feed, see sailor-template-swap (oracle-gated); for the LI.FI aggregator author a bespoke permission via sailor-mandates. Deployed on all 12 Sailor-bundled chains (recorded in sailor-templates/deployed.json)."
compatibility: A Sailor project (`@sail.money/sailor/sdk`, `sailor` CLI). Requires SwapPermissionNoOracle deployed on the target chain (recorded in sailor-templates/deployed.json); run sailor-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/SwapPermissionNoOracle.sol
---

# sailor-template-swap-no-oracle — bounded DEX swap for oracle-less tokens

You typically arrive here from the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) with a complete strategy spec — this spoke covers the bounded-swap permission of that plan, and is the default tier for regular trade sizes.

Reuse the shared **`SwapPermissionNoOracle`** singleton instead of authoring/deploying a swap
contract. Register its address on the SMA and `configure()` your routers, token allowlists, cap,
and a **reference pool per tradeable pair**. Family overview + flow:
[`sailor-templates`](../sailor-templates/SKILL.md). For the oracle-gated tier see
[`sailor-template-swap`](../sailor-template-swap/SKILL.md).

**The default swap permission.** Its price band reads a *single pool's live spot price* — it
catches an honest mistake (a confused manager/agent quoting a wildly wrong number, a "hallucination
guard"), not an attack: any party can move that spot price within one transaction, so it provides
no manipulation-resistant slippage protection. That is the right trade-off for most sizes. Once a
trade is large relative to the pool's depth, moving the price becomes worth an attacker's effort —
at that size, [`sailor-template-swap`](../sailor-template-swap/SKILL.md)'s oracle-gated band is
worth the extra setup (an `IOracle` adapter must exist, or be deployed, for the pair).

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

## ⚠️ Tolerance vs. pool fee — size it wrong and the band silently rejects every trade

`toleranceBps` bounds `amountOutMin` against `expectedOut`, and `expectedOut` is read straight off
the reference pool's live spot price (`getReserves`/`slot0`) — **before** the venue's own swap fee
is taken out. A real fill always receives less than that fee-exclusive spot price implies (the pool
takes its cut on the way through), while the agent's own `amountOutMin` — sized from a live quote
plus its own slippage cushion (see [`sailor-swap-quote`](../sailor-swap-quote/SKILL.md)) — is
fee-*inclusive*:

```
band floor   = expectedOut × (1 − toleranceBps)           [expectedOut is fee-EXCLUSIVE spot]
agent minOut ≈ expectedOut × (1 − fee) × (1 − slippage)    [the live quote is fee-INCLUSIVE]
```

The band only clears when `toleranceBps` is bigger than `fee + slippage` — plus some headroom for
real price movement between the quote and the mined transaction. A `toleranceBps` at or below
`fee + slippage` doesn't make the guard stricter; it makes every legitimate trade fail the band,
silently — `_sanityCheck` just returns `false` and the tick logs a denial, with nothing pointing at
"your tolerance is too tight."

**Concrete example (a real field incident):** `toleranceBps: 100` (1%), the agent's own slippage
cushion also 100 bps (1%), trading against a 30-bps-fee pool (Uniswap V3 `feeTier: 3000`). Band
floor = 99.0% of spot. Real minOut ≈ (1 − 0.30%) × (1 − 1%) ≈ 98.7% of spot. Every single buy
denied — the band looked "tight but reasonable" and was in fact tight-and-broken; nothing about the
numbers alone makes that visible without doing this arithmetic.

**Set `toleranceBps` comfortably above `fee + slippage`** — fee + slippage + roughly 100–200 bps of
headroom for price movement between quote and execution is a reasonable floor. The pool's fee tier
is already in [`sailor-token-resolve`](../sailor-token-resolve/SKILL.md)'s output (Uniswap V3
`feeTier` is in hundredths of a bip — divide by 100 to get bps: `feeTier: 3000` → 30 bps); the
agent's slippage is whatever [`sailor-swap-quote`](../sailor-swap-quote/SKILL.md) sizes for the live
quote. **Never just copy the agent's slippage number into `toleranceBps`** — that's exactly the
mistake above. [`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md) checks this before the
mandate is registered; this is the reasoning behind that check.

This applies identically to [`sailor-template-swap`](../sailor-template-swap/SKILL.md)'s
`maxSlippageBps` — same fee-exclusive-reference-vs-fee-inclusive-minOut gap, an oracle price in
place of the pool's live spot price.

## ⚠️ Approve coverage — the hidden precondition

Same rule as every protocol permission: `SwapPermissionNoOracle` authorizes the swap call only; the
`approve(router, amountIn)` that lets the router pull `tokenIn` is a separate transaction this
permission does not cover. Identical mechanics to `SwapPermission` — see its "Approve coverage"
section in [`sailor-template-swap`](../sailor-template-swap/SKILL.md) for the default (the agent
grants its own allowance via a small bespoke permission, standing or bounded-per-trade — allowance
size plays no role in what the permission allows, and the agent, not the owner, does the
re-approving, so it never stalls), the owner-set-on-the-Safe opt-out for skipping the bespoke
permission, and the atomic-batch alternative, including the honest caveat that
`ApproveAndCallBatchPermission` does not check `amountOutMin` at all. Full reasoning:
[`approvals.md` → "Swaps are a special
case"](../sailor-mandates/references/approvals.md#swaps-are-a-special-case).

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
sailor mandate register --address <SWAP_NO_ORACLE> --sma <SMA> --label "bounded-swap-no-oracle"

# SwapPermissionNoOracle has no CLI --template encoder (only SwapPermission does today) — build
# the blob yourself and pass --params. --address is a known shared-template singleton, so the
# signing card's "what you're signing" explanation still renders automatically without
# --template/--label. ReferencePool is a struct array: (tokenIn, tokenOut, pool, kind, toleranceBps).
BLOB=$(cast abi-encode "f(address[],address[],address[],uint256,(address,address,address,uint8,uint256)[])" \
  "[0x73855d06DE49d0fe4A9c42636Ba96c62da12FF9C]" \
  "[0x078D782b760474a361dDA0AF3839290b0EF57AD6]" \
  "[0xILLIQUID_TOKEN_resolve_via_sailor-token-resolve]" \
  10000000 \
  "[(0x078D782b760474a361dDA0AF3839290b0EF57AD6,0xILLIQUID_TOKEN_resolve_via_sailor-token-resolve,0xREFERENCE_POOL_verify_it_prices_this_pair_onchain,1,1000)]")
sailor mandate configure --address <SWAP_NO_ORACLE> --sma <SMA> --params "$BLOB"

# ONE mandatory safety gate — generate the lean probes from the same $BLOB, then run simulate once
# (picks the correct swap selector per router). See sailor-templates/references/reuse-flow.md step 5.
node scripts/probe-mandate.mjs --template SwapPermissionNoOracle --params "$BLOB" --sma <SMA> --address <SWAP_NO_ORACLE>
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
  **flat params, no wrapper**; `ReferencePool{tokenIn, tokenOut, pool, kind, toleranceBps}`. No CLI
  `--template` encoder for this template — build via `cast abi-encode` / `encodeAbiParameters` and
  pass `--params` (see worked example above).
- **Simulate (mandatory — unaudited example):** an allowed swap passes; wrong recipient, over-cap,
  disallowed token, and an `amountOutMin` below the pool-implied floor are rejected.

## Notes
- `toleranceBps` is capped at 50% in source; a wider band is meaningless and rejected at configure.
- Aggregator routing (opaque calldata) → author a bespoke permission via [`sailor-mandates`](../sailor-mandates/SKILL.md).

## Next

Simulate passing → back to the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) for the next permission.
