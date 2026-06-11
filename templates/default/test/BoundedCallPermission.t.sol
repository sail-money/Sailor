// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Context} from "@sail/interfaces/IPermission.sol";
import {BoundedCallPermission} from "../mandates/BoundedCallPermission.sol";

/// Foundry tests for the scaffolded example permission. Runs with `forge test`
/// and needs no external libraries: a failed `require` reverts, and a reverting
/// test function is a test failure. (Add forge-std with `forge install
/// foundry-rs/forge-std` if you want richer assertions and cheatcodes.)
///
/// When you author a permission in mandates/, copy this file and derive the
/// cases from the user's strategy: every call the agent must be able to make
/// (evaluate returns true) and every bound it must not cross (returns false).
/// `forge test` must pass BEFORE `sailor mandate deploy`, and simulate must
/// pass before `sailor mandate attach`.
contract BoundedCallPermissionTest {
    address internal constant ROUTER = 0x1111111111111111111111111111111111111111;
    address internal constant UNKNOWN = 0x2222222222222222222222222222222222222222;
    bytes4 internal constant ALLOWED_SELECTOR = bytes4(keccak256("exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))"));
    bytes4 internal constant OTHER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

    BoundedCallPermission internal permission;

    function setUp() public {
        address[] memory targets = new address[](1);
        targets[0] = ROUTER;
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = ALLOWED_SELECTOR;
        permission = new BoundedCallPermission(targets, selectors, 0);
    }

    function _ctx(address target, bytes4 selector, uint256 value) internal view returns (Context memory) {
        return Context({
            account: address(0xACC0), // the Safe
            manager: address(0xA9E7), // the agent wallet
            submitter: address(0xA9E7),
            target: target,
            selector: selector,
            value: value,
            blockTimestamp: block.timestamp,
            blockNumber: block.number
        });
    }

    function test_AllowsBoundedCall() public view {
        require(
            permission.evaluate("", _ctx(ROUTER, ALLOWED_SELECTOR, 0)),
            "must allow allowlisted target + selector with no ETH"
        );
    }

    function test_RejectsUnknownTarget() public view {
        require(
            !permission.evaluate("", _ctx(UNKNOWN, ALLOWED_SELECTOR, 0)),
            "must reject a target outside the allowlist"
        );
    }

    function test_RejectsUnknownSelector() public view {
        require(
            !permission.evaluate("", _ctx(ROUTER, OTHER_SELECTOR, 0)),
            "must reject a selector outside the allowlist"
        );
    }

    function test_RejectsEthValueAboveMax() public view {
        require(
            !permission.evaluate("", _ctx(ROUTER, ALLOWED_SELECTOR, 1)),
            "must reject ETH value above MAX_VALUE"
        );
    }
}
