/**
 * ConfigurablePermission ABI — the shared, multi-account permission template
 * base. Mirrors contracts/templates/ConfigurablePermission.sol in SailProtocol.
 *
 * The seven shared singletons (SwapPermission, BorrowPermission, etc.) extend
 * this base, so every one of them exposes the same per-account config lifecycle:
 *
 *   - `configure(account, params, deadline, sig)`   — EIP-712 sig path
 *   - `configureDirect(account, params)`            — msg.sender == permissionSigner path
 *   - `isConfigured(account)` / `configNonces(account)` / `configuredEpoch(account)`
 *
 * Only the functions the SDK / CLI calls are included. `evaluate` is NOT here —
 * it lives on each concrete subclass and the kernel reads it via a per-permission
 * staticcall; `sailor mandate simulate` probes it directly by address.
 */
export const ConfigurablePermissionAbi = [
  {
    type: "function",
    name: "configure",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "params", type: "bytes" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "configureDirect",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "params", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isConfigured",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "configNonces",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "configuredEpoch",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "hashTypedDataV4",
    stateMutability: "view",
    inputs: [{ name: "structHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

/** The EIP-712 `Configure` struct signed by the permissionSigner for `configure()`. */
export const CONFIGURE_TYPEHASH_FIELDS = [
  { name: "account", type: "address" },
  { name: "paramsHash", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
  { name: "epoch", type: "uint256" },
] as const;

export const CONFIGURE_TYPES = {
  Configure: CONFIGURE_TYPEHASH_FIELDS,
} as const;
