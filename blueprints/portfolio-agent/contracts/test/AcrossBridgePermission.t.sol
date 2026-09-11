// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Context} from "@sail/interfaces/IPermission.sol";
import {AcrossBridgePermission} from "../mandates/AcrossBridgePermission.sol";

/// Foundry tests for the bespoke Across V3 bridge permission. Every in-bounds deposit the agent
/// must make (returns true) and every bound it must not cross (returns false) is covered, per
/// Gate 4. The calldata is built with abi.encodeWithSelector — the same ABI layout viem produces.
contract AcrossBridgePermissionTest {
    address internal constant SPOKE_POOL = 0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64; // Base
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // Base, 6 dec
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168; // Robinhood, 6 dec
    address internal constant ACCOUNT = 0x000000000000000000000000000000000000Acc0;
    address internal constant RANDOM = 0x1111111111111111111111111111111111111111;
    uint256 internal constant DEST = 4663;
    bytes4 internal constant DEPOSIT_V3 = 0x7b939232;
    bytes4 internal constant OTHER_SELECTOR = bytes4(keccak256("deposit(bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,bytes32,uint32,uint32,uint32,bytes)"));

    uint256 internal constant MAX_IN = 1000e6;
    uint256 internal constant MAX_FEE_BPS = 30;
    uint256 internal constant MAX_QUOTE_AGE = 3600;
    uint256 internal constant MAX_FILL = 21600;
    uint256 internal constant NOW = 1_788_883_715; // a fixed clock: Foundry's NOW is 1, which underflows "now − age"

    AcrossBridgePermission internal permission;

    function setUp() public {
        permission = new AcrossBridgePermission(SPOKE_POOL, USDC, USDG, DEST, MAX_IN, MAX_FEE_BPS, MAX_QUOTE_AGE, MAX_FILL, 6, 6);
    }

    function _ctx(address target, bytes4 selector, uint256 value) internal view returns (Context memory) {
        return Context({
            account: ACCOUNT,
            manager: address(0xA9E7),
            submitter: address(0xA9E7),
            target: target,
            selector: selector,
            value: value,
            blockTimestamp: NOW,
            blockNumber: block.number,
            configEpoch: 0
        });
    }

    struct D {
        address depositor;
        address recipient;
        address inputToken;
        address outputToken;
        uint256 inputAmount;
        uint256 outputAmount;
        uint256 destinationChainId;
        address exclusiveRelayer;
        uint32 quoteTimestamp;
        uint32 fillDeadline;
        uint32 exclusivityDeadline;
        bytes message;
    }

    /// A canonical in-bounds deposit: 200 USDC → ≥ 199.4 USDG (30 bps ceiling), quoted now, 2h deadline.
    function _good() internal view returns (D memory d) {
        d.depositor = ACCOUNT;
        d.recipient = ACCOUNT;
        d.inputToken = USDC;
        d.outputToken = USDG;
        d.inputAmount = 200e6;
        d.outputAmount = 199_700_000; // Across quoted ~0.146%; well above the 30 bps floor (199.4)
        d.destinationChainId = DEST;
        d.exclusiveRelayer = address(0);
        d.quoteTimestamp = uint32(NOW);
        d.fillDeadline = uint32(NOW + 7200);
        d.exclusivityDeadline = 0;
        d.message = "";
    }

    function _calldata(D memory d) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            DEPOSIT_V3,
            d.depositor,
            d.recipient,
            d.inputToken,
            d.outputToken,
            d.inputAmount,
            d.outputAmount,
            d.destinationChainId,
            d.exclusiveRelayer,
            d.quoteTimestamp,
            d.fillDeadline,
            d.exclusivityDeadline,
            d.message
        );
    }

    function _eval(D memory d) internal view returns (bool) {
        return permission.evaluate(_calldata(d), _ctx(SPOKE_POOL, DEPOSIT_V3, 0));
    }

    // ── Must-pass ──────────────────────────────────────────────────────────────

    function test_AllowsCanonicalDeposit() public view {
        require(_eval(_good()), "canonical deposit must pass");
    }

    function test_AllowsDepositAtCap() public view {
        D memory d = _good();
        d.inputAmount = MAX_IN;
        d.outputAmount = permission.minOutputFor(MAX_IN);
        require(_eval(d), "deposit at cap with output exactly at the floor must pass");
    }

    function test_AllowsQuoteAtMaxAge() public view {
        D memory d = _good();
        d.quoteTimestamp = uint32(NOW - MAX_QUOTE_AGE);
        require(_eval(d), "quote at max age must pass");
    }

    function test_AllowsFillDeadlineAtMax() public view {
        D memory d = _good();
        d.fillDeadline = uint32(NOW + MAX_FILL);
        require(_eval(d), "fill deadline at max must pass");
    }

    function test_MinOutputScalesDecimals() public {
        // 6-dec input → 18-dec output: 200 USDC must yield ≥ 199.4e18 at 30 bps.
        AcrossBridgePermission p = new AcrossBridgePermission(SPOKE_POOL, USDC, USDG, DEST, MAX_IN, MAX_FEE_BPS, MAX_QUOTE_AGE, MAX_FILL, 6, 18);
        require(p.minOutputFor(200e6) == 199_400_000 * 1e12, "scaled floor");
        // 18-dec input → 6-dec output: 200e18 must yield ≥ 199.4e6.
        AcrossBridgePermission q = new AcrossBridgePermission(SPOKE_POOL, USDG, USDC, 8453, 0, MAX_FEE_BPS, MAX_QUOTE_AGE, MAX_FILL, 18, 6);
        require(q.minOutputFor(200e18) == 199_400_000, "scaled floor down");
    }

    // ── Must-fail: identity and routing ───────────────────────────────────────

    function test_RejectsWrongTarget() public view {
        require(!permission.evaluate(_calldata(_good()), _ctx(RANDOM, DEPOSIT_V3, 0)), "unlisted target must fail");
    }

    function test_RejectsWrongSelector() public view {
        require(!permission.evaluate(_calldata(_good()), _ctx(SPOKE_POOL, OTHER_SELECTOR, 0)), "wrong selector must fail");
    }

    function test_RejectsNativeValue() public view {
        require(!permission.evaluate(_calldata(_good()), _ctx(SPOKE_POOL, DEPOSIT_V3, 1)), "native value must fail");
    }

    function test_RejectsWrongRecipient() public view {
        D memory d = _good();
        d.recipient = RANDOM;
        require(!_eval(d), "recipient != account must fail");
    }

    function test_RejectsWrongDepositor() public view {
        D memory d = _good();
        d.depositor = RANDOM;
        require(!_eval(d), "depositor != account must fail (refunds would leave the SMA)");
    }

    function test_RejectsWrongInputToken() public view {
        D memory d = _good();
        d.inputToken = RANDOM;
        require(!_eval(d), "wrong input token must fail");
    }

    function test_RejectsWrongOutputToken() public view {
        D memory d = _good();
        d.outputToken = RANDOM;
        require(!_eval(d), "wrong output token must fail");
    }

    function test_RejectsWrongDestination() public view {
        D memory d = _good();
        d.destinationChainId = 1;
        require(!_eval(d), "wrong destination chain must fail");
    }

    function test_RejectsExclusiveRelayer() public view {
        D memory d = _good();
        d.exclusiveRelayer = RANDOM;
        require(!_eval(d), "exclusive relayer must fail");
    }

    function test_RejectsExclusivityDeadline() public view {
        D memory d = _good();
        d.exclusivityDeadline = uint32(NOW + 3);
        require(!_eval(d), "exclusivity deadline must fail");
    }

    // ── Must-fail: amounts ────────────────────────────────────────────────────

    function test_RejectsOverCap() public view {
        D memory d = _good();
        d.inputAmount = MAX_IN + 1;
        d.outputAmount = MAX_IN + 1;
        require(!_eval(d), "over-cap input must fail");
    }

    function test_RejectsZeroInput() public view {
        D memory d = _good();
        d.inputAmount = 0;
        d.outputAmount = 0;
        require(!_eval(d), "zero input must fail");
    }

    function test_RejectsOutputBelowFloor() public view {
        D memory d = _good();
        d.outputAmount = permission.minOutputFor(d.inputAmount) - 1;
        require(!_eval(d), "output one unit below the fee floor must fail");
    }

    function test_RejectsZeroOutput() public view {
        D memory d = _good();
        d.outputAmount = 0;
        require(!_eval(d), "zero output must fail");
    }

    // ── Must-fail: time bounds ────────────────────────────────────────────────

    function test_RejectsStaleQuote() public view {
        D memory d = _good();
        d.quoteTimestamp = uint32(NOW - MAX_QUOTE_AGE - 1);
        require(!_eval(d), "stale quote must fail");
    }

    function test_RejectsFutureQuote() public view {
        D memory d = _good();
        d.quoteTimestamp = uint32(NOW + 61);
        require(!_eval(d), "future quote must fail");
    }

    function test_RejectsPastFillDeadline() public view {
        D memory d = _good();
        d.fillDeadline = uint32(NOW);
        require(!_eval(d), "fill deadline in the past must fail");
    }

    function test_RejectsFillDeadlineTooFar() public view {
        D memory d = _good();
        d.fillDeadline = uint32(NOW + MAX_FILL + 1);
        require(!_eval(d), "fill deadline beyond max must fail");
    }

    // ── Must-fail: message and shape ──────────────────────────────────────────

    function test_RejectsNonEmptyMessage() public view {
        D memory d = _good();
        d.message = hex"deadbeef";
        require(!_eval(d), "non-empty message must fail");
    }

    function test_RejectsMalformedCalldata() public view {
        bytes memory data = hex"7b939232"; // selector only
        require(!permission.evaluate(data, _ctx(SPOKE_POOL, DEPOSIT_V3, 0)), "truncated calldata must fail");
    }
}
