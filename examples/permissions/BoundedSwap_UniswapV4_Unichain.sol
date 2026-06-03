// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : Uniswap V4
// Version  : Universal Router + PoolManager (V4 singleton)
//            NOTE: V4 is NOT the same as V3. Calldata encoding is completely
//            different — do NOT adapt a V3 permission for V4.
// Chain    : Unichain mainnet
// Target   : Universal Router  0xef740bf23acae26f6492b10de645d6b98dc8eaf3
//            (verify on Uniscan before use)
//
// ENFORCED ON-CHAIN (via kernel evaluate() on every dispatch):
//   execute(bytes,bytes[]) or execute(bytes,bytes[],uint256):
//     • target must be UNIVERSAL_ROUTER
//     • first command byte (masking the allow-failure MSB) must be V4_SWAP (0x10)
//     • exactly one command (single-swap path — disallow multi-hop command strings)
//     • V4 action inside must be SWAP_EXACT_IN_SINGLE (0x00)
//     • tokenIn (from poolKey, derived by zeroForOne) must be FIXED_CURRENCY_IN
//     • tokenOut must be in ALLOWED_CURRENCIES_OUT
//     • amountIn ≤ MAX_AMOUNT_IN
//     • amountOutMinimum ≥ amountIn × MIN_BPS / 10 000
//
// NOT ENFORCED — documented limitations:
//   • hookData is not inspected (hooks can alter swap behavior on-chain; if the
//     pool uses a hook that significantly changes execution, this permission cannot
//     constrain it. Deploy against pools with address(0) hooks or audited hooks only.)
//   • fee tier and tickSpacing within the PoolKey are not constrained here
//     (add pool-key checks if you want to restrict to a specific pool)
//   • The ALL_CURRENCY_PAIR constant (FIXED_CURRENCY_IN, allowedCurrenciesOut) does
//     not constrain which pool is used when multiple pools share the same currency pair
//
// VERIFY BEFORE USE:
//   • Confirm Universal Router address on Unichain (shown above; verify on Uniscan).
//   • V4_SWAP command byte = 0x10, SWAP_EXACT_IN_SINGLE action = 0x00 — verify
//     against deployed UniversalRouter and V4Router on Unichain if contract is updated.
//   • PoolKey struct layout (currency0, currency1, fee, tickSpacing, hooks) must
//     match the deployed PoolManager on Unichain. If layout changes, update struct.
//   • hookData is not bounded. Only use with unhookyed pools or audited, bounded hooks.
//   • Calldata revert = false (kernel treats revert as denial) — malformed inputs
//     are safely rejected, but verify with actual calldata samples before deployment.
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedSwap_UniswapV4_Unichain is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedSwap_UniswapV4_Unichain");

    address public immutable UNIVERSAL_ROUTER;
    address public immutable FIXED_CURRENCY_IN;
    mapping(address => bool) public isAllowedCurrencyOut;
    uint256 public immutable MAX_AMOUNT_IN;
    uint256 public immutable MIN_BPS;

    // execute(bytes,bytes[],uint256) — with deadline
    bytes4 private constant SEL_EXECUTE_DEADLINE = 0x3593564c;
    // execute(bytes,bytes[])          — without deadline
    bytes4 private constant SEL_EXECUTE           = 0x24856bc3;
    // Universal Router command byte for V4_SWAP
    uint8 private constant CMD_V4_SWAP = 0x10;
    // Bit mask to strip the "allow failure" MSB from a command byte
    uint8 private constant CMD_MASK = 0x3f;
    // V4Router action: SWAP_EXACT_IN_SINGLE
    uint8 private constant ACT_SWAP_EXACT_IN_SINGLE = 0x00;

    // PoolKey layout must match the deployed V4 PoolManager on Unichain
    struct PoolKey {
        address currency0;  // Currency — address type in V4
        address currency1;
        uint24  fee;
        int24   tickSpacing;
        address hooks;      // IHooks — address(0) for unhookyed pools
    }

    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool    zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes   hookData;   // not inspected — see limitations header
    }

    constructor(
        address universalRouter,
        address fixedCurrencyIn,
        address[] memory allowedCurrenciesOut,
        uint256 maxAmountIn,
        uint256 minBps
    ) {
        require(minBps <= 10_000, "minBps > 10000");
        UNIVERSAL_ROUTER  = universalRouter;
        FIXED_CURRENCY_IN = fixedCurrencyIn;
        MAX_AMOUNT_IN     = maxAmountIn;
        MIN_BPS           = minBps;
        for (uint256 i = 0; i < allowedCurrenciesOut.length; i++) {
            isAllowedCurrenciesOut[allowedCurrenciesOut[i]] = true;
        }
    }

    mapping(address => bool) private isAllowedCurrenciesOut;

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (ctx.target != UNIVERSAL_ROUTER) return false;
        if (ctx.selector != SEL_EXECUTE_DEADLINE && ctx.selector != SEL_EXECUTE) return false;
        if (txData.length < 4) return false;

        // Decode the execute call. Both overloads start with (bytes commands, bytes[] inputs).
        // abi.decode ignores trailing fields, so decoding as (bytes, bytes[]) works for both.
        (bytes memory commands, bytes[] memory inputs) = abi.decode(txData[4:], (bytes, bytes[]));

        // Enforce: exactly one command, and it must be V4_SWAP
        if (commands.length != 1)                              return false;
        if ((uint8(commands[0]) & CMD_MASK) != CMD_V4_SWAP)   return false;
        if (inputs.length != 1)                                return false;

        // Decode the V4 router call (actions + per-action params)
        (bytes memory v4Actions, bytes[] memory v4Params) =
            abi.decode(inputs[0], (bytes, bytes[]));

        // Enforce: exactly one V4 action, and it must be SWAP_EXACT_IN_SINGLE
        if (v4Actions.length != 1)                                                    return false;
        if (uint8(v4Actions[0]) != ACT_SWAP_EXACT_IN_SINGLE)                         return false;
        if (v4Params.length != 1)                                                     return false;

        // Decode ExactInputSingleParams from the action param.
        // hookData is a dynamic bytes field — revert here means false (fail closed).
        ExactInputSingleParams memory p = abi.decode(v4Params[0], (ExactInputSingleParams));

        // Derive tokenIn and tokenOut from the PoolKey and zeroForOne flag.
        // In V4, currency0 < currency1 (sorted by address). zeroForOne = true means
        // trading currency0 for currency1.
        address tokenIn  = p.zeroForOne ? p.poolKey.currency0 : p.poolKey.currency1;
        address tokenOut = p.zeroForOne ? p.poolKey.currency1 : p.poolKey.currency0;

        if (tokenIn != FIXED_CURRENCY_IN)            return false;
        if (!isAllowedCurrenciesOut[tokenOut])       return false;
        if (p.amountIn > MAX_AMOUNT_IN)              return false;
        if (p.amountOutMinimum < (uint256(p.amountIn) * MIN_BPS) / 10_000) return false;

        return true;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
