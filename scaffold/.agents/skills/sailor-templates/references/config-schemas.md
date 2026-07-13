# Config schemas & enforced invariants — authoritative (from source)

Each shared template stores per-account config under `mapping(address => …)` and decodes a
`configure(...)` blob in `_applyConfig`. The tuples below are taken **directly from
`Protocol/contracts/templates/*.sol`** and are the source of truth — encode with
`abi.encode(...)` in that exact order (viem's `encodeAbiParameters` is the TypeScript
equivalent).

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
`target ∈ routers`; **`tokenIn != tokenOut` / `path[0] != path[last]`** (self-routes denied — a
round-trip would burn AMM fees while an oracle reporting base==quote clears the band);
`tokenIn`/`path[0] ∈ tokensIn`; `tokenOut`/`path[last] ∈ tokensOut`;
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
Selectors: Aave `borrow(address,uint256,uint256,uint16,address)` (variable-rate only —
`rateMode != 2` denies; stable-rate debt is rejected), Morpho **Optimizer/Morpho-Aave**
`borrow(address,uint256,address,address)` (NOT Morpho Blue — its ABI differs and simply won't
match, i.e. fails closed), Compound `borrow(uint256)` (target is the cToken; the underlying is
resolved via `cToken.underlying()` and both the allowlist and LTV are underlying-denominated —
targets with no `underlying()`, e.g. cETH, are denied). Invariants: `protocols`/`assets` must be
non-empty with no zero addresses (`EmptyAllowlist`/`ZeroAddress` revert otherwise);
`target ∈ protocols`; `asset ∈ assets`; `amount ≤ maxAmountPerTx`; `onBehalfOf`/`receiver ==
account`. **Oracle modes:** zero oracles ⇒ amount-cap-only (no LTV ceiling applied at all, despite
`maxLtvBps` being stored); both oracles set ⇒ `_ltvCheck` enforces the LTV bound. Exactly one
oracle set reverts `OracleConfigInconsistent` at configure — it's an all-or-nothing pair.

## TransferPermission
```
abi.encode(address[] allowedRecipients, address[] allowedTokens, uint256 maxAmountPerTx)
```
Selectors: `0xa9059cbb` `transfer`, `0x23b872dd` `transferFrom`. Invariants: `value == 0`;
`allowedRecipients`/`allowedTokens` must be non-empty with no zero addresses
(`EmptyAllowlist`/`ZeroAddress` revert at configure otherwise); `target (token) ∈ allowedTokens`;
`to ∈ allowedRecipients`; `amount ≤ maxAmountPerTx`;
**`transferFrom` requires `from == account`** (stricter than the old TransferTarget).
Max 50 entries per allowlist.

## DepositPermission
```
abi.encode(address[] targets, address[] tokens, uint256 maxAmountPerTx)
```
Selectors: `deposit(uint256,address)` (ERC-4626), `mint(uint256,address)`,
`deposit(address,uint256,address,uint16)` (Aave v2), `supply(address,uint256,address,uint16)`
(Aave v3). Invariants: `value == 0`; `targets`/`tokens` must be non-empty with no zero addresses
(`EmptyAllowlist`/`ZeroAddress` revert at configure otherwise); `target ∈ targets`; token
allowlist enforced (Aave: the `asset` arg; ERC-4626: `target` itself must be in `tokens`);
`amount`/`shares ≤ maxAmountPerTx`; `receiver`/`onBehalfOf == account`. `mint` cap is in
**shares** — account for share price.

## WithdrawPermission
```
abi.encode(address[] tokens, address allowedRecipient, uint256 maxAmountPerTx)
```
Selectors: `0xa9059cbb` `transfer`, `0x23b872dd` `transferFrom`. Invariants: `value == 0`;
`tokens` must be non-empty and `allowedRecipient` non-zero, with no zero-address tokens
(`EmptyAllowlist`/`ZeroAddress` revert at configure otherwise); `target (token) ∈ tokens`;
`to == allowedRecipient` (single address per config); `amount ≤ maxAmountPerTx`;
**`transferFrom` requires `from == account`**. To change the recipient, `reconfigure` with a new
blob.

## ApproveAndCallBatchPermission
```
abi.encode(Config{
  address[]       tokens; address[] spenders; ConsumingPair[] consumingPairs;
  uint256[]       maxApprovalAmounts; bool requireAmountMatch; bool allowUnconstrainedRecipient;
})
struct ConsumingPair { address target; bytes4 selector; }
```
ABI tuple: `(address[],address[],(address,bytes4)[],uint256[],bool,bool)`. `consumingPairs` is a
**struct array**, not two flat arrays — each `(target, selector)` is bound together, so a selector
is authorised only on its paired target. Authorises exactly the 3-call batch:
`approve(spender, amount)` → consuming call → `approve(spender, 0)`. Invariants: `tokens`,
`spenders`, and `consumingPairs` must each be non-empty and contain no zero addresses/selectors
(`EmptyAllowlist` reverts otherwise); token ∈ `tokens` with `amount ≤ maxApprovalAmount[token]`;
`spender ∈ spenders`; `(target, selector)` ∈ `consumingPairs`; the pre-batch allowance on
`(token, spender)` must be zero; the consuming call must target the approved `spender` and pull the
approved `token`; allowance reset to zero in the same batch; if `requireAmountMatch`, the consuming
call's leading `uint256` arg must equal the approve amount. `maxApprovalAmounts` is index-parallel
with `tokens` (length mismatch reverts).

> ⚠️ **Field name/polarity — `allowUnconstrainedRecipient`, NOT `requireRecipientIsAccount`.**
> The field is an **opt-out**, default-safe: `false` (the default, i.e. an omitted/zero-value
> bool) means the consuming call's output recipient is decoded and **must equal the account** —
> the safe posture. `true` is a deliberate opt-out that leaves the recipient **unconstrained**.
> Setting the bool `true` thinking it "requires/pins the recipient" gets the **opposite**
> behaviour on-chain. Either way, the recipient (and the consumed asset) can only be decoded for
> selectors in the fixed-offset set below — any other selector is denied under the default pin:
> `swapExactTokensForTokens`, V3 `exactInputSingle` (both SwapRouter layouts), Aave V2/V3
> `deposit`/`supply`, ERC-4626 `deposit`/`mint`.
