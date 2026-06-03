// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Execution context passed to every permission on each dispatch call.
/// @dev    Read-only snapshot of the transaction environment (staticcall).
struct Context {
    address account;        // the Safe whose assets are being moved
    address manager;        // the delegated signer who submitted the dispatch
    address submitter;      // msg.sender of the dispatch (may be a relayer)
    address target;         // the call target
    bytes4  selector;       // leading 4 bytes of calldata
    uint256 value;          // native ETH forwarded (wei)
    uint256 blockTimestamp; // block.timestamp at dispatch
    uint256 blockNumber;    // block.number at dispatch
}

/// @title  IPermission
/// @notice Interface every Sail permission (mandate) contract must implement.
/// @dev    Evaluated via staticcall with a fixed gas cap; a revert or gas
///         exhaustion is treated as `false`. Must not mutate state.
interface IPermission {
    /// @notice Decide whether a manager-submitted transaction is permitted.
    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool);

    /// @notice Optional stable identifier for off-chain indexing/deduplication.
    function discriminator() external view returns (bytes32);
}
