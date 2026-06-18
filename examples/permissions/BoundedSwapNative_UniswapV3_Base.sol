// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : Uniswap V3 — NATIVE-ASSET (ETH) swap
// Version  : SwapRouter02 (NOT the older SwapRouter — different selectors)
// Chain    : Base mainnet (8453)
// Target   : SwapRouter02  0x2626664c2603336E57B271c5C0b26F421741e481  (verified on Basescan)
//
// WHY A SEPARATE EXAMPLE FOR NATIVE ETH:
//   When the asset being spent is the chain's NATIVE asset (ETH), the value that actually
//   leaves the account is the call's `msg.value` — exposed to the permission as `Context.value`
//   (`ctx.value`) — NOT the calldata `amountIn`. SwapRouter02 swaps native ETH by wrapping the
//   ETH you send (tokenIn = WETH in the calldata) into WETH inside the router. So a permission
//   adapted naively from the ERC-20 swap example (BoundedSwap_UniswapV3_Base.sol) would bound
//   `amountIn` while leaving `ctx.value` UNBOUNDED — and the on-chain bound would NOT cap the
//   funds actually spent. That is the trap this example exists to close.
//
// THE RULE THIS EXAMPLE DEMONSTRATES:
//   For ANY value-carrying call, `Context.value` MUST be explicitly bounded. Bounding the
//   calldata amount is not enough — the real spend is `ctx.value`.
//
// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
//   exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))  selector 0x04e45aaf
//     • target must be SWAP_ROUTER
//     • ctx.value ≤ MAX_AMOUNT_IN          ← bounds the REAL native spend
//     • amountIn == ctx.value              ← forces the native path; no value/amount drift
//     • tokenIn  must equal WETH           ← the router wraps ctx.value into WETH
//     • tokenOut must be in ALLOWED_TOKENS_OUT
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
//   • fee tier, sqrtPriceLimitX96, recipient address
//   • swap frequency / cadence
//   • slippage — see the note below
//
// SLIPPAGE IS NOT BOUNDED ON-CHAIN HERE — AND CANNOT BE, without a price oracle:
//   `amountOutMinimum` (output token) and `ctx.value`/`amountIn` (native ETH) are denominated in
//   DIFFERENT tokens, so a ratio between them bounds nothing real (see BoundedSwap_UniswapV3_Base
//   for the full explanation). Compute `amountOutMinimum` OFF-CHAIN from a live quote and pass it
//   in per swap; the router reverts if the output falls below it. This contract only caps the
//   native input spend (MAX_AMOUNT_IN).
//
// VERIFY BEFORE USE:
//   • Confirm SwapRouter02 + WETH addresses on your chain (Base defaults shown; verify on-chain).
//   • Native ETH swaps on SwapRouter02 are typically wrapped in a payable multicall (so the
//     router can refundETH any unspent wei). This example bounds the single exactInputSingle
//     leg; if your agent routes the swap through `multicall`, add a permission that decodes the
//     multicall and applies these same ctx.value / amountIn checks to the inner call.
//   • Selector 0x04e45aaf = exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
//     on SwapRouter02 (verified via `cast sig`). The OLDER SwapRouter's exactInputSingle (the
//     deadline variant) is 0x414bf389 — a different selector; do not confuse the two.
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedSwapNative_UniswapV3_Base is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedSwapNative_UniswapV3_Base");

    address public immutable SWAP_ROUTER;
    /// @dev The wrapped-native token (WETH). SwapRouter02 wraps the ETH sent as ctx.value
    ///      into this token, so the calldata tokenIn for a native swap is WETH.
    address public immutable WETH;
    mapping(address => bool) public isAllowedTokenOut;
    /// @dev Per-call cap on the native spend, in wei. Bounds ctx.value, the REAL spend.
    uint256 public immutable MAX_AMOUNT_IN;

    bytes4 private constant SEL_EXACT_INPUT_SINGLE = 0x04e45aaf;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @param swapRouter      SwapRouter02 address (0x2626... on Base)
    /// @param weth            Wrapped-native token address (WETH on Base: 0x4200...0006)
    /// @param allowedTokensOut  Tokens the agent may receive
    /// @param maxAmountIn     Per-call native spend cap in wei (bounds ctx.value)
    /// @dev No slippage parameter: slippage cannot be bounded on-chain without a price oracle
    ///      (see the header note). Pass a tight `amountOutMinimum`, computed off-chain from a
    ///      live quote, on each swap — the router enforces it by reverting.
    constructor(
        address swapRouter,
        address weth,
        address[] memory allowedTokensOut,
        uint256 maxAmountIn
    ) {
        SWAP_ROUTER   = swapRouter;
        WETH          = weth;
        MAX_AMOUNT_IN = maxAmountIn;
        for (uint256 i = 0; i < allowedTokensOut.length; i++) {
            isAllowedTokenOut[allowedTokensOut[i]] = true;
        }
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (txData.length < 4) return false;
        if (ctx.target != SWAP_ROUTER || ctx.selector != SEL_EXACT_INPUT_SINGLE) return false;
        if (txData.length < 4 + 7 * 32) return false;

        ExactInputSingleParams memory p = abi.decode(txData[4:], (ExactInputSingleParams));

        // Bound the REAL native spend. ctx.value is the ETH actually leaving the account;
        // bounding amountIn alone would leave the spend uncapped.
        if (ctx.value > MAX_AMOUNT_IN) return false;
        // No drift between the declared amount and the native value sent — a native swap pays
        // entirely with ctx.value, so amountIn must equal it exactly.
        if (p.amountIn != ctx.value)  return false;

        // tokenIn is WETH: the router wraps ctx.value into WETH before swapping.
        if (p.tokenIn != WETH)              return false;
        if (!isAllowedTokenOut[p.tokenOut]) return false;
        // amountOutMinimum intentionally not checked — see header (slippage cannot be bounded
        // on-chain; the router enforces the off-chain-computed value the agent passes in).
        return true;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
