/**
 * SailGovernance ABI — only the views needed to estimate the permission
 * registration fee. The deployed Base/Base-Sepolia governance uses the legacy
 * fee model: baseFee + byteLength * complexityRate, capped at
 * MAX_PERMISSION_FEE_WEI. Newer governance may expose a flat
 * permissionRegistrationFee() instead; estimatePermissionFee falls back to it.
 */
export const SailGovernanceAbi = [
  {
    type: "function",
    name: "baseFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "complexityRate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_PERMISSION_FEE_WEI",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "permissionRegistrationFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxPermissionsPerAccount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isPaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;
