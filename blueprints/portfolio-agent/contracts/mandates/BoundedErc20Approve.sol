// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";
import {SailCalldata} from "./SailCalldata.sol";

/// @title BoundedErc20Approve
/// @notice Bounds a standalone ERC-20 `approve()` call. This is the agent-managed approve model:
///         the agent grants its own router/messenger allowance instead of the owner signing a
///         standing approve on the Safe. It is registered alongside the swap/bridge permissions.
///
/// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
///   approve(address,uint256)  selector 0x095ea7b3
///     • ctx.target ∈ tokens (the ERC-20 being approved — USDC, or a basket token on its sell leg)
///     • spender ∈ spenders (the routers / CCTP messengers this mandate already trusts)
///     • amount ≤ maxApproval[token] (per-(token) approve cap, in that token's base units;
///       0 == uncapped)
///     • ctx.value == 0 (approve never carries native value)
///
/// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
///   • how often the agent re-approves, and to what amount within the cap
///   • which of the allowlisted (token, spender) pairs it approves on a given tick
///   • a cumulative ceiling across many approves — this bounds each approve, not their sum
///     (the sum is bounded by the swap/bridge permissions' own per-tx caps)
///
/// NOTE: allowlists and per-token caps are constructor-fixed. Changing them means redeploying
///       + re-registering. Caps are in each token's OWN base units, so a 6-decimal USDC and an
///       18-decimal token each get their own entry (a single shared number would mis-size one).
contract BoundedErc20Approve is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedErc20Approve");
    bytes4 private constant APPROVE_SELECTOR = 0x095ea7b3; // approve(address,uint256)

    mapping(address => bool) public isAllowedToken;
    mapping(address => bool) public isAllowedSpender;
    mapping(address => uint256) public maxApproval; // 0 == uncapped for that token

    constructor(address[] memory tokens, address[] memory spenders, uint256[] memory maxApprovals) {
        require(tokens.length == maxApprovals.length, "BoundedErc20Approve: length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            isAllowedToken[tokens[i]] = true;
            maxApproval[tokens[i]] = maxApprovals[i];
        }
        for (uint256 i = 0; i < spenders.length; i++) isAllowedSpender[spenders[i]] = true;
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (!isAllowedToken[ctx.target]) return false;
        if (ctx.selector != APPROVE_SELECTOR) return false;
        if (ctx.value != 0) return false;
        if (!SailCalldata.hasParams(txData, 2)) return false;
        address spender = SailCalldata.asAddress(txData, 0);
        uint256 amount = SailCalldata.asUint256(txData, 1);
        if (!isAllowedSpender[spender]) return false;
        uint256 cap = maxApproval[ctx.target];
        if (cap != 0 && amount > cap) return false;
        return true;
    }

    function discriminator() external pure returns (bytes32) {
        return DISCRIMINATOR;
    }
}
