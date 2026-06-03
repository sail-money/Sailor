// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

/// @title BoundedCallPermission
/// @notice General-purpose IPermission primitive. Bounds the universal properties of any call:
///         allowed targets, allowed selectors, and max ETH value. Protocol-agnostic.
///         For calldata-parameter bounds (amount caps, recipient checks, slippage), write a
///         protocol-specific permission — see examples/permissions/ for the pattern per protocol.
/// @dev Deploy one instance per SMA with constructor-configured parameters.
contract BoundedCallPermission is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedCallPermission");

    mapping(address => bool) public isAllowedTarget;
    mapping(bytes4 => bool) public isAllowedSelector;
    bool public immutable SELECTOR_FILTERING;
    uint256 public immutable MAX_VALUE;

    constructor(address[] memory allowedTargets, bytes4[] memory allowedSelectors, uint256 maxValue) {
        for (uint256 i = 0; i < allowedTargets.length; i++) isAllowedTarget[allowedTargets[i]] = true;
        SELECTOR_FILTERING = allowedSelectors.length > 0;
        for (uint256 i = 0; i < allowedSelectors.length; i++) isAllowedSelector[allowedSelectors[i]] = true;
        MAX_VALUE = maxValue;
    }

    function evaluate(bytes calldata, Context calldata ctx) external view returns (bool) {
        if (!isAllowedTarget[ctx.target]) return false;
        if (SELECTOR_FILTERING && !isAllowedSelector[ctx.selector]) return false;
        if (ctx.value > MAX_VALUE) return false;
        return true;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
