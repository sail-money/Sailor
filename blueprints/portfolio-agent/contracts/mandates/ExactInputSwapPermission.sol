// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";
import {SailCalldata} from "./SailCalldata.sol";

/// @title ExactInputSwapPermission
/// @notice Bounds a single multi-hop Uniswap-V3-family swap via the `exactInput` selector on a
///         SwapRouter02 / Aerodrome Slipstream router. The shared SwapPermission /
///         SwapPermissionNoOracle templates only authorise `exactInputSingle` and V2
///         `swapExactTokensForTokens`; the portfolio runtime dispatches `exactInput` (multi-hop,
///         needed for two-hop legs like USDC → WETH → SKY and for Aerodrome's tickSpacing paths),
///         so this bespoke permission covers that call shape.
///
/// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
///   exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum))
///     selector 0xc04b8d59
///     • ctx.target ∈ routers (Uniswap V3 SwapRouter02 / Aerodrome Slipstream SwapRouter)
///     • ctx.value == 0 (native value rejected — ERC-20 → ERC-20 only)
///     • recipient == ctx.account (funds cannot leave the SMA)
///     • tokenIn (path[0:20]) ∈ tokensIn   — the sell side (USDC on the buy leg)
///     • tokenOut (path[last:20]) ∈ tokensOut — the buy side (the basket tokens)
///     • tokenIn != tokenOut (self-routes denied — a round-trip burns AMM fees)
///     • path length is 43 (single-hop) or 66 (two-hop) — any other layout denied
///     • for a two-hop path, the intermediate token (path[23:43]) ∈ viaTokens (WETH)
///     • amountIn ≤ MAX_BUY_AMOUNT (buy) or amountIn ≤ MAX_SELL_AMOUNT (sell)
///     • amountOutMinimum > 0 (a zero min-out would accept literally any fill)
///     • amountIn > 0
///
/// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
///   • The price floor. The on-chain `amountOutMinimum > 0` is a dust guard only; the meaningful
///     slippage floor (1%) is computed off-chain from a live quote and embedded in
///     `amountOutMinimum` by the agent. A slippage *band* cannot be enforced on-chain without a
///     price oracle — the venue's own revert on a worse fill is the on-chain backstop.
///   • The fee tier / tickSpacing in the path (path[20:23], path[43:46]). It selects the pool; a
///     wrong value reverts in the router (no pool). Not a safety surface.
///   • The deadline. A stale deadline reverts in the router; a far-future deadline is not a
///     value-loss vector. Not bounded here.
///   • Cadence, which token is bought when, and how much (within the caps).
///
/// NOTE: caps are constructor-fixed. Changing them means redeploying + re-registering.
///
/// CALLDATA LAYOUT (the exact ABI encoding of `exactInput`, verified against viem — the runtime's
/// encoder). After the 4-byte selector:
///   slot 0 = offset to the params tuple body (0x20)
///   slot 1 = offset to `path` within the tuple body (0xa0)
///   slot 2 = recipient
///   slot 3 = deadline
///   slot 4 = amountIn
///   slot 5 = amountOutMinimum
///   slot 6 = path length (43 or 66)
///   bytes 228.. = the tight-packed path
contract ExactInputSwapPermission is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("ExactInputSwapPermission");
    bytes4 private constant EXACT_INPUT_SELECTOR = 0xc04b8d59; // exactInput((bytes,address,uint256,uint256,uint256))

    uint256 private constant PATH_START = 228; // selector(4) + 7 head words(224)
    uint256 private constant SINGLE_HOP_LEN = 43; // tokenIn(20) || fee(3) || tokenOut(20)
    uint256 private constant TWO_HOP_LEN = 66; // tokenIn(20) || fee(3) || via(20) || fee(3) || tokenOut(20)

    mapping(address => bool) public isAllowedRouter;
    mapping(address => bool) public isAllowedTokenIn;
    mapping(address => bool) public isAllowedTokenOut;
    mapping(address => bool) public isAllowedVia;

    uint256 public immutable MAX_BUY_AMOUNT; // in tokenIn (USDC) base units — buy leg
    uint256 public immutable MAX_SELL_AMOUNT; // in token (18-dec) base units — sell leg

    constructor(
        address[] memory routers_,
        address[] memory tokensIn_,
        address[] memory tokensOut_,
        address[] memory viaTokens_,
        uint256 maxBuyAmount_,
        uint256 maxSellAmount_
    ) {
        for (uint256 i = 0; i < routers_.length; i++) isAllowedRouter[routers_[i]] = true;
        for (uint256 i = 0; i < tokensIn_.length; i++) isAllowedTokenIn[tokensIn_[i]] = true;
        for (uint256 i = 0; i < tokensOut_.length; i++) isAllowedTokenOut[tokensOut_[i]] = true;
        for (uint256 i = 0; i < viaTokens_.length; i++) isAllowedVia[viaTokens_[i]] = true;
        MAX_BUY_AMOUNT = maxBuyAmount_;
        MAX_SELL_AMOUNT = maxSellAmount_;
    }

    /// @notice Extract a 20-byte address from the tight-packed `path`, at byte offset `offset`
    ///         (relative to the path start). The address sits in the HIGH 20 bytes of the 32-byte
    ///         window read at that offset (big-endian packing).
    function _addrAt(bytes calldata txData, uint256 offset) private pure returns (address) {
        return address(uint160(uint256(bytes32(txData[offset : offset + 32])) >> 96));
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (ctx.selector != EXACT_INPUT_SELECTOR) return false;
        if (!isAllowedRouter[ctx.target]) return false;
        if (ctx.value != 0) return false;
        // selector + 7 head words (slots 0..6) must be present to read the path length.
        if (!SailCalldata.hasParams(txData, 7)) return false;

        address recipient = SailCalldata.asAddress(txData, 2);
        uint256 amountIn = SailCalldata.asUint256(txData, 4);
        uint256 amountOutMinimum = SailCalldata.asUint256(txData, 5);
        uint256 pathLen = SailCalldata.asUint256(txData, 6);

        if (recipient != ctx.account) return false;
        if (amountIn == 0) return false;
        if (amountOutMinimum == 0) return false;
        if (pathLen != SINGLE_HOP_LEN && pathLen != TWO_HOP_LEN) return false;
        if (txData.length < PATH_START + pathLen) return false;

        address tokenIn = _addrAt(txData, PATH_START);
        address tokenOut = _addrAt(txData, PATH_START + pathLen - 20);
        if (tokenIn == tokenOut) return false;

        bool isBuy = isAllowedTokenIn[tokenIn] && isAllowedTokenOut[tokenOut];
        bool isSell = isAllowedTokenOut[tokenIn] && isAllowedTokenIn[tokenOut];
        if (!isBuy && !isSell) return false;

        if (pathLen == TWO_HOP_LEN) {
            address via = _addrAt(txData, PATH_START + 23);
            if (!isAllowedVia[via]) return false;
        }

        if (isBuy) {
            if (amountIn > MAX_BUY_AMOUNT) return false;
        } else {
            if (amountIn > MAX_SELL_AMOUNT) return false;
        }

        return true;
    }

    function discriminator() external pure returns (bytes32) {
        return DISCRIMINATOR;
    }
}
