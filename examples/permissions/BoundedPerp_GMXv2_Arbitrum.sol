// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : GMX V2 (gmx-synthetics)
// Version  : ExchangeRouter / OrderHandler — fully on-chain oracle execution
//            NOT Hyperliquid (off-chain order book — permissions cannot bound orders)
// Chain    : Arbitrum mainnet
// Target   : ExchangeRouter  0x7c68c7866a64fa2160f78eeae12217ffbf871fa8
//            (verify on Arbiscan — GMX may redeploy; check their official docs)
//
// ENFORCED ON-CHAIN (via kernel evaluate() on every dispatch):
//   createOrder(CreateOrderParams params)  selector 0x414577b7
//   • target must be EXCHANGE_ROUTER
//   • market must be in ALLOWED_MARKETS
//   • initialCollateralDeltaAmount ≤ MAX_COLLATERAL_AMOUNT
//   • sizeDeltaUsd ≤ MAX_SIZE_DELTA_USD
//   • isLong must be in ALLOWED_DIRECTIONS (true=long, false=short, or both)
//
// NOT ENFORCED — documented limitations:
//   • Leverage ratio: sizeDeltaUsd vs collateralDeltaAmount are bounded separately
//     but their ratio (effective leverage) is not directly enforced here because
//     it depends on collateral price. Add a price-oracle leverage check if needed.
//   • acceptablePrice / triggerPrice: not bounded — agent controls entry price.
//     Add bounds if the strategy requires a price range check.
//   • decreasePositionSwapType, shouldUnwrapNativeToken, autoCancel: not bounded.
//   • swapPath (inside CreateOrderParamAddresses): not bounded — any intermediate
//     tokens in the swap path are allowed. Restrict if needed.
//   • receiver address: not bounded — set to ctx.account in your agent.
//
// STRUCT LAYOUT NOTE:
//   This contract defines CreateOrderParams inline. It must match EXACTLY the
//   struct layout in the deployed ExchangeRouter's IBaseOrderUtils. If GMX
//   updates the struct (e.g. adds a field), this permission will misparse calldata
//   and return false (fail closed — safe but non-functional).
//   VERIFY against BaseOrderUtils.sol at:
//   https://github.com/gmx-io/gmx-synthetics/blob/main/contracts/order/BaseOrderUtils.sol
//
// VERIFY BEFORE USE:
//   • Confirm ExchangeRouter address on Arbitrum (0x7c68... — verify on Arbiscan).
//   • Selector 0x414577b7 = createOrder(IBaseOrderUtils.CreateOrderParams).
//     Verify against the deployed contract's ABI tab on Arbiscan.
//   • sizeDeltaUsd is in USD with 30 decimals (GMX V2 standard). E.g. $1000 = 1e33.
//   • initialCollateralDeltaAmount is in collateral token base units.
//   • Test with real calldata samples from GMX V2 on Arbitrum testnet before mainnet.
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedPerp_GMXv2_Arbitrum is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedPerp_GMXv2_Arbitrum");

    address public immutable EXCHANGE_ROUTER;
    mapping(address => bool) public isAllowedMarket;
    uint256 public immutable MAX_COLLATERAL_AMOUNT;
    /// @dev sizeDeltaUsd uses GMX V2's 30-decimal USD representation. 1 USD = 1e30.
    uint256 public immutable MAX_SIZE_DELTA_USD;
    bool public immutable ALLOW_LONG;
    bool public immutable ALLOW_SHORT;

    // createOrder(IBaseOrderUtils.CreateOrderParams)
    // VERIFY: keccak256("createOrder(...)")[0:4] == 0x414577b7 on deployed ExchangeRouter
    bytes4 private constant SEL_CREATE_ORDER = 0x414577b7;

    // ── Inline struct definitions — MUST match IBaseOrderUtils.CreateOrderParams ──
    // Verify against:
    // https://github.com/gmx-io/gmx-synthetics/blob/main/contracts/order/BaseOrderUtils.sol

    struct CreateOrderParamAddresses {
        address receiver;
        address callbackContract;
        address uiFeeReceiver;
        address market;
        address initialCollateralToken;
        address[] swapPath;         // dynamic — makes this struct dynamic
    }

    struct CreateOrderParamNumbers {
        uint256 sizeDeltaUsd;
        uint256 initialCollateralDeltaAmount;
        uint256 triggerPrice;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint256 callbackGasLimit;
        uint256 minOutputAmount;
        uint256 validFromTime;
    }

    struct CreateOrderParams {
        CreateOrderParamAddresses addresses;
        CreateOrderParamNumbers   numbers;
        uint8   orderType;
        uint8   decreasePositionSwapType;
        bool    isLong;
        bool    shouldUnwrapNativeToken;
        bool    autoCancel;
        bytes32 referralCode;
    }

    /// @param exchangeRouter       GMX V2 ExchangeRouter address
    /// @param allowedMarkets       GMX V2 market addresses the agent may trade
    /// @param maxCollateralAmount  Per-order collateral cap in collateral token base units
    /// @param maxSizeDeltaUsd      Per-order position size cap in GMX USD (30 decimals)
    /// @param allowLong            Whether long orders are permitted
    /// @param allowShort           Whether short orders are permitted
    constructor(
        address exchangeRouter,
        address[] memory allowedMarkets,
        uint256 maxCollateralAmount,
        uint256 maxSizeDeltaUsd,
        bool allowLong,
        bool allowShort
    ) {
        EXCHANGE_ROUTER      = exchangeRouter;
        MAX_COLLATERAL_AMOUNT = maxCollateralAmount;
        MAX_SIZE_DELTA_USD   = maxSizeDeltaUsd;
        ALLOW_LONG           = allowLong;
        ALLOW_SHORT          = allowShort;
        for (uint256 i = 0; i < allowedMarkets.length; i++) {
            isAllowedMarket[allowedMarkets[i]] = true;
        }
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (ctx.target != EXCHANGE_ROUTER)      return false;
        if (ctx.selector != SEL_CREATE_ORDER)   return false;
        if (txData.length < 4)                  return false;

        // abi.decode handles the nested dynamic struct (address[] swapPath) correctly.
        // A malformed calldata or struct layout mismatch causes a revert → false (fail closed).
        CreateOrderParams memory p = abi.decode(txData[4:], (CreateOrderParams));

        if (!isAllowedMarket[p.addresses.market])                 return false;
        if (p.numbers.initialCollateralDeltaAmount > MAX_COLLATERAL_AMOUNT) return false;
        if (p.numbers.sizeDeltaUsd > MAX_SIZE_DELTA_USD)          return false;
        if (p.isLong  && !ALLOW_LONG)                             return false;
        if (!p.isLong && !ALLOW_SHORT)                            return false;

        return true;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
