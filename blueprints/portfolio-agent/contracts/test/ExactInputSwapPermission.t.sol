// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Context} from "@sail/interfaces/IPermission.sol";
import {ExactInputSwapPermission} from "../mandates/ExactInputSwapPermission.sol";

/// Foundry tests for the bespoke exactInput (multi-hop) swap permission. Runs with
/// `forge test`. Every in-bounds call the agent must make (returns true) and every
/// bound it must not cross (returns false) is covered, per Gate 4.
contract ExactInputSwapPermissionTest {
    address internal constant SWAP_ROUTER_02 = 0x2626664c2603336E57B271c5C0b26F421741e481; // Base SwapRouter02 (exactInputSingle)
    address internal constant CLASSIC_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564; // classic SwapRouter (multi-hop exactInput)
    address internal constant AERO_ROUTER = 0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F; // Aerodrome Slipstream

    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant CBHYPE = 0xB200000000000000000000451d033a5000cb479e;
    address internal constant UNI = 0xc3De830EA07524a0761646a6a4e4be0e114a3C83;
    address internal constant AAVE = 0x63706e401c06ac8513145b7687A14804d17f814b;
    address internal constant MORPHO = 0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842;
    address internal constant SKY = 0x56072C95FAA701256059aa122697B133aDEd9279;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7; // second hub (Ethereum)
    address internal constant ZAMA = 0xA12CC123ba206d4031D1c7f6223D1C2Ec249f4f3; // two-hop via USDT
    address internal constant RANDOM_TOKEN = 0x1111111111111111111111111111111111111111;

    address internal constant ACCOUNT = 0x000000000000000000000000000000000000Acc0;
    bytes4 internal constant EXACT_INPUT = 0xc04b8d59;
    bytes4 internal constant EXACT_INPUT_SINGLE = 0x04e45aaf;
    bytes4 internal constant OTHER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

    ExactInputSwapPermission internal permission;

    function setUp() public {
        address[] memory routers = new address[](3);
        routers[0] = SWAP_ROUTER_02;
        routers[1] = CLASSIC_ROUTER;
        routers[2] = AERO_ROUTER;
        address[] memory tokensIn = new address[](1);
        tokensIn[0] = USDC;
        address[] memory tokensOut = new address[](6);
        tokensOut[0] = CBHYPE;
        tokensOut[1] = SKY;
        tokensOut[2] = UNI;
        tokensOut[3] = AAVE;
        tokensOut[4] = MORPHO;
        tokensOut[5] = ZAMA;
        address[] memory vias = new address[](2);
        vias[0] = WETH;
        vias[1] = USDT;
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
        require(permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "single-hop buy must pass");
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
        require(permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "two-hop buy via WETH must pass");
    }

    function test_AllowsTwoHopBuyViaUsdt() public view {
        // ZAMA has no USDC pool; it routes USDC → USDT (500) → ZAMA (500). USDT is an allowlisted hub.
        bytes memory path = _path(USDC, 500, USDT, 500, ZAMA);
        bytes memory data = _exactInput(path, ACCOUNT, 50e6, 1);
        require(permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "two-hop buy via USDT must pass");
    }

    function test_AllowsSellZamaViaUsdt() public view {
        bytes memory path = _path(ZAMA, 500, USDT, 500, USDC);
        bytes memory data = _exactInput(path, ACCOUNT, 1000e18, 1);
        require(permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "sell ZAMA via USDT must pass");
    }

    function test_RejectsZamaViaUnlistedHub() public view {
        bytes memory path = _path(USDC, 500, RANDOM_TOKEN, 500, ZAMA);
        bytes memory data = _exactInput(path, ACCOUNT, 50e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "ZAMA via unlisted hub must fail");
    }

    function test_RejectsHubAsTokenOut() public view {
        // USDT is a hub, not a basket token: a direct USDC → USDT swap must be denied.
        bytes memory path = _path(USDC, 500, address(0), 0, USDT);
        bytes memory data = _exactInput(path, ACCOUNT, 50e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "hub as tokenOut must fail");
    }

    function test_AllowsSellBackToUsdc() public view {
        bytes memory path = _path(SKY, 3000, WETH, 500, USDC);
        bytes memory data = _exactInput(path, ACCOUNT, 100e18, 1); // 100 SKY (18 dec), under sell cap
        require(permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "sell back to USDC must pass");
    }

    function test_AllowsBuyAtCap() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 1000e6, 1); // exactly the buy cap
        require(permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "buy at cap must pass");
    }

    // ── Must-fail: structural bounds ───────────────────────────────────────────

    function test_RejectsWrongSelector() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, OTHER_SELECTOR, 0)), "wrong selector must fail");
    }

    function test_RejectsWrongRouter() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(address(0x9999), EXACT_INPUT, 0)), "unlisted router must fail");
    }

    function test_RejectsNativeValue() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 1)), "native value must fail");
    }

    function test_RejectsWrongRecipient() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, address(0xBEEF), 500e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "recipient != account must fail");
    }

    function test_RejectsSelfRoute() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, USDC);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "self-route must fail");
    }

    function test_RejectsTokenNotOnAllowlist() public view {
        // tokenOut = RANDOM_TOKEN is not in tokensOut
        bytes memory path = _path(USDC, 3000, address(0), 0, RANDOM_TOKEN);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "unlisted tokenOut must fail");
    }

    function test_RejectsTokenInNotOnAllowlist() public view {
        // tokenIn = RANDOM_TOKEN is not in tokensIn (and not a basket token)
        bytes memory path = _path(RANDOM_TOKEN, 3000, address(0), 0, USDC);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "unlisted tokenIn must fail");
    }

    function test_RejectsBadPathLength() public view {
        // 44 bytes — not 43, not 66
        bytes memory path = abi.encodePacked(USDC, uint24(3000), CBHYPE, uint8(0));
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "bad path length must fail");
    }

    function test_RejectsTwoHopViaNotAllowlisted() public view {
        // two-hop via RANDOM_TOKEN instead of WETH
        bytes memory path = _path(USDC, 500, RANDOM_TOKEN, 3000, SKY);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "unlisted via must fail");
    }

    // ── Must-fail: amount bounds ───────────────────────────────────────────────

    function test_RejectsBuyOverCap() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 1001e6, 1); // buy cap + 1 USDC
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "over-cap buy must fail");
    }

    function test_RejectsSellOverCap() public view {
        bytes memory path = _path(SKY, 3000, WETH, 500, USDC);
        bytes memory data = _exactInput(path, ACCOUNT, 1e25, 1); // over the 1e24 sell cap
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "over-cap sell must fail");
    }

    function test_RejectsZeroMinOut() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 0); // zero amountOutMinimum
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "zero min-out must fail");
    }

    function test_RejectsZeroAmountIn() public view {
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 0, 1); // zero amountIn
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "zero amountIn must fail");
    }

    function test_RejectsMalformedCalldata() public view {
        bytes memory data = hex"c04b8d59"; // selector only, no params
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "truncated calldata must fail");
    }

    function test_RejectsTwoHopViaBasketToken() public view {
        // SKY is an allowed tokenOut but not a hub: via must be in viaTokens, not merely allowlisted.
        bytes memory path = _path(USDC, 500, SKY, 3000, CBHYPE);
        bytes memory data = _exactInput(path, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "basket token as via must fail");
    }

    // ── Must-fail: ABI layout (fixed-slot reads require canonical offsets + exact length) ──

    /// Hand-rolled tuple body: [pathOffset][recipient][deadline][amountIn][minOut][pathLen][path padded].
    /// The permission reads slots 2, 4, 5, 6 and the path bytes by fixed position.
    function _tupleBody(uint256 pathOffset, address recipient, uint256 amountIn, bytes memory path)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            pathOffset,
            uint256(uint160(recipient)),
            uint256(type(uint32).max),
            amountIn,
            uint256(1),
            uint256(path.length),
            path,
            new bytes((32 - (path.length % 32)) % 32)
        );
    }

    function _rawExactInput(uint256 outerOffset, bytes memory body) internal pure returns (bytes memory) {
        return abi.encodePacked(EXACT_INPUT, outerOffset, body);
    }

    function test_RawEncodingMatchesCanonicalSingleHop() public view {
        // Sanity: the hand-rolled builder with canonical offsets is byte-identical to abi.encode.
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory raw = _rawExactInput(0x20, _tupleBody(0xa0, ACCOUNT, 500e6, path));
        ExactInputParams memory p = ExactInputParams({
            path: path, recipient: ACCOUNT, deadline: type(uint32).max, amountIn: 500e6, amountOutMinimum: 1
        });
        require(keccak256(raw) == keccak256(abi.encodeWithSelector(EXACT_INPUT, p)), "raw builder drifted");
        require(permission.evaluate(raw, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "canonical single-hop must pass");
    }

    function test_RawEncodingMatchesCanonicalTwoHop() public view {
        bytes memory path = _path(USDC, 500, WETH, 3000, SKY);
        bytes memory raw = _rawExactInput(0x20, _tupleBody(0xa0, ACCOUNT, 500e6, path));
        ExactInputParams memory p = ExactInputParams({
            path: path, recipient: ACCOUNT, deadline: type(uint32).max, amountIn: 500e6, amountOutMinimum: 1
        });
        require(keccak256(raw) == keccak256(abi.encodeWithSelector(EXACT_INPUT, p)), "raw builder drifted");
        require(permission.evaluate(raw, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "canonical two-hop must pass");
    }

    function test_RejectsNonCanonicalOuterOffset() public view {
        // slot 0 = 0x40 instead of 0x20, with a compliant decoy at the fixed slots.
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _rawExactInput(0x40, _tupleBody(0xa0, ACCOUNT, 500e6, path));
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "outer offset != 0x20 must fail");
    }

    function test_RejectsDecoyTupleWithSecondTupleAppended() public view {
        // The full bypass shape: compliant decoy at the fixed slots, slot 0 pointing past it at a
        // second tuple (wrong recipient, over cap, unlisted tokenOut) that the router would decode.
        bytes memory decoyPath = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory realPath = _path(USDC, 3000, address(0), 0, RANDOM_TOKEN);
        bytes memory decoy = _tupleBody(0xa0, ACCOUNT, 500e6, decoyPath);
        bytes memory real = _tupleBody(0xa0, address(0xBEEF), 1_000_000e6, realPath);
        bytes memory data = abi.encodePacked(_rawExactInput(32 + decoy.length, decoy), real);
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "decoy + second tuple must fail");
    }

    function test_RejectsNonCanonicalPathOffset() public view {
        // slot 1 = 0xc0 instead of 0xa0; everything else canonical.
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = _rawExactInput(0x20, _tupleBody(0xc0, ACCOUNT, 500e6, path));
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "path offset != 0xa0 must fail");
    }

    function test_RejectsTrailingBytes() public view {
        // Otherwise-valid calldata with a word appended after the padded path.
        bytes memory path = _path(USDC, 3000, address(0), 0, CBHYPE);
        bytes memory data = abi.encodePacked(_exactInput(path, ACCOUNT, 500e6, 1), new bytes(32));
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "trailing bytes must fail");
    }

    function test_RejectsTrailingByteTwoHop() public view {
        // A single stray byte after a two-hop path (66 bytes pads to 96) is still an exact-length miss.
        bytes memory path = _path(USDC, 500, WETH, 3000, SKY);
        bytes memory data = abi.encodePacked(_exactInput(path, ACCOUNT, 500e6, 1), uint8(0));
        require(!permission.evaluate(data, _ctx(CLASSIC_ROUTER, EXACT_INPUT, 0)), "trailing byte must fail");
    }

    // ── exactInputSingle (SwapRouter02 — single-hop Uniswap V3 on Base) ─────────

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function _exactInputSingle(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 minOut)
        internal
        view
        returns (bytes memory)
    {
        ExactInputSingleParams memory p = ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: recipient,
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });
        return abi.encodeWithSelector(EXACT_INPUT_SINGLE, p);
    }

    function test_AllowsExactInputSingleBuyUni() public view {
        bytes memory data = _exactInputSingle(USDC, UNI, 10000, ACCOUNT, 500e6, 1);
        require(permission.evaluate(data, _ctx(SWAP_ROUTER_02, EXACT_INPUT_SINGLE, 0)), "single-hop UNI buy must pass");
    }

    function test_AllowsExactInputSingleBuyAave() public view {
        bytes memory data = _exactInputSingle(USDC, AAVE, 3000, ACCOUNT, 500e6, 1);
        require(permission.evaluate(data, _ctx(SWAP_ROUTER_02, EXACT_INPUT_SINGLE, 0)), "single-hop AAVE buy must pass");
    }

    function test_AllowsExactInputSingleBuyMorpho() public view {
        bytes memory data = _exactInputSingle(USDC, MORPHO, 10000, ACCOUNT, 500e6, 1);
        require(permission.evaluate(data, _ctx(SWAP_ROUTER_02, EXACT_INPUT_SINGLE, 0)), "single-hop MORPHO buy must pass");
    }

    function test_AllowsExactInputSingleSell() public view {
        bytes memory data = _exactInputSingle(UNI, USDC, 10000, ACCOUNT, 100e18, 1);
        require(permission.evaluate(data, _ctx(SWAP_ROUTER_02, EXACT_INPUT_SINGLE, 0)), "single-hop UNI sell must pass");
    }

    function test_RejectsExactInputSingleWrongRecipient() public view {
        bytes memory data = _exactInputSingle(USDC, UNI, 10000, address(0xBEEF), 500e6, 1);
        require(!permission.evaluate(data, _ctx(SWAP_ROUTER_02, EXACT_INPUT_SINGLE, 0)), "recipient != account must fail");
    }

    function test_RejectsExactInputSingleOverCap() public view {
        bytes memory data = _exactInputSingle(USDC, UNI, 10000, ACCOUNT, 1001e6, 1);
        require(!permission.evaluate(data, _ctx(SWAP_ROUTER_02, EXACT_INPUT_SINGLE, 0)), "over-cap buy must fail");
    }

    function test_RejectsExactInputSingleZeroMinOut() public view {
        bytes memory data = _exactInputSingle(USDC, UNI, 10000, ACCOUNT, 500e6, 0);
        require(!permission.evaluate(data, _ctx(SWAP_ROUTER_02, EXACT_INPUT_SINGLE, 0)), "zero min-out must fail");
    }

    function test_RejectsExactInputSingleUnlistedToken() public view {
        bytes memory data = _exactInputSingle(USDC, RANDOM_TOKEN, 3000, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(SWAP_ROUTER_02, EXACT_INPUT_SINGLE, 0)), "unlisted tokenOut must fail");
    }

    function test_RejectsExactInputSingleWrongRouter() public view {
        bytes memory data = _exactInputSingle(USDC, UNI, 10000, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(address(0x9999), EXACT_INPUT_SINGLE, 0)), "unlisted router must fail");
    }

    function test_RejectsExactInputSingleWrongSelector() public view {
        bytes memory data = _exactInputSingle(USDC, UNI, 10000, ACCOUNT, 500e6, 1);
        require(!permission.evaluate(data, _ctx(SWAP_ROUTER_02, OTHER_SELECTOR, 0)), "wrong selector must fail");
    }
}
