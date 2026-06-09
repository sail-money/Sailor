// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : Aave V3
// Version  : Pool (proxy) — fully on-chain, oracle-based accounting
// Chain    : Arbitrum mainnet (42161)
// Target   : Aave V3 Pool  0x794a61358D6845594F94dc1DB02A252b5b4814aD  (verified on Arbiscan;
//            same Pool as BoundedBorrow_AaveV3_Arbitrum — supply 0x617ba037 confirmed present
//            in the live implementation 0xf05fd3cc...)
//
// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
//   supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)  selector 0x617ba037
//     • target must be AAVE_POOL
//     • asset must be in ALLOWED_ASSETS
//     • amount ≤ MAX_SUPPLY_AMOUNT
//     • onBehalfOf must equal ctx.account (the SMA — collateral is credited to the SMA, not
//       to another account)
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
//   • referralCode (informational only, does not affect fund safety)
//   • Supply timing / cadence and choice of asset within ALLOWED_ASSETS
//   • Withdrawal: not gated here (add a withdraw(asset,amount,to) permission with to==SMA if needed)
//   • A supply also needs a prior ERC-20 approve of the Pool — gate that separately
//     (see BoundedApproveAndCallBatch.sol for the atomic approve→call→reset pattern).
//
// VERIFY BEFORE USE:
//   • Selector 0x617ba037 = supply(address,uint256,address,uint16) — verified via `cast sig`
//     and confirmed present in the deployed Pool implementation on Arbitrum.
//   • This is the canonical Aave V3 Pool.supply. (V3.x also exposes supplyWithPermit — not
//     gated here; add it if your agent supplies via EIP-2612 permits.)
//   • MAX_SUPPLY_AMOUNT is in the asset's base units (e.g. USDC = 6 decimals).
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedSupply_AaveV3_Arbitrum is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedSupply_AaveV3_Arbitrum");

    address public immutable AAVE_POOL;
    mapping(address => bool) public isAllowedAsset;
    uint256 public immutable MAX_SUPPLY_AMOUNT;

    // supply(address,uint256,address,uint16) — verified 0x617ba037
    bytes4 private constant SEL_SUPPLY = 0x617ba037;

    /// @param aavePool         Aave V3 Pool proxy address
    /// @param allowedAssets    Assets the agent may supply (must be non-empty)
    /// @param maxSupplyAmount  Per-call supply cap in asset base units (must be > 0)
    constructor(address aavePool, address[] memory allowedAssets, uint256 maxSupplyAmount) {
        require(aavePool != address(0),      "zero pool address");
        require(allowedAssets.length > 0,    "empty asset allowlist");
        require(maxSupplyAmount > 0,         "zero supply cap");
        AAVE_POOL        = aavePool;
        MAX_SUPPLY_AMOUNT = maxSupplyAmount;
        for (uint256 i = 0; i < allowedAssets.length; i++) {
            require(allowedAssets[i] != address(0), "zero asset address");
            isAllowedAsset[allowedAssets[i]] = true;
        }
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (ctx.target != AAVE_POOL)    return false;
        if (ctx.selector != SEL_SUPPLY) return false;
        // supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
        // = 4 ABI-encoded 32-byte slots after the 4-byte selector
        if (txData.length < 4 + 4 * 32) return false;

        (
            address asset,
            uint256 amount,
            address onBehalfOf,
            /* uint16 referralCode — not bounded */
        ) = abi.decode(txData[4:], (address, uint256, address, uint16));

        if (!isAllowedAsset[asset])       return false;
        if (amount > MAX_SUPPLY_AMOUNT)   return false;
        if (onBehalfOf != ctx.account)    return false; // collateral credited only to the SMA

        return true;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
