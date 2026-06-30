# Config schemas & enforced invariants — authoritative (from source)

Each shared template stores per-account config under `mapping(address => …)` and decodes a
`configure(...)` blob in `_applyConfig`. The tuples below are taken **directly from
`Protocol/contracts/templates/*.sol`** and are the source of truth — encode with
`abi.encode(...)` in that exact order. (The `@sail/sdk/templates` builders track a
previously-deployed set; verify a builder's params match the tuple here before using it.)

All caps/amounts are in the relevant token's **base units**. Every template runs under the
kernel's `staticcall` + gas cap + fail-closed semantics: a revert ⇒ deny.

---

## SwapPermission
```
abi.encode(address[] routers, address[] tokensIn, address[] tokensOut,
           uint256 maxAmountPerTx, uint256 maxSlippageBps,
           address priceOracle, uint256 maxPriceAgeSec)
```
Selectors: `0x414bf389` (V3 `exactInputSingle` w/ deadline), `0x04e45aaf` (V3-02 no deadline),
`0x38ed1739` (V2 `swapExactTokensForTokens`). Invariants: `value == 0` (native value rejected);
`target ∈ routers`; `tokenIn`/`path[0] ∈ tokensIn`; `tokenOut`/`path[last] ∈ tokensOut`;
`recipient`/`to == account`; `amountIn ≤ maxAmountPerTx`; **oracle slippage band ALWAYS enforced**.
The oracle is **mandatory** (contract `v2`): `_applyConfig` reverts `OracleRequired` if
`priceOracle == 0`, `MissingPriceAge` if `maxPriceAgeSec == 0`, and `SlippageBpsTooLarge` if
`maxSlippageBps > 9_999`. `maxSlippageBps == 0` ⇒ zero tolerance (strictest), NOT a bypass.
`priceOracle` is an `IOracle` adapter (`getPrice(base,quote) → (price, dec, updatedAt)`), not a raw
feed; dust trades whose floor truncates to 0 are denied. V2 intermediate hops are NOT checked.
(For no-oracle tokens use `SwapPermissionNoOracle`.)

## SwapPermissionNoOracle
```
abi.encode(address[] routers, address[] tokensIn, address[] tokensOut,
           uint256 maxAmountPerTx, ReferencePool[] referencePools)

struct ReferencePool { address tokenIn; address tokenOut; address pool;
                       PoolKind kind /* 0=V2, 1=V3 */; uint256 toleranceBps; }
```
Same selectors and structural checks as `SwapPermission` (`0x414bf389`, `0x04e45aaf`,
`0x38ed1739`): `target ∈ routers`; `tokenIn`/`path[0] ∈ tokensIn`; `tokenOut`/`path[last] ∈
tokensOut`; `recipient`/`to == account`; `amountIn ≤ maxAmountPerTx`. **Differs** from
`SwapPermission` in the price judgement: instead of an oracle band it enforces a **pool-referenced
hallucination band** — `amountOutMin` must be ≥ the output implied by the live spot price of the
operator-named `referencePool` for that directional pair, minus `toleranceBps`, and `amountOutMin
> 0`. Config-time invariants (`_applyConfig` reverts ⇒ configure fails): `toleranceBps ≤ 5_000`
(50% max); `pool != 0`; pool's `token0()`/`token1()` must match the pair (orientation precomputed);
**strict coverage** — every non-self directional `(tokenIn, tokenOut)` combination MUST have a
reference pool or configure reverts `MissingReferencePool`. Fail-closed at evaluate if the pool is
missing/unreadable/illiquid or the floor truncates to zero.

> ⚠️ **NOT manipulation-resistant.** The reference is a single pool's LIVE spot price, movable
> within the same transaction (flash-loan / sandwich). This band only catches an *honest* mistake
> (a confused agent quoting a wildly wrong price); it is NOT slippage protection. For
> manipulation-resistant protection use the oracle-gated `SwapPermission`. Cap is per-tx, not
> cumulative.

## BorrowPermission
```
abi.encode(address[] protocols, address[] assets, uint256 maxAmountPerTx,
           uint256 maxLtvBps, address collateralOracle, address borrowOracle,
           uint256 maxPriceAgeSec)
```
Selectors: Aave `borrow(address,uint256,uint256,uint16,address)`, Morpho-style, Compound-style.
Invariants: `target ∈ protocols`; `asset ∈ assets`; `amount ≤ maxAmountPerTx`;
`onBehalfOf`/`receiver == account`; **`_ltvCheck` against collateral + borrow oracles**
(this version DOES enforce an LTV bound — unlike the older bounded-borrow doc).

## TransferPermission
```
abi.encode(address[] allowedRecipients, address[] allowedTokens, uint256 maxAmountPerTx)
```
Selectors: `0xa9059cbb` `transfer`, `0x23b872dd` `transferFrom`. Invariants: `value == 0`;
`target (token) ∈ allowedTokens`; `to ∈ allowedRecipients`; `amount ≤ maxAmountPerTx`;
**`transferFrom` requires `from == account`** (stricter than the old TransferTarget).
Max 50 entries per allowlist.

## DepositPermission
```
abi.encode(address[] targets, address[] tokens, uint256 maxAmountPerTx)
```
Selectors: `deposit(uint256,address)` (ERC-4626), `mint(uint256,address)`,
`deposit(address,uint256,address,uint16)` (Aave v2), `supply(address,uint256,address,uint16)`
(Aave v3). Invariants: `value == 0`; `target ∈ targets`; token allowlist enforced (Aave: the
`asset` arg; ERC-4626: `target` itself must be in `tokens`); `amount`/`shares ≤ maxAmountPerTx`;
`receiver`/`onBehalfOf == account`. `mint` cap is in **shares** — account for share price.

## WithdrawPermission
```
abi.encode(address[] tokens, address allowedRecipient, uint256 maxAmountPerTx)
```
Selectors: `0xa9059cbb` `transfer`, `0x23b872dd` `transferFrom`. Invariants: `value == 0`;
`target (token) ∈ tokens`; `to == allowedRecipient` (single address per config);
`amount ≤ maxAmountPerTx`; **`transferFrom` requires `from == account`**. To change the
recipient, `reconfigure` with a new blob.

## ApproveAndCallBatchPermission
```
abi.encode(Config{
  address[]       tokens; address[] spenders; ConsumingPair[] consumingPairs;
  uint256[]       maxApprovalAmounts; bool requireAmountMatch; bool requireRecipientIsAccount;
})
struct ConsumingPair { address target; bytes4 selector; }
```
ABI tuple: `(address[],address[],(address,bytes4)[],uint256[],bool,bool)`. `consumingPairs` is a
**struct array**, not two flat arrays — each `(target, selector)` is bound together, so a selector
is authorised only on its paired target. Authorises exactly the 3-call batch:
`approve(spender, amount)` → consuming call → `approve(spender, 0)`. Invariants: token ∈ `tokens`
with `amount ≤ maxApprovalAmount[token]`; `spender ∈ spenders`; `(target, selector)` ∈
`consumingPairs`; allowance reset to zero in the same batch; if `requireAmountMatch`, the consuming
call's leading `uint256` arg must equal the approve amount. `maxApprovalAmounts` is index-parallel
with `tokens` (length mismatch reverts). **Output recipient:** when `requireRecipientIsAccount` is
true, the consuming call's output recipient is decoded and must equal the account (selectors
outside the decodable set are denied — fail-closed); when false (default) it is unconstrained, so
only allowlist `(target, selector)` pairs you trust to deliver output to the account.
