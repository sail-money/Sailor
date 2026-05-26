/**
 * SailKernel ABI — only the functions and events the SDK calls.
 * Mirrors contracts/core/SailKernel.sol in SailProtocol.
 *
 * The `Call` tuple is (address target, uint256 value, bytes data), matching
 * the `Call` struct in IBatchPermission.sol.
 */
export const SailKernelAbi = [
  // ── Account instantiation ────────────────────────────────────────────────
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [
      { name: "safeFactory", type: "address" },
      { name: "safeSingleton", type: "address" },
      { name: "safeInitializer", type: "bytes" },
      { name: "saltNonce", type: "uint256" },
      { name: "permissionSigner", type: "address" },
      { name: "manager", type: "address" },
      { name: "feePolicy", type: "address" },
    ],
    outputs: [{ name: "account", type: "address" }],
  },
  {
    type: "function",
    name: "registerAccount",
    stateMutability: "nonpayable",
    inputs: [
      { name: "permissionSigner", type: "address" },
      { name: "manager", type: "address" },
      { name: "feePolicy", type: "address" },
    ],
    outputs: [],
  },

  // ── Permission registry (batch register used by mandate.attachBatch) ──────
  {
    type: "function",
    name: "registerPermissions",
    stateMutability: "payable",
    inputs: [
      { name: "account", type: "address" },
      { name: "permissions", type: "address[]" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },

  // ── Manager dispatch ──────────────────────────────────────────────────────
  {
    type: "function",
    name: "dispatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "permission", type: "address" },
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "managerSig", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "dispatchBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "permission", type: "address" },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
      { name: "managerSig", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "previewBatch",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "permission", type: "address" },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "approved", type: "bool" },
      { name: "reason", type: "string" },
    ],
  },

  // ── Fees ──────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "collectFees",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "grossFee", type: "uint256" },
      { name: "currentNav", type: "uint256" },
      { name: "feeToken", type: "address" },
    ],
    outputs: [],
  },

  // ── Principal tracking ─────────────────────────────────────────────────────
  {
    type: "function",
    name: "recordDeposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "recordWithdrawal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },

  // ── Views ───────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "getPermissions",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getPermissionsWithInfo",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      {
        name: "infos",
        type: "tuple[]",
        components: [
          { name: "permission", type: "address" },
          { name: "isBatch", type: "bool" },
          { name: "hasIntrospection", type: "bool" },
          { name: "permissionId", type: "bytes32" },
          { name: "permissionVersion", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isPermissionRegistered",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "permission", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "configs",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "permissionSigner", type: "address" },
      { name: "manager", type: "address" },
      { name: "feePolicy", type: "address" },
      { name: "sessionActive", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "registered",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "managerNonces",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "batchNonces",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "signerNonces",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },

  // ── Events ────────────────────────────────────────────────────────────────
  {
    type: "event",
    name: "AccountRegistered",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "permissionSigner", type: "address", indexed: true },
      { name: "manager", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "PermissionRegistered",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "permission", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "PermissionRevoked",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "permission", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Dispatched",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "permission", type: "address", indexed: true },
      { name: "target", type: "address", indexed: false },
      { name: "selector", type: "bytes4", indexed: false },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BatchDispatched",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "permission", type: "address", indexed: true },
      { name: "batchHash", type: "bytes32", indexed: false },
      { name: "callCount", type: "uint256", indexed: false },
    ],
  },
] as const;
