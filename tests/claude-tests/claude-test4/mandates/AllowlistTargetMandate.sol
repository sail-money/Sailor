// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

/// @title  AllowlistTargetMandate
/// @notice Example mandate — permits dispatch only to allowlisted target
///         addresses. Configured entirely via the constructor.
contract AllowlistTargetMandate is IPermission {
    address public immutable permissionSigner;
    mapping(address => bool) public isAllowedTarget;

    /// @param _permissionSigner The Safe's permission signer (metadata / future use).
    /// @param allowedTargets    Call targets this mandate permits.
    constructor(address _permissionSigner, address[] memory allowedTargets) {
        permissionSigner = _permissionSigner;
        for (uint256 i = 0; i < allowedTargets.length; i++) {
            isAllowedTarget[allowedTargets[i]] = true;
        }
    }

    /// @inheritdoc IPermission
    function evaluate(bytes calldata, Context calldata ctx) external view returns (bool) {
        return isAllowedTarget[ctx.target];
    }

    /// @inheritdoc IPermission
    function discriminator() external pure returns (bytes32) {
        return keccak256("AllowlistTargetMandate");
    }
}
