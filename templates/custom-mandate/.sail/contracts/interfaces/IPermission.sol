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
}

interface IPermission {
    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool);
    function discriminator() external view returns (bytes32);
}
