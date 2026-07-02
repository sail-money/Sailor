# Permission Examples

These are example permission contracts for common DeFi protocols, maintained by Sailor.

**They are not part of Sail Protocol. They are not audited by Sail. They are not a supported
or exhaustive set.** The protocol accepts any contract implementing IPermission — these examples
teach the bounding pattern for specific protocols so you (and your AI agent) can adapt them or
write your own.

## Permissions are only as strong as the protocol is on-chain

A permission is evaluated by the kernel on every dispatch — but it can only see what happens
on-chain. For venues with off-chain order matching (e.g. Polymarket, Limitless, Hyperliquid), a
permission can constrain deposits, withdrawals, approvals, and treasury flows, but NOT the orders
your agent signs off-chain. Prefer fully on-chain venues — Uniswap, Aave, GMX, Synthetix — where
every action passes through the kernel and your bounds actually hold. For an off-chain-CLOB venue,
bound the funding flow instead and accept that the trade itself is agent-enforced — see
`BoundedLimitless_Base.sol`.

## Permissions are protocol- and version-specific

Calldata differs by protocol and by version. A Uniswap V3 swap is a different decode than a
Uniswap V4 swap. Use the example closest to YOUR exact protocol+version+chain, verify the decode
against the protocol's real ABI, and confirm what it enforces before deploying.

You own what you deploy.

## Bound `Context.value` on every value-carrying call

For any call that can carry native asset (ETH), the value actually leaving the account is the
call's `msg.value` — exposed to your permission as `Context.value` (`ctx.value`) — **not** the
calldata amount. A permission that bounds only a calldata `amount`/`amountIn` leaves the real
spend uncapped. So: **every value-carrying call must explicitly bound `Context.value`**, and where
the calldata also declares an amount, assert `amount == ctx.value` so the two cannot drift. See
`BoundedSwapNative_UniswapV3_Base.sol` for the worked native-ETH example.

---

## Examples

Each header has two blocks: **ENFORCES ON-CHAIN** (bounds the kernel checks in `evaluate()` on
every dispatch — these actually hold) and **AGENT-ENFORCED / NOT BOUNDED HERE** (left to your
off-chain agent code — these do *not* hold on-chain). Read both before deploying.

| File | Protocol | Version | Chain | Status |
|---|---|---|---|---|
| `BoundedSwap_UniswapV3_Base.sol` | Uniswap Swap | V3 SwapRouter02 | Base | Full decode |
| `BoundedSwap_UniswapV4_Unichain.sol` | Uniswap Swap | V4 Universal Router | Unichain | Partial decode — see header |
| `BoundedSwapNative_UniswapV3_Base.sol` | Uniswap Swap (native ETH) | V3 SwapRouter02 | Base | Full decode — bounds `Context.value` (native spend) |
| `BoundedBorrow_AaveV3_Arbitrum.sol` | Aave Borrow | V3 Pool | Arbitrum | Full decode |
| `BoundedSupply_AaveV3_Arbitrum.sol` | Aave Supply | V3 Pool | Arbitrum | Full decode |
| `BoundedVault_ERC4626_Base.sol` | ERC-4626 Vault deposit/withdraw | EIP-4626 standard | Base (any EVM) | Full decode |
| `BoundedStake_Venice_Base.sol` | Venice (VVV) staking | sVVV staking | Base | Full decode |
| `BoundedTransfer_ERC20_Ethereum.sol` | ERC-20 Transfer | — | Ethereum (any EVM) | Full decode |
| `BoundedPerp_GMXv2_Arbitrum.sol` | GMX Perpetuals | V2 ExchangeRouter | Arbitrum | Reference pattern — verify selector/struct/router against live GMX ABI (see header) |
| `BoundedLimitless_Base.sol` | Limitless Prediction (off-chain CLOB) | Polymarket fork | Base | Bounds treasury→trader funding; bet is off-chain (see header) |
| `BoundedApproveAndCallBatch.sol` | Atomic approve→call→reset | Sail `IBatchPermission` | Any selective kernel | Full decode — batch-only (see note below) |

The `interfaces/` directory holds `IPermission.sol` (single-call permissions) and
`IBatchPermission.sol` (batch permissions — see the batch example).

## Using these examples

Each file is self-contained and explains in its header exactly what is and is not enforced.
Read the header before deploying.

To compile:
```bash
forge build
```

To deploy within a Sailor project (copy the .sol file to `mandates/` first):
```bash
sailor mandate deploy --contract <Name> --args '[...]' --attach --sma <SMA>
```

For several permissions, deploy each one (without `--attach`), then register them together in
one signature: `sailor mandate attach --address <addr1>,<addr2> --sma <SMA>`.

## Verify before you authorize

Prove a permission accepts the calls you want and rejects the ones you don't — before paying
registration gas — with `sailor mandate simulate` (off-chain `eth_call`, no gas, signs nothing):
```bash
sailor mandate simulate --address <permission> --calls calls.json
```
Every example here was checked this way (valid calls PASS, out-of-bounds calls FAIL).

**Batch permissions are different.** `BoundedApproveAndCallBatch.sol` implements `IBatchPermission`
and is gated by the kernel's `dispatchBatch`, not single `dispatch` — its single-call `evaluate()`
deliberately returns `false`. `sailor mandate simulate` only probes single `evaluate()`, so it
**cannot** verify a batch permission. Until simulate gains a batch mode, verify a batch permission
by calling its `evaluateBatch(calls, ctx)` view directly (e.g. `cast call`) with the call sequences
you expect to pass and fail — same fail-closed `eth_call` semantics, the correct entrypoint.
