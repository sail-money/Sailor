// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "../../.sail/contracts/interfaces/IPermission.sol";
import {CloneInitializable} from "../../.sail/contracts/templates/base/CloneInitializable.sol";

/// @title  LifiBoundedApprovePermissionCloneable
/// @notice EIP-1167 clone-template approval permission with PER-TOKEN caps. The
///         logic contract is deployed once and registered in the SDK's
///         standaloneTemplates; each account clones it via
///         PermissionFactory.deployAndAttach and configures via initialize().
///
///         The manager may ONLY approve the LiFi Diamond, and only on tokens that
///         have a configured cap, up to that token's cap. Passes through any
///         non-approve call (conjunctive model).
///
///         Caps are PER TOKEN (not one global cap) because token value and decimals
///         differ — e.g. 1 DAI = 1e18 base units vs 1 USDC = 1e6. A single cap can't
///         bound both sensibly.
contract LifiBoundedApprovePermissionCloneable is IPermission, CloneInitializable {
    bytes4 private constant APPROVE = 0x095ea7b3;
    address public constant LIFI_DIAMOND = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;

    // Per-token approve cap, in the token's base units. 0 = token not allowed.
    // A mapping occupies its own slot pointer and does not pack with the
    // CloneInitializable `_initialized` bool at slot 0.
    mapping(address token => uint256 cap) public maxApprovePerToken;
    address public permissionSigner;

    error NotPermissionSigner();
    error ZeroAddress();
    error LengthMismatch();

    modifier onlyPermissionSigner() {
        if (msg.sender != permissionSigner) revert NotPermissionSigner();
        _;
    }

    /// @dev Lock the logic contract; only clones (fresh storage) can be initialized.
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time per-clone configuration.
    /// @param tokens            Tokens the manager may approve to the LiFi Diamond.
    /// @param caps              Per-token cap (token base units); index-aligned with `tokens`.
    /// @param _permissionSigner Owner wallet; sole authority for post-init updates.
    function initialize(
        address[] memory tokens,
        uint256[] memory caps,
        address _permissionSigner
    ) external initializer {
        if (_permissionSigner == address(0)) revert ZeroAddress();
        if (tokens.length != caps.length) revert LengthMismatch();
        permissionSigner = _permissionSigner;
        for (uint256 i; i < tokens.length; i++) {
            maxApprovePerToken[tokens[i]] = caps[i];
        }
    }

    /// @notice Set (cap > 0) or clear (cap == 0) a token's per-tx approve cap.
    function setTokenCap(address token, uint256 cap) external onlyPermissionSigner {
        maxApprovePerToken[token] = cap;
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        // Pass through calls outside this permission's domain (conjunctive model).
        if (ctx.selector != APPROVE) return true;
        if (ctx.target == address(0)) return false; // token is ctx.target
        if (txData.length < 68) return false;

        (address spender, uint256 amount) = abi.decode(txData[4:], (address, uint256));
        if (spender != LIFI_DIAMOND) return false;

        uint256 cap = maxApprovePerToken[ctx.target];
        if (cap == 0) return false; // token not allowed
        if (amount > cap) return false; // over the per-token cap
        return true;
    }

    function discriminator() external pure returns (bytes32) {
        return keccak256("LifiBoundedApprovePermissionCloneable.v1");
    }
}
