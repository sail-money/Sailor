# examples/permissions/ — index

Worked reference permissions, one bounding pattern each. They are **not audited, not maintained by Sail core, and not a menu** — adapt them to the user's strategy. Each contract's header documents what is ENFORCED ON-CHAIN vs AGENT-ENFORCED / NOT BOUNDED — read that split before borrowing anything.

Permissions only bound on-chain actions: venues with off-chain order matching (Polymarket, Hyperliquid) cannot be bounded this way; fully on-chain venues (Uniswap, Aave, GMX, Limitless) can.

| File | Protocol / chain | Teaches | Key verified selectors |
|---|---|---|---|
| `BoundedSwap_UniswapV3_Base.sol` | Uniswap V3 SwapRouter02 · Base | Selector allowlist + amount cap + tokenOut allowlist + min-out slippage floor (MIN_BPS) | `0x04e45aaf` exactInputSingle (SwapRouter02), `0x095ea7b3` approve |
| `BoundedSwap_UniswapV4_Unichain.sol` | Uniswap V4 Universal Router · Unichain | Decoding command/action bytes: single V4_SWAP command, single SWAP_EXACT_IN_SINGLE action, currency + amount + slippage bounds | `0x3593564c` execute(bytes,bytes[],uint256), `0x24856bc3` execute(bytes,bytes[]) |
| `BoundedBorrow_AaveV3_Arbitrum.sol` | Aave V3 Pool · Arbitrum | Asset allowlist + borrow cap + `onBehalfOf == ctx.account` binding + rate-mode allowlist (use [2]; stable deprecated in V3.1) | `0xa415bcad` borrow(address,uint256,uint256,uint16,address) |
| `BoundedSupply_AaveV3_Arbitrum.sol` | Aave V3 Pool · Arbitrum | SailCalldata-based decoding; supply cap + `onBehalfOf == ctx.account`; supply does NOT gate withdrawal, and the prior approve needs its own permission | `0x617ba037` supply(address,uint256,address,uint16) |
| `BoundedVault_ERC4626_Base.sol` | ERC-4626 standard · any EVM | Vault allowlist; deposit capped + receiver bound; withdraw/redeem receiver+owner bound but amount-unbounded (SMA can always fully exit) | `0x6e553f65` deposit, `0xb460af94` withdraw, `0xba087652` redeem |
| `BoundedStake_Venice_Base.sol` | Venice (VVV) staking · Base | Recipient binding on stake; claim() structurally routes rewards to caller (the SMA) | `0xadc9772e` stake(address,uint256), `0x4e71d92d` claim() |
| `BoundedTransfer_ERC20_Ethereum.sol` | ERC-20 · any EVM | Token allowlist + recipient allowlist + per-transfer cap; caps are per-token base units (USDC 6 decimals, WETH 18) — one permission per token if amounts differ | `0xa9059cbb` transfer(address,uint256) |
| `BoundedPerp_GMXv2_Arbitrum.sol` | GMX v2 ExchangeRouter · Arbitrum | Market allowlist + collateral cap + size cap (USD is 1e30-scaled) + long/short flags on a struct-typed call | `0x212234c3` createOrder(CreateOrderParams) — MUST re-verify, see below |
| `BoundedBet_Limitless_Base.sol` | Limitless CTF exchange · Base | Condition allowlist + stake cap + outcome allowlist on a prediction market | buy(bytes32,uint256,uint256) — **ABI UNVERIFIED**, see below |
| `BoundedApproveAndCallBatch.sol` | Sail batch dispatch · any selective kernel | `IBatchPermission`: atomic approve → consume → reset-to-0 in exactly 3 calls; single-call evaluate() deliberately returns false | `0x095ea7b3` approve (calls 0 and 2) |

## Lessons the examples encode

- **Venice — the wrong-selector bug.** The live contract's function is `stake(address,uint256)` = `0xadc9772e`. The intuitive single-arg `stake(uint256)` = `0xa694fc3a` does not exist on the target. Gating the wrong selector fails closed: every legitimate stake silently rejected. Always confirm the selector against the deployed contract.
- **GMX — versioned ABIs drift.** GMX has multiple ExchangeRouter deployments and the `CreateOrderParams` struct has gained fields over time. Before deploying: pick the exact router the agent calls, read its verified ABI, recompute with `cast sig "createOrder(<exact tuple>)"`, and update the selector and struct if they differ. The committed `0x212234c3` is verified against gmx-io/gmx-synthetics at time of writing — re-verify anyway.
- **Limitless — unverified ABI as a worked warning.** The exchange address and `buy` signature are inferred from CTF patterns, not verified against the deployed contract. The contract's own header lists the verification steps; do them before any deploy.
- **Batch permissions and simulate.** `BoundedApproveAndCallBatch` bounds the token/spender/amount and the consuming target+selector, optionally amount-matching the consume to the approve — but it does NOT bound where the consuming call routes funds. Pair it with a recipient-binding single-call permission, or choose consuming selectors that structurally pay msg.sender. `sailor mandate simulate` cannot exercise `evaluateBatch()` — verify with `cast call` pass/fail batches.

## Interfaces (vendored in `examples/permissions/interfaces/`)

- `IPermission.evaluate(bytes txData, Context ctx) → bool`; Context: `account, manager, submitter, target, selector, value, blockTimestamp, blockNumber`.
- `IBatchPermission.evaluateBatch(Call[] calls, BatchContext ctx) → bool` + `isBatchPermission() → true`; Call: `(target, value, data)`; BatchContext: `account, manager, submitter, permission, batchHash, blockTimestamp, blockNumber`.
- `SailCalldata.sol`: bounded slot-indexed calldata readers (`hasParams`, `asAddress`, `asUint256`, …) — use these instead of `abi.decode` to avoid wrong-offset reads.
