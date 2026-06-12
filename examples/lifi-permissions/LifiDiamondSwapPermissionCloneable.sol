// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "../../.sail/contracts/interfaces/IPermission.sol";
import {CloneInitializable} from "../../.sail/contracts/templates/base/CloneInitializable.sol";

/// @title  LifiDiamondSwapPermissionCloneable
/// @notice EIP-1167 clone-template version of LifiDiamondSwapPermission. The logic
///         contract is deployed once and registered in the SDK's standaloneTemplates;
///         each account gets its own clone via PermissionFactory.deployAndAttach,
///         configured through initialize() (NOT the constructor).
///
///         Restricts manager-initiated swaps to the official LiFi Diamond on Base:
///          - target must be the LiFi Diamond,
///          - selector must be allowlisted,
///          - receiver embedded in the calldata must equal ctx.account (the SMA),
///          - the minAmount field must not exceed the configured cap.
///         Passes through any call whose target is not the diamond (conjunctive model).
///
///         Calldata layout (validated against live Base quotes):
///          selector(4) + word0(32) + word1(32) + word2(32) + receiver(32) + minAmount(32)
///          → receiver at offset 100, minAmount at offset 132.
contract LifiDiamondSwapPermissionCloneable is IPermission, CloneInitializable {
    // Official LiFi Diamond on Base Mainnet.
    address public constant LIFI_DIAMOND = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;

    // Storage starts after CloneInitializable's `_initialized` bool (slot 0). A
    // mapping occupies its own slot pointer and does not pack with the bool.
    mapping(bytes4 selector => bool) public isAllowedSelector;
    uint256 public maxMinAmountPerTx;
    address public permissionSigner;

    error NotPermissionSigner();
    error ZeroAddress();

    modifier onlyPermissionSigner() {
        if (msg.sender != permissionSigner) revert NotPermissionSigner();
        _;
    }

    /// @dev Lock the logic contract; only clones (fresh storage) can be initialized.
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time per-clone configuration.
    /// @param allowedSelectors   LiFi Diamond selectors to allowlist on init.
    /// @param _maxMinAmountPerTx Cap on the minAmount field (type(uint256).max = uncapped).
    /// @param _permissionSigner  Owner wallet; sole authority for post-init updates.
    function initialize(
        bytes4[] memory allowedSelectors,
        uint256 _maxMinAmountPerTx,
        address _permissionSigner
    ) external initializer {
        if (_permissionSigner == address(0)) revert ZeroAddress();
        maxMinAmountPerTx = _maxMinAmountPerTx;
        permissionSigner = _permissionSigner;
        for (uint256 i; i < allowedSelectors.length; i++) {
            isAllowedSelector[allowedSelectors[i]] = true;
        }
    }

    function setMaxMinAmountPerTx(uint256 newMax) external onlyPermissionSigner {
        maxMinAmountPerTx = newMax;
    }

    /// @notice Add a LiFi selector. Only after verifying its calldata places
    ///         `receiver` at offset 100 and `minAmount` at offset 132.
    function addSelector(bytes4 selector) external onlyPermissionSigner {
        isAllowedSelector[selector] = true;
    }

    function removeSelector(bytes4 selector) external onlyPermissionSigner {
        isAllowedSelector[selector] = false;
    }

    uint256 private constant RECEIVER_OFFSET = 100;
    uint256 private constant MIN_DATA_LEN = 164;

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        // Pass through calls outside this permission's domain (conjunctive model).
        if (ctx.target != LIFI_DIAMOND) return true;
        if (!isAllowedSelector[ctx.selector]) return false;
        if (txData.length < MIN_DATA_LEN) return false;

        address receiver = abi.decode(txData[RECEIVER_OFFSET:RECEIVER_OFFSET + 32], (address));
        uint256 minAmount = abi.decode(txData[RECEIVER_OFFSET + 32:RECEIVER_OFFSET + 64], (uint256));

        if (receiver != ctx.account) return false;
        if (minAmount > maxMinAmountPerTx) return false;
        return true;
    }

    function discriminator() external pure returns (bytes32) {
        return keccak256("LifiDiamondSwapPermissionCloneable.v1");
    }
}
