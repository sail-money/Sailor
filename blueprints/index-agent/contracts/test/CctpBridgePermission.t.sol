// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Context} from "@sail/interfaces/IPermission.sol";
import {CctpBridgePermission} from "../mandates/CctpBridgePermission.sol";

/// Foundry tests for the CCTP bridge permission. Runs with `forge test`, needs no
/// external libraries (a failed require reverts = a failing test). Every call the
/// agent must be able to make (returns true) and every bound it must not cross
/// (returns false) is covered, per Gate 4.
contract CctpBridgePermissionTest {
    address internal constant MESSENGER = 0x1111111111111111111111111111111111111111;
    address internal constant USDC = 0x2222222222222222222222222222222222222222;
    address internal constant OTHER_TOKEN = 0x3333333333333333333333333333333333333333;
    address internal constant ACCOUNT = 0x000000000000000000000000000000000000Acc0; // the SMA, same CREATE2 address on every chain
    bytes4 internal constant DEPOSIT_FOR_BURN = 0x6fd3504e;
    bytes4 internal constant OTHER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

    uint32 internal constant DOMAIN_ALLOWED = 6; // Base
    uint32 internal constant DOMAIN_OTHER = 999;

    CctpBridgePermission internal permission;

    function setUp() public {
        uint32[] memory domains = new uint32[](1);
        domains[0] = DOMAIN_ALLOWED;
        permission = new CctpBridgePermission(MESSENGER, USDC, domains, 1000e6); // cap 1000 USDC
    }

    function _ctx(address target, bytes4 selector, uint256 value) internal view returns (Context memory) {
        return Context({
            account: ACCOUNT,
            manager: address(0xA9E7),
            submitter: address(0xA9E7),
            target: target,
            selector: selector,
            value: value,
            blockTimestamp: block.timestamp,
            blockNumber: block.number,
            configEpoch: 0
        });
    }

    function _data(uint256 amount, uint32 domain, bytes32 recipient, address token)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(DEPOSIT_FOR_BURN, amount, domain, recipient, token);
    }

    function _selfRecipient() internal pure returns (bytes32) {
        return bytes32(uint256(uint160(ACCOUNT)));
    }

    function test_AllowsInBoundsBurn() public view {
        bytes memory data = _data(500e6, DOMAIN_ALLOWED, _selfRecipient(), USDC);
        require(permission.evaluate(data, _ctx(MESSENGER, DEPOSIT_FOR_BURN, 0)), "must allow in-bounds burn");
    }

    function test_RejectsWrongTarget() public view {
        bytes memory data = _data(500e6, DOMAIN_ALLOWED, _selfRecipient(), USDC);
        require(
            !permission.evaluate(data, _ctx(address(0x9999), DEPOSIT_FOR_BURN, 0)),
            "must reject a target other than the messenger"
        );
    }

    function test_RejectsWrongSelector() public view {
        bytes memory data = _data(500e6, DOMAIN_ALLOWED, _selfRecipient(), USDC);
        require(
            !permission.evaluate(data, _ctx(MESSENGER, OTHER_SELECTOR, 0)),
            "must reject a selector other than depositForBurn"
        );
    }

    function test_RejectsNonUsdcToken() public view {
        bytes memory data = _data(500e6, DOMAIN_ALLOWED, _selfRecipient(), OTHER_TOKEN);
        require(
            !permission.evaluate(data, _ctx(MESSENGER, DEPOSIT_FOR_BURN, 0)),
            "must reject a burnToken other than USDC"
        );
    }

    function test_RejectsOverCapAmount() public view {
        bytes memory data = _data(1001e6, DOMAIN_ALLOWED, _selfRecipient(), USDC);
        require(
            !permission.evaluate(data, _ctx(MESSENGER, DEPOSIT_FOR_BURN, 0)),
            "must reject an amount above the per-tx cap"
        );
    }

    function test_RejectsOffAllowlistDomain() public view {
        bytes memory data = _data(500e6, DOMAIN_OTHER, _selfRecipient(), USDC);
        require(
            !permission.evaluate(data, _ctx(MESSENGER, DEPOSIT_FOR_BURN, 0)),
            "must reject a destination domain outside the allowlist"
        );
    }

    function test_RejectsWrongRecipient() public view {
        bytes32 attacker = bytes32(uint256(uint160(address(0xBEEF))));
        bytes memory data = _data(500e6, DOMAIN_ALLOWED, attacker, USDC);
        require(
            !permission.evaluate(data, _ctx(MESSENGER, DEPOSIT_FOR_BURN, 0)),
            "must reject mintRecipient != account"
        );
    }

    function test_RejectsNativeValue() public view {
        bytes memory data = _data(500e6, DOMAIN_ALLOWED, _selfRecipient(), USDC);
        require(
            !permission.evaluate(data, _ctx(MESSENGER, DEPOSIT_FOR_BURN, 1)),
            "must reject non-zero native value"
        );
    }
}
