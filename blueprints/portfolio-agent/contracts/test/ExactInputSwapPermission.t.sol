// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Context} from "@sail/interfaces/IPermission.sol";
import {ExactInputSwapPermission} from "../mandates/ExactInputSwapPermission.sol";

/// Foundry tests for the bespoke exactInput (multi-hop) swap permission. Runs with
/// `forge test`. Every in-bounds call the agent must make (returns true) and every
/// bound it must not cross (returns false) is covered, per Gate 4.
contract ExactInputSwapPermissionTest {
    address internal constant UNI_ROUTER = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;
    address internal constant AERO_ROUTER = 0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F;

    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant CBHYPE = 0xB200000000000000000000451d033a5000cb479e;
    address internal constant SKY = 0x56072C95FAA701256059aa122697B133aDEd9279;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant RANDOM_TOKEN = 0x1111111111111111111111111111111111111111;

    address internal constant ACCOUNT = 0x000000000000000000000000000000000000Acc0;
    bytes4 internal constant EXACT_INPUT = 0xc04b8d59;
    bytes4 internal constant OTHER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

    ExactInputSwapPermission internal permission;

    function setUp() public {
        address[] memory routers = new address[](2);
        routers[0] = UNI_ROUTER;
        routers[1] = AERO_ROUTER;
        address[] memory tokensIn = new address[](1);
        tokensIn[0] = USDC;
        address[] memory tokensOut = new address[](2);
        tokensOut[0] = CBHYPE;
        tokensOut[1] = SKY;
        address[] memory vias = new address[](1);
        vias[0] = WETH;
        // buy cap 1000 USDC (6 dec); sell cap generous (1e24 ~ 1M tokens @18dec)
        permission = new ExactInputSwapPermission(routers, tokensIn, tokensOut, vias, 1000e6, 1e24);
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

    /// Build the tight-packed Uniswap V3 path. `fee` is 3 bytes (or tickSpacing on Aerodrome).
    function _path(address inTok, uint24 fee1, address via, uint24 fee2, address outTok)
        internal
        pure
        returns (bytes memory)
    {
        if (via == address(0)) {
            return abi.encodePacked(inTok, fee1, outTok); // 20+3+20 = 43 bytes
        }
        return abi.encodePacked(inTok, fee1, via, fee2, outTok); // 20+3+20+3+20 = 66 bytes
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function _exactInput(bytes memory path, address recipient, uint256 amountIn, uint256 minOut)
        internal
        view
        returns (bytes memory)
    {
        // The runtime (viem) encodes `exactInput` with the params wrapped in a single tuple — this
        // must match that, or the test passes against a shape the runtime never sends.
        ExactInputParams memory p = ExactInputParams({
            path: path,
            recipient: recipient,
            deadline: block.timestamp + 3600,
            amountIn: amountIn,
            amountOutMinimum: minOut
        });
        return abi.encodeWithSelector(EXACT_INPUT, p);
    }

    // ── Must-pass ──────────────────────────────────────────────────────────────

    function test_AllowsSingleHopBuy() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "single-hop buy must pass");
    }

    function test_AllowsAerodromeBuyWithTickSpacing() public view {
        // Aerodrome Slipstream: the 3-byte field is tickSpacing (200), not a fee tier.
        bytes memory path = _path(USDC, 200, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(permission.evaluate(data, _ctx(AERO_ROUTER, EXACT_INPUT, 0)), "aerodrome buy must pass");
    }

    function test_AllowsTwoHopBuyViaWeth() public view {
        bytes memory path = _path(USDC, 500, WETH, 3000, SKY);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "two-hop buy via WETH must pass");
    }

    function test_AllowsSellBackToUsdc() public view {
        bytes memory path = _path(SKY, 3000, WETH, 500, USDC);
        bytes memory data = _exactInput(path, ACCOUNT, 100e18, 1); // 100 SKY (18 dec), under sell cap
        require(permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "sell back to USDC must pass");
    }

    function test_AllowsBuyAtCap() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 1000e6, 1); // exactly the buy cap
        require(permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "buy at cap must pass");
    }

    // ── Must-fail: structural bounds ───────────────────────────────────────────

    function test_RejectsWrongSelector() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, OTHER_SELECTOR, 0)), "wrong selector must fail");
    }

    function test_RejectsWrongRouter() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(address(0x9999), EXACT_INPUT, 0)), "unlisted router must fail");
    }

    function test_RejectsNativeValue() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 1)), "native value must fail");
    }

    function test_RejectsWrongRecipient() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, address(0xBEEF), 500e6, 1);
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "recipient != account must fail");
    }

    function test_RejectsSelfRoute() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, USDC);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "self-route must fail");
    }

    function test_RejectsTokenNotOnAllowlist() public view {
        // tokenOut = RANDOM_TOKEN is not in tokensOut
        bytes memory path = _path(USDC, 3000, address(0), 0, RANDOM_TOKEN);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "unlisted tokenOut must fail");
    }

    function test_RejectsTokenInNotOnAllowlist() public view {
        // tokenIn = RANDOM_TOKEN is not in tokensIn (and not a basket token)
        bytes memory path = _path(RANDOM_TOKEN, 3000, address(0), 0, USDC);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "unlisted tokenIn must fail");
    }

    function test_RejectsBadPathLength() public view {
        // 44 bytes — not 43, not 66
        bytes memory path = abi.encodePacked(USDC, uint24(3000), CBHYPE, uint8(0));
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "bad path length must fail");
    }

    function test_RejectsTwoHopViaNotAllowlisted() public view {
        // two-hop via RANDOM_TOKEN instead of WETH
        bytes memory path = _path(USDC, 500, RANDOM_TOKEN, 3000, SKY);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "unlisted via must fail");
    }

    // ── Must-fail: amount bounds ───────────────────────────────────────────────

    function test_RejectsBuyOverCap() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 1001e6, 1); // buy cap + 1 USDC
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "over-cap buy must fail");
    }

    function test_RejectsSellOverCap() public view {
        bytes memory path = _path(SKY, 3000, WETH, 500, USDC);
        bytes memory data = _exactInput(path, ACCOUNT, 1e25, 1); // over the 1e24 sell cap
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "over-cap sell must fail");
    }

    function test_RejectsZeroMinOut() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 0); // zero amountOutMinimum
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "zero min-out must fail");
    }

    function test_RejectsZeroAmountIn() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 0, 1); // zero amountIn
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "zero amountIn must fail");
    }

    function test_RejectsMalformedCalldata() public view {
        bytes memory data = hex"c04b8d59"; // selector only, no params
        require(!permission.evaluate(data, _ctx(UNI_ROUTER, EXACT_INPUT, 0)), "truncated calldata must fail");
    }
}
