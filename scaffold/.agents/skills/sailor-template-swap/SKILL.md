---
name: sailor-template-swap
description: Gate an SMA's DEX swaps by REUSING the shared SwapPermission singleton (Protocol/contracts/templates/SwapPermission.sol) — register + configure, no per-SMA deploy. The oracle-gated tier: use when a trade is large relative to the target pool's depth (manipulation-resistant slippage band via a MANDATORY IOracle adapter — priceOracle is required), or the pair already has a deployed adapter. For regular trade sizes, sailor-template-swap-no-oracle is the default. On Uniswap V3, V3-02, or V2 with router + token-in/out allowlists, a per-tx cap, and a slippage limit. For the LI.FI aggregator or Pendle, author a bespoke permission via sailor-mandates. NOTE: `sailor mandate register` only registers — you must also configure per-account (see steps).
compatibility: A Sailor project (`@sail/sdk`, `sailor` CLI). Requires SwapPermission deployed on the target chain (recorded in sailor-templates/deployed.json); run sailor-templates first.
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates/SwapPermission.sol
---

# sailor-template-swap — bounded DEX swap via the shared singleton

You typically arrive here from the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) with a complete strategy spec — this spoke covers the bounded-swap permission of that plan.

Reuse the shared **`SwapPermission`** singleton instead of authoring/deploying a swap contract.
Register its address on the SMA and `configure()` your routers, token allowlists, cap, and

slippage. Family overview + flow: [`sailor-templates`](../sailor-templates/SKILL.md).

## What it enforces (per account, from source)

Supported selectors (any other ⇒ `false`):

| Selector | Function | Venue |
|---|---|---|
| `0x414bf389` | `exactInputSingle((tokenIn,tokenOut,fee,recipient,deadline,amountIn,amountOutMinimum,sqrtPriceLimitX96))` | Uniswap V3 SwapRouter |
| `0x04e45aaf` | `exactInputSingle((tokenIn,tokenOut,fee,recipient,amountIn,amountOutMinimum,sqrtPriceLimitX96))` | Uniswap V3 SwapRouter02 |
| `0x38ed1739` | `swapExactTokensForTokens(amountIn,amountOutMin,path[],to,deadline)` | Uniswap V2 Router |

Invariants: `ctx.value == 0` (native value rejected — ERC-20→ERC-20 only); `target ∈ routers`;
**`tokenIn != tokenOut` / `path[0] != path[last]`** (self-routes denied — a round-trip burns AMM
fees while an oracle reporting base==quote would otherwise clear the band); `tokenIn`/`path[0] ∈
tokensIn`; `tokenOut`/`path[last] ∈ tokensOut`; `recipient`/`to == SMA` (funds can't leave the
account); `amountIn ≤ maxAmountPerTx`; **oracle band ALWAYS enforced** (the oracle is
mandatory — see below): `amountOutMin ≥ amountIn × price/10^dec ×
(10_000 − maxSlippageBps)/10_000`. Dust trades whose computed floor truncates to `0` are
**denied** (fail-closed).

> **⛔ The oracle is MANDATORY (contract `v2`, hardened in PR #45).** `_applyConfig` reverts
> `OracleRequired()` if `priceOracle == 0` and `MissingPriceAge()` if `maxPriceAgeSec == 0`.
> There is **no oracle-disabled mode** on this template — for tokens with no oracle use the
> separate [`SwapPermissionNoOracle`](../sailor-template-swap-no-oracle/SKILL.md) (live-pool
> hallucination band). `maxSlippageBps == 0` is **NOT** a bypass — it means zero tolerance
> (exact-out-or-better), the strictest valid setting. `maxSlippageBps > 9_999` reverts
> `SlippageBpsTooLarge`.

> **V2 intermediate hops are NOT checked** — only `path[0]`/`path[last]`. Restrict to V3 or
> ensure any plausible intermediate token is acceptable.

## ⚠️ Approve coverage — the hidden precondition

`SwapPermission` authorizes the swap **call** only. The router pulls `tokenIn` via an ERC-20
allowance, and the `approve(router, amount)` that establishes it is a **separate transaction this
permission does not cover** (same rule as every protocol permission — see
[`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md)). A swap with
no/insufficient allowance reverts inside the router and the tick fails. **Every** bounded swap
needs the allowance handled — decide how at mandate-build time, not when the first tick reverts.

- **Autonomous agent (DCA / rebalancer / treasury) — default:** do NOT use `SwapPermission` alone;
  register the shared **`ApproveAndCallBatchPermission`** singleton and dispatch each tick as one
  atomic `[approve(router, amountIn), swap, approve(router, 0)]` batch — no lingering allowance,
  no per-tick owner signature. See [`sailor-template-approve-batch`](../sailor-template-approve-batch/SKILL.md).
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
| `maxSlippageBps` | e.g. `100` = 1%. `0` = zero tolerance (strictest), NOT a bypass. Must be `≤ 9_999`. |
| `priceOracle` | **REQUIRED, non-zero.** An `IOracle` adapter exposing `getPrice(tokenIn, tokenOut) → (price, dec, updatedAt)` — **not** a raw Chainlink/Pyth feed. `0` reverts `OracleRequired`. |
| `maxPriceAgeSec` | **REQUIRED, `> 0`** (oracle staleness bound). `0` reverts `MissingPriceAge`. |

Size the cap and slippage floor with `sailor-swap-quote`; `priceOracle` must be a real `IOracle`
adapter for the pair (see above). The SDK `boundedSwapTemplate` encoder matches this tuple —
fine to use after a quick verify.

### Worked example — single-leg USDC → WETH

Concrete params for a 25-USDC-per-swap, 1%-slippage DCA leg. These are the values you hand to
`boundedSwapTemplate.encoder.encode(...)` to produce the `configureDirect` blob (step 3b) — they
are **not** an args-file for a CLI command. `priceOracle` must be a **real, non-zero `IOracle`
adapter** for this pair on this chain (`0x0` reverts):

```json
{
  "routers":        ["0x73855d06DE49d0fe4A9c42636Ba96c62da12FF9C"],
  "tokensIn":       ["0x078D782b760474a361dDA0AF3839290b0EF57AD6"],
  "tokensOut":      ["0x4200000000000000000000000000000000000006"],
  "maxAmountPerTx": "25000000",
  "maxSlippageBps": 100,
  "priceOracle":    "0x9d84C11626d13C5DC9540fA12A3Ff7B85Ac3c1B9",
  "maxPriceAgeSec": 3600
}
```

> **A zero `priceOracle` is not a no-oracle mode — it reverts.** `configure()` reverts
> `OracleRequired()` when `priceOracle == 0`; this template has no oracle-off setting. For a token
> with no oracle adapter, use the separate [`sailor-template-swap-no-oracle`](../sailor-template-swap-no-oracle/SKILL.md).

> The `priceOracle` above is the **default Unichain USDC/WETH `IOracle` adapter** — a verified
> Uniswap V3 30-min TWAP (`UniV3TwapOracle`, pool `0x65081C…DBcF1`, 0.05% tier). It serves the
> USDC↔WETH pair both directions and reverts `UnsupportedPair` for anything else. `catalog.mjs`
> lists it under **IOracle adapters**; on other chains/pairs you must supply your own adapter
> (`address(0)` reverts). Because it's a live TWAP, `updatedAt` is always current — `maxPriceAgeSec`
> just needs to be a few minutes (e.g. `3600`).

| Field | From | Notes |
|---|---|---|
| `routers` | SwapRouter02 for the chain (resolve-token's chain table) | V3 router; the agent calls `exactInputSingle` on it |
| `tokensIn` | `resolve-token` | sell-side allowlist (usually just USDC) |
| `tokensOut` | `resolve-token` | buy-side allowlist; **multiple ⇒ portfolio DCA** |
| `maxAmountPerTx` | user's per-swap size, **base units** (string) | `"25000000"` = 25 USDC (6 dec) |
| `maxSlippageBps` | `quote-swap`'s recommendation | `100` = 1%. `0` = zero tolerance (strictest), not a bypass. `≤ 9_999`. |
| `priceOracle` | an `IOracle` adapter for the chain (Pyth/Chainlink-backed) | **REQUIRED, non-zero.** Must expose `getPrice(tokenIn,tokenOut)` — not the raw feed contract. |
| `maxPriceAgeSec` | seconds | **REQUIRED, `> 0`** — staleness bound. e.g. `3600` = 1h. |

> **Caps are base units.** A decimals mismatch (USDC is 6, most tokens 18) silently mis-sizes
> every bound. `resolve-token` verified decimals on-chain — use that value, never a guess.
> For a **portfolio DCA**, list every buy-side token in `tokensOut` (one config, many legs).

## Steps

> **Register ≠ configure.** `sailor mandate register` only registers the singleton on the kernel;
> it does NOT configure it. A registered-but-unconfigured singleton denies every call. You must
> do both — steps 3a (register) and 3b (configure). Full mechanics + the encoding gotcha:
> [`sailor-templates` reuse-flow](../sailor-templates/references/reuse-flow.md).

1. **Address:** `node .agents/skills/sailor-templates/catalog.mjs --chain <id>` → `SwapPermission`
   address. It's the same address on every chain (CREATE2); see `deployed.json`.
2. **Confirm the spec with the user** (sell/buy tokens, per-swap cap, slippage, router/fee
   tier, recipient = SMA) — print the explainer's humanReadable + warnings. No gas before
   approval.
3. **a. Register** the singleton on the SMA's kernel (does NOT configure):
   ```bash
   sailor mandate register --address <SWAP_PERMISSION> --sma <SMA> --label "bounded-swap"
   ```
   **b. Configure** the per-account bounds — this is what makes the permission live. Build a
   JSON file with the flat template params (`routers`, `tokensIn`, `tokensOut`, `maxAmountPerTx`,
   `maxSlippageBps`, `priceOracle`, `maxPriceAgeSec` — matches the SDK `boundedSwapTemplate`
   encoder tuple, no wrapper), then run:
   ```bash
   sailor mandate configure --address <SWAP_PERMISSION> --sma <SMA> \
     --template SwapPermission --args-file ./swap-config.json
   ```
   `configureDirect` requires `msg.sender == permissionSigner` (`kernel.configs(<SMA>)` — the
   owner only when they collapse to the same address); the command pre-flights the blob with an
   `eth_call` BEFORE any signing or gas — it **reverts** on `priceOracle == 0` (`OracleRequired`),
   `maxPriceAgeSec == 0` (`MissingPriceAge`), or `maxSlippageBps > 9_999` (`SlippageBpsTooLarge`) —
   then requests the `configureDirect` tx from `permissionSigner` through the signing page and
   verifies `isConfigured(<SMA>) == true` on receipt. Pass `--simulate-only` to stop after the
   pre-flight (no signing, no gas).
   *(The signed `configure(account, params, deadline, sig)` path uses EIP-712 domain `("SwapPermission","2")`.)*
4. **Simulate** — the ONE mandatory safety gate, run once. Don't hand-write probes: generate the
   lean set from the config blob (it derives the wrong-recipient / over-cap / disallowed-token
   rejections and picks the correct swap selector for your router), then run the printed command:
   ```bash
   node scripts/probe-mandate.mjs --template SwapPermission --params <0x-config-blob> \
     --sma <SMA> --address <SWAP_PERMISSION>
   ```
   See [sailor-templates/references/reuse-flow.md](../sailor-templates/references/reuse-flow.md) step 5.
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

The agent must re-quote via [`sailor-swap-quote`](../sailor-swap-quote/SKILL.md) close to dispatch time
and embed the floor `amountOutMinimum` in the swap calldata — the on-chain `maxSlippageBps` enforces
it regardless. **Match the tick's dispatch shape to your approve model:** under the batch model
(default) the agent returns one `Dispatch` whose `calls` is the 3-element
`[approve(router, amountIn), swap, approve(router, 0)]` and must NOT pre-approve out of band (the
batch requires a zero pre-batch allowance); under `SwapPermission` + owner pre-approve it emits a
plain single-call swap and MUST read `allowance(SMA, router)` and **stall (not self-approve)** when
it is below `amountIn`.

## Beyond this template — routing
- **Token has no `IOracle` adapter** → this template REQUIRES a non-zero oracle and will not
  configure without one. Use [`sailor-template-swap-no-oracle`](../sailor-template-swap-no-oracle/SKILL.md)
  (live-pool hallucination band — catches honest mistakes, NOT MEV/flash-loan attacks) or author a
  bespoke permission. There is no oracle-off mode on `SwapPermission`.
- **Aggregator (LI.FI) or opaque calldata** → a bespoke permission bounds the perimeter the route
  can't expose; use [`sailor-mandates`](../sailor-mandates/SKILL.md).
- **`SwapPermission` not deployed on your chain** → check `deployed.json` first (it's live on all
  11 Sailor-bundled chains as of the current deploy); for anything outside that set, author your
  own via [`sailor-mandates`](../sailor-mandates/SKILL.md).

## Notes
- The oracle is **mandatory** and the band is **always** enforced; `maxSlippageBps = 0` is the
  strictest setting (zero tolerance), not a way to disable the check.
- `priceOracle` must be an `IOracle` adapter (`getPrice(tokenIn,tokenOut) → (price, dec, updatedAt)`),
  not a raw Chainlink/Pyth feed; it must return a meaningful `updatedAt` or evaluate fails closed.
- Native value is rejected (`ctx.value != 0 ⇒ deny`) — ERC-20→ERC-20 only.
- Unaudited example — step 4 is mandatory.
- `recipient = SMA` is non-negotiable and enforced in the contract, not just config.

## Next

Once this permission is configured and simulate passes (must-pass AND must-fail cases), return to the mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) for the next permission. When every permission in the plan is registered, configured, and simulate-verified, proceed to Station 4 — the sailor-agent-build skill (dispatch mechanics: [`sailor-transactions`](../sailor-transactions/SKILL.md)).
