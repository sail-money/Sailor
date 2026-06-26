/**
 * SailGovernance ABI — the views needed to read the permission registration fee.
 * The kernel charges a FLAT fee: `permissionRegistrationFee()` per permission
 * (total = fee × n), bounded by MAX_PERMISSION_FEE_WEI, excess refunded. The
 * baseFee / complexityRate views below describe an abandoned bytecode-size-based
 * design that never shipped in the live contracts; they are retained only for
 * back-compat and are not used to compute the fee.
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
