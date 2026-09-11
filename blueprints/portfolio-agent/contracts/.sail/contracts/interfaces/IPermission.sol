// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

struct Context {
    address account;
    address manager;
    address submitter;
    address target;
    bytes4 selector;
    uint256 value;
    uint256 blockTimestamp;
    uint256 blockNumber;
    /// @dev Kernel registrationEpoch(account, permission) at dispatch. Configurable
    ///      permissions fail closed on a mismatch with the epoch stamped at configure()
    ///      time; permissions without post-deploy configuration can ignore it.
    uint256 configEpoch;
}

interface IPermission {
    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool);
    function discriminator() external view returns (bytes32);
}
