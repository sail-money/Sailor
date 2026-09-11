// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";
import {SailCalldata} from "./SailCalldata.sol";

/// @title AcrossBridgePermission
/// @notice Bounds one Across V3 route — `depositV3` on the source chain's SpokePool — so the agent
///         can move the settlement currency to a chain CCTP does not reach (Robinhood Chain, whose
///         dollar is USDG) and back. One instance per (source → destination, inputToken → outputToken).
///
/// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
///   depositV3(address depositor, address recipient, address inputToken, address outputToken,
///             uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId,
///             address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline,
///             uint32 exclusivityDeadline, bytes message)   selector 0x7b939232
///     • ctx.target == SPOKE_POOL             (the source chain's Across SpokePool, nothing else)
///     • ctx.value == 0                        (the function is payable for native deposits; never here)
///     • depositor == ctx.account              (an unfilled deposit is refunded to the depositor: the SMA)
///     • recipient == ctx.account              (the output lands at the SMA's own address on the destination)
///     • inputToken == INPUT_TOKEN, outputToken == OUTPUT_TOKEN
///     • 0 < inputAmount ≤ MAX_INPUT_AMOUNT   (per-tx exposure cap, in inputToken base units)
///     • outputAmount ≥ inputAmount scaled to output decimals × (10000 − MAX_FEE_BPS) / 10000
///                                             (a hard floor: no relayer can fill below it, so the
///                                              relayer fee + any embedded conversion is capped)
///     • destinationChainId == DESTINATION_CHAIN_ID
///     • exclusiveRelayer == address(0) and exclusivityDeadline == 0   (open to every relayer)
///     • blockTimestamp − MAX_QUOTE_AGE ≤ quoteTimestamp ≤ blockTimestamp + 60   (no stale quotes)
///     • blockTimestamp < fillDeadline ≤ blockTimestamp + MAX_FILL_DEADLINE    (bounded refund wait)
///     • message.length == 0                   (no cross-chain calldata; the "embedded actions"
///                                              surface is closed entirely)
///
/// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
///   • which quote the agent takes (it asks Across for the fee and refuses quotes above its own
///     ceiling before the on-chain floor is even reached)
///   • when it bridges, how it pools shortfalls, and the cumulative volume over time
///   • the ERC-20 approve() that precedes the deposit — covered by the bounded approve permission
///
/// WHAT THIS CANNOT ENFORCE: that a relayer fills (Across refunds the depositor after the fill
/// deadline if none does), and what Across governance does with the SpokePool's upgrade keys.
/// The per-tx cap is what keeps that residual small.
contract AcrossBridgePermission is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("AcrossBridgePermission");
    bytes4 private constant DEPOSIT_V3 = 0x7b939232;
    uint256 private constant MESSAGE_OFFSET = 12 * 32; // `message` is the 12th param: its head slot holds this offset
    uint256 private constant QUOTE_FUTURE_TOLERANCE = 60; // seconds a quote may sit "in the future" (clock skew)

    address public immutable SPOKE_POOL;
    address public immutable INPUT_TOKEN;
    address public immutable OUTPUT_TOKEN;
    uint256 public immutable DESTINATION_CHAIN_ID;
    uint256 public immutable MAX_INPUT_AMOUNT; // 0 == uncapped
    uint256 public immutable MAX_FEE_BPS; // ceiling on (input − output) as a share of input
    uint256 public immutable MAX_QUOTE_AGE; // seconds
    uint256 public immutable MAX_FILL_DEADLINE; // seconds
    uint8 public immutable INPUT_DECIMALS;
    uint8 public immutable OUTPUT_DECIMALS;

    constructor(
        address spokePool,
        address inputToken,
        address outputToken,
        uint256 destinationChainId,
        uint256 maxInputAmount,
        uint256 maxFeeBps,
        uint256 maxQuoteAge,
        uint256 maxFillDeadline,
        uint8 inputDecimals,
        uint8 outputDecimals
    ) {
        require(maxFeeBps < 10_000, "AcrossBridgePermission: fee bps");
        SPOKE_POOL = spokePool;
        INPUT_TOKEN = inputToken;
        OUTPUT_TOKEN = outputToken;
        DESTINATION_CHAIN_ID = destinationChainId;
        MAX_INPUT_AMOUNT = maxInputAmount;
        MAX_FEE_BPS = maxFeeBps;
        MAX_QUOTE_AGE = maxQuoteAge;
        MAX_FILL_DEADLINE = maxFillDeadline;
        INPUT_DECIMALS = inputDecimals;
        OUTPUT_DECIMALS = outputDecimals;
    }

    /// @notice The smallest acceptable output for `inputAmount`, in output-token base units.
    function minOutputFor(uint256 inputAmount) public view returns (uint256) {
        uint256 scaled = inputAmount;
        if (OUTPUT_DECIMALS > INPUT_DECIMALS) scaled = inputAmount * (10 ** (OUTPUT_DECIMALS - INPUT_DECIMALS));
        else if (INPUT_DECIMALS > OUTPUT_DECIMALS) scaled = inputAmount / (10 ** (INPUT_DECIMALS - OUTPUT_DECIMALS));
        return (scaled * (10_000 - MAX_FEE_BPS)) / 10_000;
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (ctx.value != 0) return false;
        if (ctx.target != SPOKE_POOL) return false;
        if (ctx.selector != DEPOSIT_V3) return false;
        // 11 static params + the offset word of `message` + its length word.
        if (!SailCalldata.hasParams(txData, 13)) return false;
        if (!_partiesOk(txData, ctx.account)) return false;
        if (!_amountsOk(txData)) return false;
        if (!_timingOk(txData, ctx.blockTimestamp)) return false;
        return _messageEmpty(txData);
    }

    /// depositor and recipient must both be the SMA; tokens and destination must match the route.
    function _partiesOk(bytes calldata txData, address account) private view returns (bool) {
        if (SailCalldata.asAddress(txData, 0) != account) return false; // depositor (refund target)
        if (SailCalldata.asAddress(txData, 1) != account) return false; // recipient
        if (SailCalldata.asAddress(txData, 2) != INPUT_TOKEN) return false;
        if (SailCalldata.asAddress(txData, 3) != OUTPUT_TOKEN) return false;
        if (SailCalldata.asUint256(txData, 6) != DESTINATION_CHAIN_ID) return false;
        if (SailCalldata.asAddress(txData, 7) != address(0)) return false; // exclusiveRelayer
        if (SailCalldata.asUint256(txData, 10) != 0) return false; // exclusivityDeadline
        return true;
    }

    /// inputAmount inside the cap; outputAmount at or above the fee floor.
    function _amountsOk(bytes calldata txData) private view returns (bool) {
        uint256 inputAmount = SailCalldata.asUint256(txData, 4);
        if (inputAmount == 0) return false;
        if (MAX_INPUT_AMOUNT != 0 && inputAmount > MAX_INPUT_AMOUNT) return false;
        return SailCalldata.asUint256(txData, 5) >= minOutputFor(inputAmount);
    }

    /// A fresh quote and a bounded fill deadline.
    function _timingOk(bytes calldata txData, uint256 nowTs) private view returns (bool) {
        uint256 quoteTimestamp = SailCalldata.asUint256(txData, 8);
        if (quoteTimestamp + MAX_QUOTE_AGE < nowTs) return false;
        if (quoteTimestamp > nowTs + QUOTE_FUTURE_TOLERANCE) return false;
        uint256 fillDeadline = SailCalldata.asUint256(txData, 9);
        if (fillDeadline <= nowTs) return false;
        if (fillDeadline > nowTs + MAX_FILL_DEADLINE) return false;
        return true;
    }

    /// `message` must be the empty bytes: head offset at the canonical slot and a zero length.
    function _messageEmpty(bytes calldata txData) private pure returns (bool) {
        if (SailCalldata.asUint256(txData, 11) != MESSAGE_OFFSET) return false;
        return SailCalldata.asUint256(txData, 12) == 0;
    }

    function discriminator() external pure returns (bytes32) {
        return DISCRIMINATOR;
    }
}
