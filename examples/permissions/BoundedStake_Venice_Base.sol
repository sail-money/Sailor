// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : Venice (VVV) staking
// Version  : sVVV staking contract (proxy) — fully on-chain
// Chain    : Base mainnet (8453)
// Target   : Staking proxy  0x321b7ff75154472B18EDb199033fF4D116F340Ff  ("Staked Venice Token")
//            (impl 0xe37a7920dbc11253ac6d031c29f592f71b348dca — proxy is the stable target)
//            Staked asset: VVV  0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf
//
// ⚠ SELECTOR NOTE — the function is stake(address,uint256), NOT stake(uint256).
//   Verified against the live contract (bytecode + 4byte registry): the staking entrypoint is
//   stake(address recipient, uint256 amount) = 0xadc9772e. The single-arg stake(uint256)
//   = 0xa694fc3a is ABSENT. Gating the wrong selector silently rejects every real stake
//   (fail-closed but non-functional). ALWAYS confirm the selector against the contract you target.
//
// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
//   stake(address recipient,uint256 amount)  selector 0xadc9772e
//     • target must be STAKING_CONTRACT
//     • amount ≤ MAX_STAKE_AMOUNT
//     • recipient must equal ctx.account (the SMA — the staked position cannot be assigned
//       to another address; verified empirically: this arg is the position beneficiary)
//   claim()  selector 0x4e71d92d
//     • target must be STAKING_CONTRACT
//     • takes NO recipient argument — rewards always accrue to the caller (the SMA when the
//       kernel dispatches), so "claim-rewards-to-SMA-only" holds structurally
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
//   • Stake timing / cadence and how often rewards are claimed
//   • Unstaking: this permission does NOT allow initiateUnstake(uint256) (0xae5ac921) — add it
//     with its own bounds if the agent should manage exits; left out to keep this single-purpose.
//   • Staked ASSET: enforced TRANSITIVELY via STAKING_CONTRACT (the contract accepts one fixed
//     token, VVV). The stake calldata carries no token field, so the asset is pinned by the target.
//
// VERIFY BEFORE USE:
//   • Confirm STAKING_CONTRACT and that its stake selector is 0xadc9772e on the contract you target.
//   • Confirm the stake address arg is the position recipient (not, e.g., a token address) on your
//     contract — on Venice it is the recipient (verified by staking to a third party on a fork).
//   • MAX_STAKE_AMOUNT is in VVV base units (18 decimals).
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedStake_Venice_Base is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedStake_Venice_Base");

    address public immutable STAKING_CONTRACT;
    uint256 public immutable MAX_STAKE_AMOUNT;

    // Verified against the live Venice staking contract (bytecode + 4byte registry):
    bytes4 private constant SEL_STAKE = 0xadc9772e; // stake(address recipient,uint256 amount)
    bytes4 private constant SEL_CLAIM = 0x4e71d92d; // claim()

    /// @param stakingContract  Venice staking contract (the proxy address)
    /// @param maxStakeAmount   Per-stake cap in VVV base units (18 decimals; must be > 0)
    constructor(address stakingContract, uint256 maxStakeAmount) {
        require(stakingContract != address(0), "zero staking contract");
        require(maxStakeAmount > 0,            "zero stake cap");
        STAKING_CONTRACT = stakingContract;
        MAX_STAKE_AMOUNT = maxStakeAmount;
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (ctx.target != STAKING_CONTRACT) return false;

        // stake(address recipient, uint256 amount)
        if (ctx.selector == SEL_STAKE) {
            if (txData.length < 4 + 2 * 32) return false;
            (address recipient, uint256 amount) = abi.decode(txData[4:], (address, uint256));
            if (amount > MAX_STAKE_AMOUNT) return false;
            if (recipient != ctx.account)  return false; // stake only to the SMA's own position
            return true;
        }

        // claim() — no args; rewards go to the caller (the SMA). No recipient to bound.
        if (ctx.selector == SEL_CLAIM) {
            return true;
        }

        return false;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
