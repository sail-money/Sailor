// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : Aave V3
// Version  : Pool (proxy) — fully on-chain, oracle-based liquidation
// Chain    : Arbitrum mainnet
// Target   : Aave V3 Pool  0x794a61358D6845594F94dc1DB02A252b5b4814aD
//
// ENFORCED ON-CHAIN (via kernel evaluate() on every dispatch):
//   borrow(address asset, uint256 amount, uint256 interestRateMode,
//          uint16 referralCode, address onBehalfOf)
//   • target must be AAVE_POOL
//   • asset must be in ALLOWED_ASSETS
//   • amount ≤ MAX_BORROW_AMOUNT
//   • onBehalfOf must equal ctx.account (the SMA — agent cannot borrow on behalf of others)
//   • interestRateMode must be in ALLOWED_RATE_MODES
//     (1 = stable [deprecated in V3.1], 2 = variable; restrict to [2] for V3.1+)
//
// NOT ENFORCED (agent code — can change without a new contract):
//   • Health factor management — the kernel cannot check post-borrow health factor
//   • referralCode (informational only, does not affect fund safety)
//   • Repayment timing — agent decides when to repay
//   • Collateral composition — managed by prior deposit permissions
//
// VERIFY BEFORE USE:
//   • Confirm Aave V3 Pool address on Arbitrum (0x794a... — verify on Arbiscan).
//   • Selector 0xa415bcad = borrow(address,uint256,uint256,uint16,address).
//     Compute: keccak256("borrow(address,uint256,uint256,uint16,address)")[0:4]
//     and confirm it matches before deploying.
//   • Aave V3.1 deprecated stable-rate borrowing (interestRateMode=1).
//     If using V3.1+, set allowedRateModes = [2] (variable only).
//   • MAX_BORROW_AMOUNT is in the asset's base units (e.g. 6 decimals for USDC).
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedBorrow_AaveV3_Arbitrum is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedBorrow_AaveV3_Arbitrum");

    address public immutable AAVE_POOL;
    mapping(address => bool) public isAllowedAsset;
    uint256 public immutable MAX_BORROW_AMOUNT;
    mapping(uint256 => bool) public isAllowedRateMode;

    // borrow(address,uint256,uint256,uint16,address)
    // VERIFY: keccak256("borrow(address,uint256,uint256,uint16,address)")[0:4] == 0xa415bcad
    bytes4 private constant SEL_BORROW = 0xa415bcad;

    /// @param aavePool         Aave V3 Pool proxy address
    /// @param allowedAssets    Assets the agent may borrow
    /// @param maxBorrowAmount  Per-call borrow cap in asset base units
    /// @param allowedRateModes Interest rate modes allowed (2 = variable; use [2] for V3.1+)
    constructor(
        address aavePool,
        address[] memory allowedAssets,
        uint256 maxBorrowAmount,
        uint256[] memory allowedRateModes
    ) {
        AAVE_POOL        = aavePool;
        MAX_BORROW_AMOUNT = maxBorrowAmount;
        for (uint256 i = 0; i < allowedAssets.length; i++) {
            isAllowedAsset[allowedAssets[i]] = true;
        }
        for (uint256 i = 0; i < allowedRateModes.length; i++) {
            isAllowedRateMode[allowedRateModes[i]] = true;
        }
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (ctx.target != AAVE_POOL)      return false;
        if (ctx.selector != SEL_BORROW)   return false;
        // borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        // = 5 ABI-encoded 32-byte slots after the 4-byte selector
        if (txData.length < 4 + 5 * 32)  return false;

        (
            address asset,
            uint256 amount,
            uint256 interestRateMode,
            /* uint16 referralCode — not bounded */,
            address onBehalfOf
        ) = abi.decode(txData[4:], (address, uint256, uint256, uint16, address));

        if (!isAllowedAsset[asset])           return false;
        if (amount > MAX_BORROW_AMOUNT)       return false;
        if (onBehalfOf != ctx.account)        return false;  // agent borrows only for the SMA
        if (!isAllowedRateMode[interestRateMode]) return false;

        return true;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
