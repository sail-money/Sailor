// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// SailCalldata — safe static-parameter extraction for IPermission.evaluate()
//
// PROBLEM
//   evaluate(bytes calldata txData, Context calldata ctx) receives raw ABI-
//   encoded calldata. Extracting parameters by hand is the most dangerous part
//   of permission writing:
//     • Forgetting the length check before decoding → silent wrong value or
//       revert instead of clean `return false`.
//     • Wrong slot index → decoding the wrong parameter (type-checks, still wrong).
//     • Truncation bugs when casting uint256 slots to address (padding bits).
//
// SOLUTION
//   This library centralises the three operations into named helpers:
//     1. hasParams()  — explicit length guard (call once, at the top of evaluate)
//     2. asAddress()  — extract + mask to 20 bytes
//     3. asUint256(), asInt256(), asBytes32(), asBool(), asUint128() — typed slots
//
//   All helpers are view/pure and add zero gas overhead beyond the slice itself.
//
// USAGE (replace abi.decode pattern)
//
//   // Before:
//   if (txData.length < 4 + 3 * 32) return false;
//   (address asset, uint256 amount, address onBehalfOf) =
//       abi.decode(txData[4:], (address, uint256, address));
//
//   // After:
//   if (!SailCalldata.hasParams(txData, 3)) return false;
//   address  asset      = SailCalldata.asAddress(txData, 0);
//   uint256  amount     = SailCalldata.asUint256(txData, 1);
//   address  onBehalfOf = SailCalldata.asAddress(txData, 2);
//
// LIMITATIONS
//   Only covers static (fixed-size) ABI types. Dynamic types (bytes, string,
//   arrays) use pointer indirection — decode them with abi.decode(txData[4:], ...)
//   after the hasParams() guard, or write a dedicated extractor.
//
// SLOT INDEXING
//   Slots are 0-indexed from the first constructor parameter (after the 4-byte
//   selector). Slot 0 = bytes [4..35], slot 1 = bytes [36..67], etc.
// ─────────────────────────────────────────────────────────────────────────────

library SailCalldata {
    // ── Guards ────────────────────────────────────────────────────────────────

    /// @notice Returns true when txData is long enough to hold `params` static
    ///         32-byte ABI slots after the 4-byte selector.
    /// @dev    Call this once at the top of evaluate() before any slot access.
    ///         Returns false (not revert) so evaluate() can return false cleanly.
    function hasParams(bytes calldata txData, uint256 params) internal pure returns (bool) {
        return txData.length >= 4 + params * 32;
    }

    // ── Static-type extractors ────────────────────────────────────────────────
    // All assume hasParams() has already been checked for the relevant slot.
    // Accessing an out-of-bounds slot will cause the calldata slice to revert —
    // always guard with hasParams() first.

    /// @notice Extract an address from ABI slot `i` (0-indexed after selector).
    ///         Masks to 20 bytes, discarding the ABI zero-padding in the upper 12.
    function asAddress(bytes calldata txData, uint256 i) internal pure returns (address) {
        return address(uint160(uint256(bytes32(txData[4 + i * 32 : 4 + (i + 1) * 32]))));
    }

    /// @notice Extract a uint256 from ABI slot `i`.
    function asUint256(bytes calldata txData, uint256 i) internal pure returns (uint256) {
        return uint256(bytes32(txData[4 + i * 32 : 4 + (i + 1) * 32]));
    }

    /// @notice Extract an int256 from ABI slot `i`.
    function asInt256(bytes calldata txData, uint256 i) internal pure returns (int256) {
        return int256(uint256(bytes32(txData[4 + i * 32 : 4 + (i + 1) * 32])));
    }

    /// @notice Extract a bytes32 from ABI slot `i`.
    function asBytes32(bytes calldata txData, uint256 i) internal pure returns (bytes32) {
        return bytes32(txData[4 + i * 32 : 4 + (i + 1) * 32]);
    }

    /// @notice Extract a bool from ABI slot `i` (true when slot value is non-zero).
    function asBool(bytes calldata txData, uint256 i) internal pure returns (bool) {
        return asUint256(txData, i) != 0;
    }

    /// @notice Extract a uint128 from ABI slot `i` (lower 128 bits of the slot).
    function asUint128(bytes calldata txData, uint256 i) internal pure returns (uint128) {
        return uint128(asUint256(txData, i));
    }

    /// @notice Extract a uint64 from ABI slot `i`.
    function asUint64(bytes calldata txData, uint256 i) internal pure returns (uint64) {
        return uint64(asUint256(txData, i));
    }

    /// @notice Extract a uint32 from ABI slot `i`.
    function asUint32(bytes calldata txData, uint256 i) internal pure returns (uint32) {
        return uint32(asUint256(txData, i));
    }

    /// @notice Extract a uint24 from ABI slot `i` (e.g. Uniswap fee tier).
    function asUint24(bytes calldata txData, uint256 i) internal pure returns (uint24) {
        return uint24(asUint256(txData, i));
    }

    /// @notice Extract a uint16 from ABI slot `i` (e.g. Aave referral code).
    function asUint16(bytes calldata txData, uint256 i) internal pure returns (uint16) {
        return uint16(asUint256(txData, i));
    }

    /// @notice Extract bytes4 (a function selector) from ABI slot `i`.
    function asBytes4(bytes calldata txData, uint256 i) internal pure returns (bytes4) {
        return bytes4(asBytes32(txData, i));
    }
}
