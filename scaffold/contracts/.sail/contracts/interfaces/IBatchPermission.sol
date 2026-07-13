// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A single subcall in a batch dispatch.
/// @dev The kernel executes each Call as safe.execTransactionFromModule(target, value, data, 0)
///      — operation is always CALL, never DELEGATECALL.
struct Call {
    address target; // MUST NOT equal the kernel (enforced by the kernel)
    uint256 value;  // native ETH forwarded (wei)
    bytes   data;   // calldata for the subcall
}

/// @notice Execution context passed to evaluateBatch on each batch dispatch (read-only snapshot).
struct BatchContext {
    address account;        // the Safe (SMA) whose assets are moved
    address manager;        // the delegated signer who authorised the batch
    address submitter;      // msg.sender of the dispatch (may differ from manager via a relayer)
    address permission;     // this batch permission contract
    bytes32 batchHash;      // keccak256(abi.encode(calls)) — stable id for the exact sequence
    uint256 blockTimestamp; // block.timestamp at dispatch
    uint256 blockNumber;    // block.number at dispatch
    uint256 configEpoch;    // kernel registrationEpoch(account, permission) at dispatch —
                            // same fail-closed freshness check as Context.configEpoch
}

/// @title  IBatchPermission
/// @notice Gates an atomic batch of subcalls. Evaluated via staticcall under a gas cap;
///         a revert / OOG / malformed return is treated as `false` (fail-closed).
interface IBatchPermission {
    /// @notice Validate an entire batch of subcalls and their cross-call invariants.
    function evaluateBatch(Call[] calldata calls, BatchContext calldata ctx) external view returns (bool);

    /// @notice Marker the kernel uses (try/catch) to detect batch-aware permissions. MUST return true.
    function isBatchPermission() external pure returns (bool);
}
