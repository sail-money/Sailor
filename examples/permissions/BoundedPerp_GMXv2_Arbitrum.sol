// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : GMX V2 (gmx-synthetics)
// Version  : ExchangeRouter / OrderHandler — fully on-chain oracle execution
//            NOT Hyperliquid (off-chain order book — permissions cannot bound orders)
// Chain    : Arbitrum mainnet (42161)
//
// ⚠ REFERENCE PATTERN — VERIFY SELECTOR, STRUCT, AND ROUTER AGAINST THE LIVE GMX ABI ⚠
//   GMX runs MULTIPLE versioned ExchangeRouter deployments on Arbitrum (e.g.
//   0x7c68c7866a64fa2160f78eeae12217ffbf871fa8, 0x602b805EedddBbD9ddff44A7dcBD46cb07849685,
//   and others) and HAS EVOLVED the CreateOrderParams struct over time (it added
//   `cancellationReceiver` to the addresses tuple and a trailing `dataList` bytes32[]).
//   The struct + selector below are taken from the CURRENT canonical source
//   (gmx-io/gmx-synthetics, contracts/order/IBaseOrderUtils.sol, main branch) and are
//   mutually consistent — but the specific router YOU target may run an OLDER struct
//   with a DIFFERENT selector. Selector mismatch ⇒ evaluate() returns false for every
//   legitimate order (fail-closed: safe, but the permission silently does nothing useful).
//   Before deploying you MUST:
//     1. Pick the exact ExchangeRouter your agent will call and read its verified ABI.
//     2. Confirm its createOrder selector == SEL_CREATE_ORDER below (recompute with
//        `cast sig "createOrder(<exact tuple>)"`); if not, update SEL_CREATE_ORDER and
//        the inline struct to match that router's version.
//     3. Set EXCHANGE_ROUTER (constructor arg) to that same router address.
//
// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
//   createOrder(IBaseOrderUtils.CreateOrderParams)  selector 0x212234c3 (current canonical struct)
//     • target must be EXCHANGE_ROUTER
//     • market must be in ALLOWED_MARKETS
//     • initialCollateralDeltaAmount ≤ MAX_COLLATERAL_AMOUNT
//     • sizeDeltaUsd ≤ MAX_SIZE_DELTA_USD
//     • isLong must be allowed (ALLOW_LONG / ALLOW_SHORT)
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
//   • Leverage ratio: sizeDeltaUsd vs collateralDeltaAmount are bounded separately
//     but their ratio (effective leverage) is not enforced — it depends on collateral price.
//   • acceptablePrice / triggerPrice: not bounded — agent controls entry price.
//   • decreasePositionSwapType, shouldUnwrapNativeToken, autoCancel: not bounded.
//   • swapPath (inside the addresses tuple): not bounded — any intermediate tokens allowed.
//   • receiver / cancellationReceiver: not bounded — set to ctx.account in your agent.
//
// VERIFY BEFORE USE:
//   • SEL_CREATE_ORDER = 0x212234c3 was computed (via `cast sig`) from the CURRENT canonical
//     tuple. Older routers differ — see the loud banner above. ALWAYS reconfirm.
//   • sizeDeltaUsd is in USD with 30 decimals (GMX V2 standard). E.g. $1000 = 1e33.
//   • initialCollateralDeltaAmount is in collateral token base units.
//   • Test with real calldata samples from your chosen GMX router before mainnet.
//   • Source: https://github.com/gmx-io/gmx-synthetics/blob/main/contracts/order/IBaseOrderUtils.sol
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
    // Computed via `cast sig` (split across lines for readability — paste as one string in the shell):
    //   "createOrder((address,address,address,address,address,address,address[]),"
    //               "(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256),"
    //               "uint8,uint8,bool,bool,bool,bytes32,bytes32[])"
    //   == 0x212234c3
    // ⚠ Older GMX routers use an earlier struct (no cancellationReceiver / no dataList) and a
    //   DIFFERENT selector. Reconfirm against your chosen router's ABI — see header banner.
    bytes4 private constant SEL_CREATE_ORDER = 0x212234c3;

    // ── Inline struct definitions — match the CURRENT canonical IBaseOrderUtils.CreateOrderParams ──
    // Source: https://github.com/gmx-io/gmx-synthetics/blob/main/contracts/order/IBaseOrderUtils.sol

    struct CreateOrderParamsAddresses {
        address receiver;
        address cancellationReceiver;  // added in a later GMX version — present in current struct
        address callbackContract;
        address uiFeeReceiver;
        address market;
        address initialCollateralToken;
        address[] swapPath;            // dynamic — makes this struct dynamic
    }

    struct CreateOrderParamsNumbers {
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
        CreateOrderParamsAddresses addresses;
        CreateOrderParamsNumbers   numbers;
        uint8   orderType;
        uint8   decreasePositionSwapType;
        bool    isLong;
        bool    shouldUnwrapNativeToken;
        bool    autoCancel;
        bytes32 referralCode;
        bytes32[] dataList;            // added in a later GMX version — present in current struct
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
