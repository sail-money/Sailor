// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : Uniswap V3
// Version  : SwapRouter02 (NOT the older SwapRouter — different selectors)
// Chain    : Base mainnet (8453)
// Target   : SwapRouter02  0x2626664c2603336E57B271c5C0b26F421741e481  (verified on Basescan)
//
// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
//   exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))  selector 0x04e45aaf
//     • target must be SWAP_ROUTER
//     • tokenIn  must equal FIXED_TOKEN_IN
//     • tokenOut must be in ALLOWED_TOKENS_OUT
//     • amountIn ≤ MAX_AMOUNT_IN
//   approve(address,uint256)  selector 0x095ea7b3
//     • target must be FIXED_TOKEN_IN (the ERC-20 being approved)
//     • spender must be SWAP_ROUTER
//     • amount  ≤ MAX_AMOUNT_IN
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
//   • fee tier, sqrtPriceLimitX96, recipient address
//   • swap frequency / cadence
//   • slippage — see the note below
//
// SLIPPAGE IS NOT BOUNDED ON-CHAIN HERE — AND CANNOT BE, without a price oracle:
//   `amountOutMinimum` (output token) and `amountIn` (input token) are denominated in DIFFERENT
//   tokens. Comparing them as a ratio — the pattern an earlier version of this example shipped —
//   is meaningless for any pair whose tokens differ in price or decimals (e.g. USDC→WETH): the
//   check is either trivially satisfied or trivially failed, giving false confidence while
//   protecting nothing. So this permission deliberately does NOT constrain `amountOutMinimum`.
//   Real slippage protection must be computed OFF-CHAIN from a live quote (e.g. the Quoter or a
//   price feed) and passed in as `amountOutMinimum` on each swap — the router reverts if the
//   output falls below it. Your agent owns choosing a tight, fresh value per call; this contract
//   only caps the input spend (MAX_AMOUNT_IN).
//
// VERIFY BEFORE USE:
//   • Confirm SwapRouter02 address on your chain (Base default shown above; verified on Basescan).
//   • Selector 0x04e45aaf = exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
//     on SwapRouter02 (verified via `cast sig`). The OLDER SwapRouter's exactInputSingle (the
//     deadline variant) is 0x414bf389 — a different selector; do not confuse the two.
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedSwap_UniswapV3_Base is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedSwap_UniswapV3_Base");

    address public immutable SWAP_ROUTER;
    address public immutable FIXED_TOKEN_IN;
    mapping(address => bool) public isAllowedTokenOut;
    uint256 public immutable MAX_AMOUNT_IN;

    bytes4 private constant SEL_EXACT_INPUT_SINGLE = 0x04e45aaf;
    bytes4 private constant SEL_APPROVE            = 0x095ea7b3;

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
    /// @param fixedTokenIn    The one token the agent is allowed to sell
    /// @param allowedTokensOut  Tokens the agent may receive
    /// @param maxAmountIn     Per-call spend cap in fixedTokenIn base units
    /// @dev No slippage parameter: slippage cannot be bounded on-chain without a price oracle
    ///      (see the header note). Pass a tight `amountOutMinimum`, computed off-chain from a
    ///      live quote, on each swap — the router enforces it by reverting.
    constructor(
        address swapRouter,
        address fixedTokenIn,
        address[] memory allowedTokensOut,
        uint256 maxAmountIn
    ) {
        SWAP_ROUTER    = swapRouter;
        FIXED_TOKEN_IN = fixedTokenIn;
        MAX_AMOUNT_IN  = maxAmountIn;
        for (uint256 i = 0; i < allowedTokensOut.length; i++) {
            isAllowedTokenOut[allowedTokensOut[i]] = true;
        }
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (txData.length < 4) return false;

        // exactInputSingle: agent swaps FIXED_TOKEN_IN for an allowed output token
        if (ctx.target == SWAP_ROUTER && ctx.selector == SEL_EXACT_INPUT_SINGLE) {
            if (txData.length < 4 + 7 * 32) return false;
            ExactInputSingleParams memory p = abi.decode(txData[4:], (ExactInputSingleParams));
            if (p.tokenIn != FIXED_TOKEN_IN)         return false;
            if (!isAllowedTokenOut[p.tokenOut])      return false;
            if (p.amountIn > MAX_AMOUNT_IN)          return false;
            // amountOutMinimum is intentionally NOT checked here — it is denominated in the
            // output token, so a ratio against amountIn (input token) bounds nothing real for a
            // cross-price pair (see header). The router enforces the off-chain-computed
            // amountOutMinimum the agent passes in.
            return true;
        }

        // approve: agent approves the router to spend FIXED_TOKEN_IN
        if (ctx.target == FIXED_TOKEN_IN && ctx.selector == SEL_APPROVE) {
            if (txData.length < 4 + 2 * 32) return false;
            (address spender, uint256 amount) = abi.decode(txData[4:], (address, uint256));
            if (spender != SWAP_ROUTER)  return false;
            if (amount > MAX_AMOUNT_IN)  return false;
            return true;
        }

        return false;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
