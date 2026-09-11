// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.26;

import {IOracle} from "./IOracle.sol";
import {TickMath} from "./libs/TickMath.sol";
import {FullMath} from "./libs/FullMath.sol";

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/// @title  UniV3TwapOracle — single-pool Uniswap V3 TWAP adapter implementing IOracle
/// @notice A read-only `IOracle` adapter for the oracle-gated launch templates (SwapPermission).
///         It serves ONE Uniswap V3 pool and the single directional token pair it contains
///         (both directions). The price is a time-weighted average over `twapWindow` seconds,
///         read from `pool.observe`, so it is manipulation-resistant over that window (a one-block
///         spot move barely shifts the average) and needs no external price provider or per-call
///         update fee.
///
///         IORACLE SEMANTICS. getPrice(base, quote) returns (price, decimals, updatedAt) such that
///         1 base base-unit = price / 10**decimals quote base-units. `decimals` is fixed at 18.
///         `updatedAt` is the current block timestamp: a TWAP is computed live at call time, so it
///         is always fresh against the consuming template's `maxPriceAgeSec`.
///
///         BOUNDARIES (honest). This is NOT a USD oracle — it reports the relative price of the two
///         pool tokens, which is exactly what SwapPermission's band needs. Manipulation resistance
///         is only as strong as (a) the pool's liquidity and (b) the chosen window: a long-lived,
///         well-capitalised attacker can still drag a TWAP. It reads a SINGLE pool — if that pool is
///         drained of liquidity the average degrades. `observe` reverts ("OLD") if the pool's
///         observation buffer does not yet span `twapWindow`; that revert propagates and the
///         consuming template fails closed (deny). Unsupported pairs revert `UnsupportedPair`.
contract UniV3TwapOracle is IOracle {
    /// @notice Quote precision returned by getPrice (price is scaled by 10**18).
    uint8 public constant PRICE_DECIMALS = 18;

    address public immutable pool;
    address public immutable token0;
    address public immutable token1;
    uint32  public immutable twapWindow;

    error UnsupportedPair(address base, address quote);
    error WindowZero();

    /// @param _pool       Uniswap V3 pool to read.
    /// @param _twapWindow TWAP averaging window in seconds (must be > 0 and supported by the pool's
    ///                    observation cardinality, else getPrice reverts).
    constructor(address _pool, uint32 _twapWindow) {
        if (_twapWindow == 0) revert WindowZero();
        pool        = _pool;
        token0      = IUniswapV3Pool(_pool).token0();
        token1      = IUniswapV3Pool(_pool).token1();
        twapWindow  = _twapWindow;
    }

    /// @inheritdoc IOracle
    function getPrice(address base, address quote)
        external
        view
        returns (uint256 price, uint8 decimals, uint256 updatedAt)
    {
        bool supported = (base == token0 && quote == token1) || (base == token1 && quote == token0);
        if (!supported) revert UnsupportedPair(base, quote);

        int24 tick = _consultMeanTick();
        // quoteAmount for a base input of 10**PRICE_DECIMALS == price scaled to PRICE_DECIMALS.
        price = _getQuoteAtTick(tick, uint128(10 ** uint256(PRICE_DECIMALS)), base, quote);
        decimals = PRICE_DECIMALS;
        updatedAt = block.timestamp;
    }

    /// @dev Time-weighted mean tick over `twapWindow`, rounded toward negative infinity (Uniswap's
    ///      OracleLibrary convention).
    function _consultMeanTick() internal view returns (int24) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives, ) = IUniswapV3Pool(pool).observe(secondsAgos);
        int56 delta = tickCumulatives[1] - tickCumulatives[0];
        int56 window = int56(uint56(twapWindow));

        int24 meanTick = int24(delta / window);
        if (delta < 0 && (delta % window != 0)) meanTick--;
        return meanTick;
    }

    /// @dev Uniswap OracleLibrary.getQuoteAtTick: quote-token amount for `baseAmount` of base token
    ///      at `tick`, honouring token ordering (no decimal normalisation — raw base units).
    function _getQuoteAtTick(int24 tick, uint128 baseAmount, address baseToken, address quoteToken)
        internal
        pure
        returns (uint256 quoteAmount)
    {
        uint160 sqrtRatioX96 = TickMath.getSqrtRatioAtTick(tick);

        if (sqrtRatioX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtRatioX96) * sqrtRatioX96;
            quoteAmount = baseToken < quoteToken
                ? FullMath.mulDiv(ratioX192, baseAmount, 1 << 192)
                : FullMath.mulDiv(1 << 192, baseAmount, ratioX192);
        } else {
            uint256 ratioX128 = FullMath.mulDiv(sqrtRatioX96, sqrtRatioX96, 1 << 64);
            quoteAmount = baseToken < quoteToken
                ? FullMath.mulDiv(ratioX128, baseAmount, 1 << 128)
                : FullMath.mulDiv(1 << 128, baseAmount, ratioX128);
        }
    }
}
