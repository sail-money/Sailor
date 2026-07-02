// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : ERC-20
// Version  : Standard ERC-20 (version-agnostic)
// Chain    : Ethereum mainnet (works on any EVM — the most general example)
//
// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
//   transfer(address to,uint256 amount)  selector 0xa9059cbb
//     • target must be in ALLOWED_TOKENS
//     • recipient (to) must be in ALLOWED_RECIPIENTS
//     • amount ≤ MAX_AMOUNT_PER_TRANSFER
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
//   • transfer frequency / timing
//   • choice of token within ALLOWED_TOKENS
//   • choice of recipient within ALLOWED_RECIPIENTS
//
// VERIFY BEFORE USE:
//   • Selector 0xa9059cbb = transfer(address,uint256) — universally standard.
//   • ALLOWED_TOKENS prevents the agent from transferring tokens not in the set.
//     If a protocol uses non-standard transfer methods (e.g. transferFrom or
//     proprietary hooks), add separate selector entries.
//   • MAX_AMOUNT_PER_TRANSFER is denominated in the token's base units.
//     Different tokens have different decimals (USDC = 6, WETH = 18).
//     Set one permission per token if amounts differ across tokens.
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedTransfer_ERC20_Ethereum is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedTransfer_ERC20_Ethereum");

    mapping(address => bool) public isAllowedToken;
    mapping(address => bool) public isAllowedRecipient;
    uint256 public immutable MAX_AMOUNT_PER_TRANSFER;

    // transfer(address,uint256)
    bytes4 private constant SEL_TRANSFER = 0xa9059cbb;

    /// @param allowedTokens        ERC-20 contracts the agent may transfer from
    /// @param allowedRecipients    Addresses the agent may send to
    /// @param maxAmountPerTransfer Per-call amount cap (in token base units)
    constructor(
        address[] memory allowedTokens,
        address[] memory allowedRecipients,
        uint256 maxAmountPerTransfer
    ) {
        MAX_AMOUNT_PER_TRANSFER = maxAmountPerTransfer;
        for (uint256 i = 0; i < allowedTokens.length; i++) {
            isAllowedToken[allowedTokens[i]] = true;
        }
        for (uint256 i = 0; i < allowedRecipients.length; i++) {
            isAllowedRecipient[allowedRecipients[i]] = true;
        }
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (!isAllowedToken[ctx.target])      return false;
        if (ctx.selector != SEL_TRANSFER)     return false;
        if (txData.length < 4 + 2 * 32)      return false;

        (address to, uint256 amount) = abi.decode(txData[4:], (address, uint256));

        if (!isAllowedRecipient[to])                return false;
        if (amount > MAX_AMOUNT_PER_TRANSFER)       return false;

        return true;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
