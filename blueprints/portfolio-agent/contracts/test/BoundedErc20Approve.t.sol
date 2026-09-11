// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Context} from "@sail/interfaces/IPermission.sol";
import {BoundedErc20Approve} from "../mandates/BoundedErc20Approve.sol";

/// Foundry tests for the bounded ERC-20 approve permission (agent-managed approve model).
/// Covers every in-bounds call the agent must make and every bound it must not cross.
contract BoundedErc20ApproveTest {
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant SKY = 0x56072C95FAA701256059aa122697B133aDEd9279;
    address internal constant ROUTER = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;
    address internal constant MESSENGER = 0x1682Ae6375C4E4A97e4B583BC394c861A46D8962;
    address internal constant RANDOM = 0x1111111111111111111111111111111111111111;

    address internal constant ACCOUNT = 0x000000000000000000000000000000000000Acc0;
    bytes4 internal constant APPROVE = 0x095ea7b3;
    bytes4 internal constant OTHER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

    BoundedErc20Approve internal permission;

    function setUp() public {
        address[] memory tokens = new address[](2);
        tokens[0] = USDC;
        tokens[1] = SKY;
        uint256[] memory caps = new uint256[](2);
        caps[0] = 20000e6; // 20k USDC (6 dec)
        caps[1] = 10000e18; // 10k SKY (18 dec)
        address[] memory spenders = new address[](2);
        spenders[0] = ROUTER;
        spenders[1] = MESSENGER;
        permission = new BoundedErc20Approve(tokens, spenders, caps);
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

    function _approve(address spender, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(APPROVE, spender, amount);
    }

    // ── Must-pass ──────────────────────────────────────────────────────────────

    function test_AllowsRouterApproveOnUsdc() public view {
        require(permission.evaluate(_approve(ROUTER, 1000e6), _ctx(USDC, APPROVE, 0)), "USDC->router approve must pass");
    }

    function test_AllowsMessengerApproveOnUsdc() public view {
        require(permission.evaluate(_approve(MESSENGER, 1000e6), _ctx(USDC, APPROVE, 0)), "USDC->messenger approve must pass");
    }

    function test_AllowsSellLegApproveOnBasketToken() public view {
        require(permission.evaluate(_approve(ROUTER, 100e18), _ctx(SKY, APPROVE, 0)), "SKY->router approve must pass");
    }

    function test_AllowsUsdcAtCap() public view {
        require(permission.evaluate(_approve(ROUTER, 20000e6), _ctx(USDC, APPROVE, 0)), "USDC approve at cap must pass");
    }

    function test_AllowsSkyAtItsOwnCap() public view {
        require(permission.evaluate(_approve(ROUTER, 10000e18), _ctx(SKY, APPROVE, 0)), "SKY approve at cap must pass");
    }

    // ── Must-fail: structural bounds ───────────────────────────────────────────

    function test_RejectsWrongSelector() public view {
        require(!permission.evaluate(_approve(ROUTER, 1000e6), _ctx(USDC, OTHER_SELECTOR, 0)), "wrong selector must fail");
    }

    function test_RejectsUnlistedToken() public view {
        require(!permission.evaluate(_approve(ROUTER, 1000e6), _ctx(RANDOM, APPROVE, 0)), "unlisted token must fail");
    }

    function test_RejectsUnlistedSpender() public view {
        require(!permission.evaluate(_approve(RANDOM, 1000e6), _ctx(USDC, APPROVE, 0)), "unlisted spender must fail");
    }

    function test_RejectsNativeValue() public view {
        require(!permission.evaluate(_approve(ROUTER, 1000e6), _ctx(USDC, APPROVE, 1)), "native value must fail");
    }

    function test_RejectsUsdcOverCap() public view {
        require(!permission.evaluate(_approve(ROUTER, 20001e6), _ctx(USDC, APPROVE, 0)), "over-cap USDC approve must fail");
    }

    function test_RejectsSkyOverItsCap() public view {
        require(!permission.evaluate(_approve(ROUTER, 10001e18), _ctx(SKY, APPROVE, 0)), "over-cap SKY approve must fail");
    }

    function test_RejectsMalformedCalldata() public view {
        bytes memory data = hex"095ea7b3";
        require(!permission.evaluate(data, _ctx(USDC, APPROVE, 0)), "truncated calldata must fail");
    }
}
