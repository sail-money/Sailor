// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : Limitless
// Version  : CTF-based prediction market (on-chain settlement on Base)
//            NOT Polymarket (Polymarket's CLOB matches orders off-chain on Polygon —
//            a permission cannot bound the orders your agent signs off-chain.
//            Limitless settles bets on-chain on Base, so the kernel sees every action.)
// Chain    : Base mainnet
//
// ⚠ WARNING — ABI UNVERIFIED ⚠
//   The Limitless exchange contract address and bet-placement function signature
//   below are based on published CTF exchange patterns and public documentation.
//   They have NOT been independently verified against the deployed contracts.
//   YOU MUST verify these before deploying with real funds:
//     1. Find the Limitless exchange contract address on Basescan.
//     2. Read its verified ABI and confirm the buy/place function signature.
//     3. Recompute the selector and update SEL_BUY.
//     4. Confirm the parameter layout matches BetParams below.
//   Deploying this contract with an unverified ABI may silently PASS or FAIL
//   all dispatches depending on whether the selector matches.
//
// ENFORCED ON-CHAIN (assuming verified ABI — see warning above):
//   buy(bytes32 conditionId, uint256 amount, uint256 outcomeIndex)
//   • target must be LIMITLESS_EXCHANGE
//   • conditionId must be in ALLOWED_CONDITIONS
//   • amount ≤ MAX_STAKE
//   • outcomeIndex must be in ALLOWED_OUTCOMES
//
// NOT ENFORCED:
//   • Market price / odds (on-chain prediction market prices fluctuate)
//   • Timing / frequency of bets
//
// VERIFY BEFORE USE:
//   • Confirm Limitless exchange address on Base (Basescan).
//   • Confirm buy function signature and compute selector:
//     keccak256("buy(bytes32,uint256,uint256)")[0:4] == 0x??? — verify on-chain.
//   • Confirm conditionId encoding matches the deployed market IDs.
//   • Update this contract if the ABI or parameter order differs.
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedBet_Limitless_Base is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedBet_Limitless_Base");

    /// @dev ⚠ UNVERIFIED — replace with verified Limitless exchange address on Base.
    address public immutable LIMITLESS_EXCHANGE;
    mapping(bytes32 => bool) public isAllowedCondition;
    uint256 public immutable MAX_STAKE;
    mapping(uint256 => bool) public isAllowedOutcome;

    /// @dev ⚠ UNVERIFIED selector. Compute keccak256("buy(bytes32,uint256,uint256)")[0:4]
    ///      and confirm it matches the deployed Limitless exchange contract before use.
    bytes4 private constant SEL_BUY = bytes4(keccak256("buy(bytes32,uint256,uint256)"));

    /// @param limitlessExchange  ⚠ VERIFY — Limitless CTF exchange address on Base
    /// @param allowedConditions  conditionIds (bytes32) of markets the agent may bet on
    /// @param maxStake           Per-bet stake cap in collateral base units
    /// @param allowedOutcomes    Outcome indices the agent may select (e.g. [0] for YES only)
    constructor(
        address limitlessExchange,
        bytes32[] memory allowedConditions,
        uint256 maxStake,
        uint256[] memory allowedOutcomes
    ) {
        LIMITLESS_EXCHANGE = limitlessExchange;
        MAX_STAKE          = maxStake;
        for (uint256 i = 0; i < allowedConditions.length; i++) {
            isAllowedCondition[allowedConditions[i]] = true;
        }
        for (uint256 i = 0; i < allowedOutcomes.length; i++) {
            isAllowedOutcome[allowedOutcomes[i]] = true;
        }
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (ctx.target != LIMITLESS_EXCHANGE) return false;
        if (ctx.selector != SEL_BUY)          return false;
        if (txData.length < 4 + 3 * 32)       return false;

        // ⚠ Assumes: buy(bytes32 conditionId, uint256 amount, uint256 outcomeIndex)
        // Verify parameter order against deployed contract ABI before use.
        (bytes32 conditionId, uint256 amount, uint256 outcomeIndex) =
            abi.decode(txData[4:], (bytes32, uint256, uint256));

        if (!isAllowedCondition[conditionId])  return false;
        if (amount > MAX_STAKE)                return false;
        if (!isAllowedOutcome[outcomeIndex])   return false;

        return true;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
