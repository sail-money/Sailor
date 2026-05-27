// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract AllowlistTargetMandate is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("AllowlistTargetMandate");

    address public immutable PERMISSION_SIGNER;
    mapping(address => bool) public isAllowedTarget;

    constructor(address _permissionSigner, address[] memory allowedTargets) {
        PERMISSION_SIGNER = _permissionSigner;
        for (uint256 i = 0; i < allowedTargets.length; i++) {
            isAllowedTarget[allowedTargets[i]] = true;
        }
    }

    function evaluate(bytes calldata, Context calldata ctx) external view returns (bool) {
        return isAllowedTarget[ctx.target];
    }

    function discriminator() external pure returns (bytes32) {
        return DISCRIMINATOR;
    }
}
