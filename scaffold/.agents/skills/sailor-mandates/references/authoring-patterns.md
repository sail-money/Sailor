# Authoring patterns — how to write a bespoke permission

This is a method, not a library. There is no per-protocol menu to copy from — `contracts/` is the neutral `IPermission` scaffold (`BoundedCallPermission.sol` + a Foundry test) to author from. What follows are the patterns and hard-won gotchas that apply regardless of which venue you're binding.

## The header discipline

Every permission's header must state, in two blocks, exactly what the contract does and does not hold:

```solidity
// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
//   <function>(<types>)  selector 0x........
//     • <invariant 1>
//     • <invariant 2>
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
//   • <thing this contract does not constrain>
```

Read both blocks before deploying anything — the first block is what actually holds; the second is what still depends on the agent behaving. A permission with no second block is either trivially simple or hiding an unstated assumption.

## Named gotchas (verified precedents — apply the lesson, not just the specific numbers)

- **Selector correctness is life-or-death.** Verify every selector against the venue's live deployed ABI with `cast sig "fn(types…)"` — never from memory or from docs. A wrong selector fails closed (every legitimate call silently rejected), which is safe but useless, and easy to miss in testing if you only exercise the reject path.
  - *Precedent — the wrong-selector trap:* a staking contract's real entrypoint was `stake(address recipient, uint256 amount)` = `0xadc9772e`. The intuitive single-arg `stake(uint256)` = `0xa694fc3a` looked plausible and does not exist on that contract. Gating the wrong selector meant every legitimate stake was silently rejected. Always confirm the selector against the exact deployed contract, not the "obvious" signature.
- **Venue ABIs drift across versions — pin and re-verify, don't assume.** A venue can run multiple concurrently-deployed router versions, and its struct/calldata shape can gain fields over time.
  - *Precedent — GMX-class ABI drift:* a perps router's order struct gained fields (an added address, a trailing bytes32 array) between versions, changing the function selector. The fix is procedural, not a one-time patch: pick the exact router address the agent will call, read its verified ABI, recompute the selector with `cast sig`, and update the contract if it differs — every time you target a new deployment.
- **Opaque calldata is a hard boundary — document it, don't pretend to gate it.** Some call shapes carry bytes a permission cannot safely decode at a fixed offset (hook data, packed command bytes for a venue with pluggable extensions, etc.). If you cannot reliably decode a parameter, do not write a check that only works for the common case — state in the header that this surface is out of bounds and restrict usage accordingly (e.g. "only deploy against addresses with no hook, or an audited hook").
- **Slippage/min-out cannot be bounded on-chain without a price oracle.** An input amount and an output-token minimum are denominated in different tokens — comparing them as a raw ratio is meaningless for any pair whose tokens differ in price or decimals; it's either trivially satisfied or trivially failed, giving false confidence while protecting nothing. Bound the input spend on-chain; compute the output floor off-chain from a live quote and pass it per call (the venue itself reverts if the fill is worse).
- **Bind `Context.value` on every value-carrying call.** For any call that can carry native asset, the value actually leaving the account is `ctx.value` (`msg.value`), not a calldata field. A permission that only bounds a calldata `amount` while ignoring `ctx.value` leaves the real spend uncapped. Bound `ctx.value` explicitly, and where the calldata also declares its own amount, assert the two are equal so they can't drift apart.
- **Batch permissions see the whole sequence — use that, but mind what they don't check.** A single-call `IPermission` can never enforce "this must be the last call in the sequence" (each call is evaluated in isolation). An `IBatchPermission.evaluateBatch()` can enforce exact call count, order, and cross-call relationships (e.g. an atomic approve → consume → reset-to-zero). But a batch permission that validates the approve/consume/reset shape does not automatically validate *where* the consuming call sends funds — that needs its own check or a paired single-call permission. And amount-matching a value inside a later call's calldata only works if you've confirmed that value's exact byte offset for that specific function signature; matching the wrong slot silently passes anything.
- **`sailor mandate simulate` doesn't cover `evaluateBatch()`** — see [approvals.md](approvals.md) (Model B) for how to verify a batch permission before registering it.

## The venue-boundary pattern

Permissions bind on-chain calls. For a venue with off-chain order matching (e.g. Hyperliquid, Polymarket, Limitless), a permission bounds the on-chain perimeter — deposits, withdrawals, approvals, treasury funding — while the order itself is agent-signed off-chain and inherits that venue's trust assumptions. For a fully on-chain venue (e.g. Uniswap, Aave, GMX), the permission bounds the trade itself. Pick the bounding pattern that matches where the venue actually executes: if the thing you want to constrain never appears in an on-chain call, constrain the funding flow around it instead of writing a check that can't see what it's checking.

## Fail-closed authoring idiom

- An unknown selector → deny.
- Undecodable or malformed calldata → deny (a revert during evaluation is treated as denial by the kernel — safe, but confirm this with real calldata samples before deploying so "denies everything" isn't mistaken for "works").
- If you cannot reliably decode a parameter at a fixed offset for a given call shape, do not write a check that assumes a slot — bound the perimeter around the call instead (allowlist the target/selector, cap `ctx.value`, bind the recipient) rather than a parameter you can't verify.

## Where to actually write one

Start from `contracts/` — a neutral, protocol-agnostic Foundry scaffold (`BoundedCallPermission.sol` + `test/BoundedCallPermission.t.sol`) that bounds allowed targets, allowed selectors, and max ETH value. Extend it with calldata-specific checks (amount caps, recipient binding, allowlists) for the venue you're targeting, following the patterns above. See [Gate 3](../SKILL.md) for the full authoring procedure and [Gate 4](../SKILL.md) for writing tests before any deployment.
