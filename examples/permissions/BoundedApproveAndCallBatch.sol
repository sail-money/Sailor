// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : Sail batch dispatch (IBatchPermission) — protocol-agnostic
// Version  : Single-tenant, constructor-configured (mirrors the multi-tenant
//            SharedApproveAndCallBatchPermission shape from SailProtocol)
// Chain    : Any EVM with a SELECTIVE kernel (Base, Arbitrum, Unichain, Base Sepolia)
//
// WHAT THIS TEACHES — the atomic approve → call → reset pattern.
//   A bare ERC-20 approve is dangerous: it leaves a standing allowance an attacker can drain.
//   The safe shape is to approve, consume the allowance in the SAME transaction, then reset it
//   to zero — all-or-nothing. No single-call IPermission can enforce "the reset must be the
//   final call", because per-call evaluation never sees the other calls. A batch permission
//   sees the WHOLE sequence at once, so it can.
//
//   Gated via the kernel's dispatchBatch (NOT dispatch). This contract's single-call evaluate()
//   deliberately returns false — it is batch-only. The manager names this permission in the
//   batch signature; only it is consulted (selective model).
//
// ENFORCES ON-CHAIN (kernel calls evaluateBatch() via staticcall; false/revert ⇒ batch blocked):
//   The batch MUST be exactly these 3 calls, in this order, each with value == 0:
//     calls[0] = approve(spender,amount)  selector 0x095ea7b3  on an allowlisted token
//                • token (calls[0].target) must be in ALLOWED_TOKENS (cap > 0)
//                • spender must be in ALLOWED_SPENDERS
//                • 0 < amount ≤ maxApprovalAmount[token]
//     calls[1] = <consuming call>         on an allowlisted (target, selector)
//                • target must be in ALLOWED_CONSUMING_TARGETS
//                • selector must be in ALLOWED_CONSUMING_SELECTORS
//                • if REQUIRE_AMOUNT_MATCH: the call's leading uint256 arg must equal calls[0].amount
//     calls[2] = approve(spender,0)       selector 0x095ea7b3  — mandatory reset
//                • same token and same spender as calls[0]
//                • amount must be exactly 0
//   Any deviation (wrong length, wrong token/spender/target/selector, over-cap, non-zero reset,
//   reordering, non-zero value, malformed calldata) ⇒ false or revert.
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
//   • The full calldata of the consuming call beyond its leading uint256 (recipients, paths, etc.)
//     — bound those with a protocol-specific permission if the consuming call needs tighter limits.
//
// VERIFY BEFORE USE:
//   • approve selector 0x095ea7b3 is the ERC-20 standard. ALLOWED_CONSUMING_SELECTORS must match
//     the real selector(s) of the protocol call you intend to bracket.
//   • Per-token caps are in each token's base units (decimals differ — USDC 6, WETH 18).
//   • Requires a SELECTIVE kernel (dispatchBatch exists). Conjunctive kernels have no batch path.
//   • `sailor mandate simulate` probes single evaluate() only; it cannot probe evaluateBatch().
//     Verify this contract by calling evaluateBatch(calls, ctx) directly (eth_call) with PASS/FAIL
//     batches before authorizing on-chain.
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context}                 from "@sail/interfaces/IPermission.sol";
import {IBatchPermission, Call, BatchContext} from "@sail/interfaces/IBatchPermission.sol";

contract BoundedApproveAndCallBatch is IPermission, IBatchPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedApproveAndCallBatch");

    bytes4  private constant SEL_APPROVE       = 0x095ea7b3; // approve(address,uint256)
    uint256 private constant APPROVE_CALLDATA_LEN = 68;       // 4 + 32 (spender) + 32 (amount)
    uint256 private constant CONSUMING_MIN_LEN    = 36;       // 4 + 32 (leading uint256 arg)

    mapping(address => uint256) public maxApprovalAmount;   // token  => cap (0 = not allowed)
    mapping(address => bool)    public isSpender;           // spender allowlist
    mapping(address => bool)    public isConsumingTarget;   // consuming-call target allowlist
    mapping(bytes4  => bool)    public isConsumingSelector; // consuming-call selector allowlist
    bool public immutable REQUIRE_AMOUNT_MATCH;

    /// @param tokens              Allowlisted ERC-20 tokens that may be approved
    /// @param maxApprovalAmounts  Per-token approve cap, index-parallel with `tokens` (each > 0)
    /// @param spenders            Allowlisted spenders that may receive the allowance
    /// @param consumingTargets    Allowlisted targets for the middle (consuming) call
    /// @param consumingSelectors  Allowlisted selectors for the middle (consuming) call
    /// @param requireAmountMatch  If true, the consuming call's leading uint256 must equal the approve amount
    constructor(
        address[] memory tokens,
        uint256[] memory maxApprovalAmounts,
        address[] memory spenders,
        address[] memory consumingTargets,
        bytes4[]  memory consumingSelectors,
        bool requireAmountMatch
    ) {
        require(tokens.length == maxApprovalAmounts.length, "tokens/amounts length mismatch");
        require(tokens.length > 0 && spenders.length > 0, "empty token/spender allowlist");
        require(consumingTargets.length > 0 && consumingSelectors.length > 0, "empty consuming allowlist");

        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0) && maxApprovalAmounts[i] > 0, "bad token/cap");
            maxApprovalAmount[tokens[i]] = maxApprovalAmounts[i];
        }
        for (uint256 i = 0; i < spenders.length; i++) {
            require(spenders[i] != address(0), "zero spender");
            isSpender[spenders[i]] = true;
        }
        for (uint256 i = 0; i < consumingTargets.length; i++) {
            require(consumingTargets[i] != address(0), "zero target");
            isConsumingTarget[consumingTargets[i]] = true;
        }
        for (uint256 i = 0; i < consumingSelectors.length; i++) {
            isConsumingSelector[consumingSelectors[i]] = true;
        }
        REQUIRE_AMOUNT_MATCH = requireAmountMatch;
    }

    // ── IBatchPermission ─────────────────────────────────────────────────────

    /// @inheritdoc IBatchPermission
    function isBatchPermission() external pure returns (bool) { return true; }

    /// @inheritdoc IBatchPermission
    function evaluateBatch(Call[] calldata calls, BatchContext calldata ctx) external view returns (bool) {
        ctx; // batch context unused — bounds depend only on the call sequence, not the SMA
        if (calls.length != 3) return false;

        // ── calls[0]: approve(spender, amount) on an allowlisted token ───────
        Call calldata c0 = calls[0];
        if (c0.value != 0)                            return false;
        if (c0.data.length != APPROVE_CALLDATA_LEN)   return false;
        if (bytes4(c0.data[0:4]) != SEL_APPROVE)      return false;

        address token = c0.target;
        uint256 cap   = maxApprovalAmount[token];
        if (cap == 0) return false; // token not allowlisted

        (address spender, uint256 approveAmount) = _decodeApprove(c0.data);
        if (!isSpender[spender])      return false;
        if (approveAmount == 0)       return false;
        if (approveAmount > cap)      return false;

        // ── calls[1]: consuming call on an allowlisted (target, selector) ────
        Call calldata c1 = calls[1];
        if (c1.value != 0)                          return false;
        if (!isConsumingTarget[c1.target])          return false;
        if (c1.data.length < CONSUMING_MIN_LEN)     return false;
        if (!isConsumingSelector[bytes4(c1.data[0:4])]) return false;
        if (REQUIRE_AMOUNT_MATCH) {
            if (uint256(bytes32(c1.data[4:36])) != approveAmount) return false;
        }

        // ── calls[2]: approve(spender, 0) — mandatory reset of same token+spender ─
        Call calldata c2 = calls[2];
        if (c2.value != 0)                            return false;
        if (c2.target != token)                       return false;
        if (c2.data.length != APPROVE_CALLDATA_LEN)   return false;
        if (bytes4(c2.data[0:4]) != SEL_APPROVE)      return false;

        (address resetSpender, uint256 resetAmount) = _decodeApprove(c2.data);
        if (resetSpender != spender) return false;
        if (resetAmount != 0)        return false;

        return true;
    }

    // ── IPermission (batch-only: single dispatch is never authorised) ────────

    /// @inheritdoc IPermission
    function evaluate(bytes calldata, Context calldata) external pure returns (bool) {
        return false;
    }

    /// @inheritdoc IPermission
    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }

    // ── internal calldata decoding (bounds-checked by callers above) ─────────

    function _decodeApprove(bytes calldata data) internal pure returns (address spender, uint256 amount) {
        spender = address(uint160(uint256(bytes32(data[4:36]))));
        amount  = uint256(bytes32(data[36:68]));
    }
}
