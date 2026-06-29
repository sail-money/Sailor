---
name: sail-template-swap
description: Gate an SMA's DEX swaps by REUSING the shared SwapPermission singleton (Protocol/contracts/templates/SwapPermission.sol) — register + configure, no per-SMA deploy. Use for a bounded swap / DCA mandate on Uniswap V3, V3-02, or V2 with router + token-in/out allowlists, a per-tx cap, and optional oracle slippage band. For the LI.FI aggregator use sail-lifi-swap; for Pendle use sail-pendle. NOTE: `sailor mandate attach` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires SwapPermission deployed on the target chain (recorded in sail-templates/deployed.json); run sail-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/SwapPermission.sol
---

# sail-template-swap — bounded DEX swap via the shared singleton

Reuse the shared **`SwapPermission`** singleton instead of authoring/deploying a swap contract.
Register its address on the SMA and `configure()` your routers, token allowlists, cap, and
slippage. Family overview + flow: [`sail-templates`](../sail-templates/SKILL.md).

## What it enforces (per account, from source)

Supported selectors (any other ⇒ `false`):

| Selector | Function | Venue |
|---|---|---|
| `0x414bf389` | `exactInputSingle((tokenIn,tokenOut,fee,recipient,deadline,amountIn,amountOutMinimum,sqrtPriceLimitX96))` | Uniswap V3 SwapRouter |
| `0x04e45aaf` | `exactInputSingle((tokenIn,tokenOut,fee,recipient,amountIn,amountOutMinimum,sqrtPriceLimitX96))` | Uniswap V3 SwapRouter02 |
| `0x38ed1739` | `swapExactTokensForTokens(amountIn,amountOutMin,path[],to,deadline)` | Uniswap V2 Router |

Invariants: `target ∈ routers`; `tokenIn`/`path[0] ∈ tokensIn`; `tokenOut`/`path[last] ∈
tokensOut`; `recipient`/`to == SMA` (funds can't leave the account); `amountIn ≤
maxAmountPerTx`; oracle band when `priceOracle != 0 && maxSlippageBps != 0`:
`amountOutMin ≥ amountIn × price/10^dec × (10_000 − maxSlippageBps)/10_000`.

> **V2 intermediate hops are NOT checked** — only `path[0]`/`path[last]`. Restrict to V3 or
> ensure any plausible intermediate token is acceptable.

## ⚠️ Approve coverage — the hidden precondition

`SwapPermission` authorizes the swap **call** only. The router pulls `tokenIn` via an ERC-20
allowance, and the `approve(router, amount)` that establishes it is a **separate transaction this
permission does not cover** (same rule as every protocol permission — see
[`sail-mandates/references/approvals.md`](../sail-mandates/references/approvals.md)). A swap with
no/insufficient allowance reverts inside the router and the tick fails. **Every** bounded swap
needs the allowance handled — decide how at mandate-build time, not when the first tick reverts.

- **Autonomous agent (DCA / rebalancer / treasury) — default:** do NOT use `SwapPermission` alone;
  register the shared **`ApproveAndCallBatchPermission`** singleton and dispatch each tick as one
  atomic `[approve(router, amountIn), swap, approve(router, 0)]` batch — no lingering allowance,
  no per-tick owner signature. See [`sail-template-approve-batch`](../sail-template-approve-batch/SKILL.md).
- **Owner in the loop per swap:** keep `SwapPermission`; the owner pre-approves the router. The
  agent must read `allowance(SMA, router)` and **stall (never self-approve)** when it is below
  `amountIn` — `approve()` is an owner-side action the agent cannot take on its own.

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(address[] routers, address[] tokensIn, address[] tokensOut,
           uint256 maxAmountPerTx, uint256 maxSlippageBps,
           address priceOracle, uint256 maxPriceAgeSec)
```
| Field | Notes |
|---|---|
| `routers` | DEX routers the agent may call |
| `tokensIn` / `tokensOut` | sell-side / buy-side allowlists (multiple out ⇒ portfolio DCA) |
| `maxAmountPerTx` | per-swap cap, base units (e.g. `25_000_000` = 25 USDC) |
| `maxSlippageBps` | e.g. `100` = 1%. `0` disables the oracle check (explicit opt-out) |
| `priceOracle` | `address(0)` disables the oracle check |
| `maxPriceAgeSec` | must be `> 0` when `priceOracle` is set |

Size the cap and slippage floor with `uniswap-v3-quote` / `sail-pyth-prices`. The SDK
`boundedSwapTemplate` encoder matches this tuple — fine to use after a quick verify.

### Worked example — single-leg USDC → WETH

Concrete params for a 25-USDC-per-swap, 1%-slippage, oracle-disabled DCA leg. These are the
values you hand to `boundedSwapTemplate.encoder.encode(...)` to produce the `configureDirect`
blob (step 3b) — they are **not** an args-file for a CLI command:

```json
{
  "routers":        ["0x73855d06DE49d0fe4A9c42636Ba96c62da12FF9C"],
  "tokensIn":       ["0x078D782b760474a361dDA0AF3839290b0EF57AD6"],
  "tokensOut":      ["0x4200000000000000000000000000000000000006"],
  "maxAmountPerTx": "25000000",
  "maxSlippageBps": 100,
  "priceOracle":    "0x0000000000000000000000000000000000000000",
  "maxPriceAgeSec": 0
}
```

| Field | From | Notes |
|---|---|---|
| `routers` | SwapRouter02 for the chain (resolve-token's chain table) | V3 router; the agent calls `exactInputSingle` on it |
| `tokensIn` | `resolve-token` | sell-side allowlist (usually just USDC) |
| `tokensOut` | `resolve-token` | buy-side allowlist; **multiple ⇒ portfolio DCA** |
| `maxAmountPerTx` | user's per-swap size, **base units** (string) | `"25000000"` = 25 USDC (6 dec) |
| `maxSlippageBps` | `quote-swap`'s recommendation | `100` = 1%. `0` disables the on-chain check (testing only) |
| `priceOracle` | `0x0` to disable, or a Pyth/Chainlink feed | when set, `maxPriceAgeSec` must be `> 0` |
| `maxPriceAgeSec` | seconds | oracle staleness bound; `0` when the oracle is disabled |

> **Caps are base units.** A decimals mismatch (USDC is 6, most tokens 18) silently mis-sizes
> every bound. `resolve-token` verified decimals on-chain — use that value, never a guess.
> For a **portfolio DCA**, list every buy-side token in `tokensOut` (one config, many legs).

## Steps

> **Register ≠ configure.** `sailor mandate attach` only registers the singleton on the kernel;
> it does NOT configure it. A registered-but-unconfigured singleton denies every call. You must
> do both — steps 3a (register) and 3b (configure). Full mechanics + the encoding gotcha:
> [`sail-templates` reuse-flow](../sail-templates/references/reuse-flow.md).

1. **Address:** `node SKILLS/sail-templates/catalog.mjs --chain <id>` → `SwapPermission`
   address. Not deployed yet? Deploy the singleton once and record it in `deployed.json`.
2. **Confirm the spec with the user** (sell/buy tokens, per-swap cap, slippage, router/fee
   tier, recipient = SMA) — print the explainer's humanReadable + warnings. No gas before
   approval.
3. **a. Register** the singleton on the SMA's kernel (does NOT configure):
   ```bash
   sailor mandate attach --address <SWAP_PERMISSION> --sma <SMA> --label "bounded-swap"
   ```
   **b. Configure** the per-account bounds — this is what makes the permission live. Encode the
   blob (`abi.encode(routers[], tokensIn[], tokensOut[], maxAmountPerTx, maxSlippageBps,
   priceOracle, maxPriceAgeSec)` — **flat params, no wrapper**; the SDK `boundedSwapTemplate`
   encoder matches this tuple), pre-flight with `cast call <SWAP_PERMISSION>
   "configureDirect(address,bytes)" <SMA> <blob> --from <owner>`, then send `configureDirect`
   as an owner tx through the signing station. Verify `isConfigured(<SMA>) == true`.
   *(Intended future: `sailor mandate use`/`configure` does register+configure in one step —
   not yet shipped.)*
4. **Simulate** — prove an allowed swap passes and a bad one (wrong recipient / over-cap /
   disallowed token) fails:
   ```bash
   sailor mandate simulate --address <SWAP_PERMISSION> --sma <SMA> --calls ./swap-probe.json
   ```
5. **Reconfigure** later (new cap / extra output token) — re-run step 3b with a new blob; same
   address, no re-register.

## Agent config (off-chain, within the on-chain bounds)

The mandate bounds what the agent MAY do; the agent's code decides what it WILL do and when. Wire
the legs from the resolve + quote outputs:

```typescript
export const DCA_LEGS = [
  {
    tokenIn: "<USDC_ADDR>", tokenOut: "<WETH_ADDR>",
    tokenInDecimals: 6, tokenOutDecimals: 18,
    feeTier: 3000, amountPerSwap: 25_000_000n,   // base units, ≤ maxAmountPerTx
    slippageBps: 100,
  },
] as const;
```

The agent must re-quote via [`sail-swap-quote`](../sail-swap-quote/SKILL.md) close to dispatch time
and embed the floor `amountOutMinimum` in the swap calldata — the on-chain `maxSlippageBps` enforces
it regardless. **Match the tick's dispatch shape to your approve model:** under the batch model
(default) the agent returns one `Dispatch` whose `calls` is the 3-element
`[approve(router, amountIn), swap, approve(router, 0)]` and must NOT pre-approve out of band (the
batch requires a zero pre-batch allowance); under `SwapPermission` + owner pre-approve it emits a
plain single-call swap and MUST read `allowance(SMA, router)` and **stall (not self-approve)** when
it is below `amountIn`.

## When NOT to use this
- **Token has no oracle and you need manipulation resistance** → this template's oracle-disabled
  mode only catches honest mistakes, not MEV/flash-loan attacks. See
  [`sail-template-swap-no-oracle`](../sail-template-swap-no-oracle/SKILL.md) (hallucination guard,
  not yet deployed) or author a bespoke permission.
- **Aggregator (LI.FI) or opaque calldata** → the mandate can't inspect the route; use
  [`sail-lifi-swap`](../sail-lifi-swap/SKILL.md) or [`sail-mandates`](../sail-mandates/SKILL.md).
- **`SwapPermission` not deployed on your chain** (e.g. Ethereum mainnet) → deploy the singleton and
  record it in `deployed.json`, or author your own via [`sail-mandates`](../sail-mandates/SKILL.md).

## Notes
- `maxSlippageBps = 0` removes slippage protection — testing only.
- Unaudited example — step 4 is mandatory.
- `recipient = SMA` is non-negotiable and enforced in the contract, not just config.
