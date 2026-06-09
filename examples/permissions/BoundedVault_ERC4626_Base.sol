// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// Protocol : ERC-4626 (tokenized vault standard)
// Version  : Standard EIP-4626 interface (version-agnostic)
// Chain    : Base mainnet (8453) — reference vault below; works on any EVM
// Target   : Reference vault — Moonwell Flagship USDC (MetaMorpho, ERC-4626)
//            0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca  (verified ERC-4626 on Base: asset()=USDC)
//            Written against the STANDARD interface, so it generalizes to any 4626 vault.
//
// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false ⇒ dispatch blocked):
//   deposit(uint256 assets,address receiver)                  selector 0x6e553f65
//     • target (the vault) must be in ALLOWED_VAULTS
//     • assets ≤ MAX_DEPOSIT_ASSETS
//     • receiver must equal ctx.account (the SMA — shares cannot be minted to another address)
//   withdraw(uint256 assets,address receiver,address owner)   selector 0xb460af94
//   redeem(uint256 shares,address receiver,address owner)     selector 0xba087652
//     • target (the vault) must be in ALLOWED_VAULTS
//     • receiver must equal ctx.account (assets cannot be sent elsewhere)
//     • owner    must equal ctx.account (cannot burn shares the SMA merely has allowance over)
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain — can change without redeploying this contract):
//   • Which vault within ALLOWED_VAULTS to use, and deposit/withdraw timing/cadence
//   • Withdraw/redeem amount (only the receiver/owner are bound, not the size — the SMA can
//     always withdraw its own position in full; add a cap here if your strategy needs one)
//   • Underlying ASSET: enforced TRANSITIVELY via ALLOWED_VAULTS, not from calldata. A 4626
//     vault's asset() is fixed at deploy; the deposit/withdraw calldata carries NO asset field,
//     so the asset cannot be read from it. Allowlist only vaults whose asset() you have verified.
//
// VERIFY BEFORE USE:
//   • Selectors are the EIP-4626 standard (verified via `cast sig`): deposit 0x6e553f65,
//     withdraw 0xb460af94, redeem 0xba087652. (mint(uint256,address)=0x94bf804d is NOT gated
//     here — add it if your agent mints shares by exact share count.)
//   • Confirm each allowlisted vault actually implements ERC-4626 and its asset() is what you
//     expect (e.g. on the reference vault, asset() == USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).
//   • A deposit also needs a prior ERC-20 approve of the vault — gate that with a separate
//     approve permission (see BoundedApproveAndCallBatch.sol for the atomic approve→call→reset pattern).
//   • MAX_DEPOSIT_ASSETS is in the asset's base units (USDC = 6 decimals).
// ─────────────────────────────────────────────────────────────────────────────

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

contract BoundedVault_ERC4626_Base is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedVault_ERC4626_Base");

    mapping(address => bool) public isAllowedVault;
    uint256 public immutable MAX_DEPOSIT_ASSETS;

    // EIP-4626 standard selectors
    bytes4 private constant SEL_DEPOSIT  = 0x6e553f65; // deposit(uint256,address)
    bytes4 private constant SEL_WITHDRAW = 0xb460af94; // withdraw(uint256,address,address)
    bytes4 private constant SEL_REDEEM   = 0xba087652; // redeem(uint256,address,address)

    /// @param allowedVaults     ERC-4626 vaults the agent may deposit into / withdraw from
    /// @param maxDepositAssets  Per-deposit cap in the asset's base units (must be > 0)
    constructor(address[] memory allowedVaults, uint256 maxDepositAssets) {
        require(allowedVaults.length > 0, "empty vault allowlist");
        require(maxDepositAssets > 0,     "zero deposit cap");
        MAX_DEPOSIT_ASSETS = maxDepositAssets;
        for (uint256 i = 0; i < allowedVaults.length; i++) {
            require(allowedVaults[i] != address(0), "zero vault address");
            isAllowedVault[allowedVaults[i]] = true;
        }
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (!isAllowedVault[ctx.target]) return false;
        if (txData.length < 4)           return false;

        // deposit(uint256 assets, address receiver)
        if (ctx.selector == SEL_DEPOSIT) {
            if (txData.length < 4 + 2 * 32) return false;
            (uint256 assets, address receiver) = abi.decode(txData[4:], (uint256, address));
            if (assets > MAX_DEPOSIT_ASSETS) return false;
            if (receiver != ctx.account)     return false; // shares must accrue to the SMA
            return true;
        }

        // withdraw(uint256 assets, address receiver, address owner)
        // redeem(uint256 shares,  address receiver, address owner)
        // Identical parameter layout: (uint256, address, address).
        // Amount (assets/shares) is NOT bounded — the SMA can always exit its full position.
        // Add a maxWithdrawAssets constructor param and check here if your strategy needs a cap.
        if (ctx.selector == SEL_WITHDRAW || ctx.selector == SEL_REDEEM) {
            if (txData.length < 4 + 3 * 32) return false;
            (, address receiver, address owner) = abi.decode(txData[4:], (uint256, address, address));
            if (receiver != ctx.account) return false; // assets must return to the SMA
            if (owner    != ctx.account) return false; // only the SMA's own shares may be burned
            return true;
        }

        return false;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
