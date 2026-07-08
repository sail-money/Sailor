// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title  IOracle
/// @notice Minimal price oracle interface consumed by the oracle-gated permission templates.
///         Vendored verbatim from Protocol/contracts/interfaces/IOracle.sol so this adapter
///         compiles standalone; the consuming SwapPermission only cares about the ABI shape.
interface IOracle {
    function getPrice(address base, address quote)
        external
        view
        returns (uint256 price, uint8 decimals, uint256 updatedAt);
}
