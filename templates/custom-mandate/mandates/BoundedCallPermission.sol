// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";
// SailCalldata: safe helpers for extracting calldata parameters inside evaluate().
// Use SailCalldata.hasParams(txData, N) + SailCalldata.asAddress/asUint256/... instead of
// manual abi.decode when you need to bound specific call arguments (amounts, recipients, etc.).
// See lib/SailCalldata.sol for the full API and examples/permissions/ for protocol examples.
import {SailCalldata} from "./SailCalldata.sol";

/// @title BoundedCallPermission
/// @notice General-purpose IPermission primitive. Bounds the universal properties of any call:
///         allowed targets, allowed selectors, and max ETH value. Protocol-agnostic.
///         For calldata-parameter bounds (amount caps, recipient checks, slippage), use
///         SailCalldata (imported above) and write a protocol-specific permission —
///         see examples/permissions/ for the pattern per protocol.
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
