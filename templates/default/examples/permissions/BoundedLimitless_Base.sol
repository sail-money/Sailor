// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : Limitless Exchange
// Version  : Polymarket-fork prediction market — OFF-CHAIN CLOB on Base
// Chain    : Base mainnet
//
// ⚠ READ FIRST — you CANNOT bound the bet itself on-chain.
//   Limitless is a Polymarket fork. Orders are EIP-712 structs signed OFF-CHAIN
//   and POSTed to the Limitless API; the on-chain CTF Exchange only settles
//   orders the API has already matched. There is no on-chain `buy(...)` call for
//   a permission to gate — the kernel never sees the bet. A permission that
//   pretends to bound bet placement bounds nothing.
//
//   Worse, the SMA cannot even be the bettor. The Limitless API validates every
//   order by ECDSA-recovering the signature and requiring
//   `maker == signer == profile.account` — unconditionally, ignoring
//   `signatureType` (so EIP-1271 / Gnosis-Safe signing never applies off-chain).
//   A smart contract cannot produce an ECDSA signature, and `addOperator` is
//   admin-only. Therefore the maker MUST be an EOA.
//
// THE WORKING MODEL — SMA as treasury, manager (agent EOA) as trader:
//   • SMA holds the bulk USDC. This permission bounds ONLY the treasury → trader
//     funding flow (a capped transfer to the manager + approvals to the venue).
//   • The manager wallet is the on-chain maker: it holds a small USDC float,
//     signs CLOB orders off-chain, holds the ConditionalTokens positions, and
//     redeems winnings. The bet sizing/selection is off-chain agent logic.
//   • Risk surface = the float on the manager, not the SMA balance.
//
// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ blocked):
//   USDC.transfer(address to, uint256 amount)   selector 0xa9059cbb
//     • target must be USDC
//     • to must be the MANAGER wallet (treasury can only fund the trader)
//     • amount ≤ MAX_TRANSFER (per-dispatch float cap)
//   USDC.approve(address spender, uint256 amount) selector 0x095ea7b3
//     • target must be USDC
//     • spender must be an ALLOWED_SPENDER (CTF Exchange / NegRisk Exchange / Adapter)
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — the kernel cannot see these):
//   • Bet placement, market/outcome selection, price, stake sizing (off-chain CLOB)
//   • Redeeming winnings (a manager-EOA tx; the manager, not the SMA, holds the tokens)
//   • Timing / frequency
//
// VERIFY BEFORE USE:
//   • MANAGER is your agent wallet (the only address the treasury may fund).
//   • USDC is native Base USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).
//   • ALLOWED_SPENDERS are the live Limitless CTF Exchange, NegRisk Exchange, and
//     NegRisk Adapter addresses on Base (confirm on Basescan).
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedLimitless_Base is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedLimitless_Base");

    bytes4 private constant SEL_TRANSFER = bytes4(keccak256("transfer(address,uint256)")); // 0xa9059cbb
    bytes4 private constant SEL_APPROVE  = bytes4(keccak256("approve(address,uint256)"));   // 0x095ea7b3

    address public immutable USDC;
    address public immutable MANAGER;
    uint256 public immutable MAX_TRANSFER;
    mapping(address => bool) public isAllowedSpender;

    /// @param usdc            USDC token address on Base (the only target this permission bounds)
    /// @param manager         The agent EOA — the only address the treasury may fund
    /// @param maxTransfer     Per-dispatch cap on the treasury → manager transfer (base units)
    /// @param allowedSpenders Venue addresses USDC may be approved to (CTF Exchange / NegRisk / Adapter)
    constructor(
        address usdc,
        address manager,
        uint256 maxTransfer,
        address[] memory allowedSpenders
    ) {
        USDC         = usdc;
        MANAGER      = manager;
        MAX_TRANSFER = maxTransfer;
        for (uint256 i = 0; i < allowedSpenders.length; i++) {
            isAllowedSpender[allowedSpenders[i]] = true;
        }
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        // Only USDC is in scope, and no native value may ride along.
        if (ctx.target != USDC) return false;
        if (ctx.value != 0)     return false;
        if (txData.length < 4 + 2 * 32) return false;

        if (ctx.selector == SEL_TRANSFER) {
            (address to, uint256 amount) = abi.decode(txData[4:], (address, uint256));
            if (to != MANAGER)        return false; // treasury funds the trader only
            if (amount > MAX_TRANSFER) return false; // bounded float, not the whole SMA
            return true;
        }

        if (ctx.selector == SEL_APPROVE) {
            (address spender, ) = abi.decode(txData[4:], (address, uint256));
            return isAllowedSpender[spender]; // approve only the venue contracts
        }

        return false;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
