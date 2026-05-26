/**
 * MandateFactory ABI — the bundled (configure → register) orchestrator.
 * Mirrors contracts/factory/MandateFactory.sol in SailProtocol.
 *
 * Only the functions the SDK calls are included.
 */
export const MandateFactoryAbi = [
  {
    type: "function",
    name: "attach",
    stateMutability: "payable",
    inputs: [
      { name: "account", type: "address" },
      { name: "template", type: "address" },
      { name: "params", type: "bytes" },
      { name: "configureDeadline", type: "uint256" },
      { name: "configureSig", type: "bytes" },
      { name: "kernelSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "attachBatch",
    stateMutability: "payable",
    inputs: [
      { name: "account", type: "address" },
      { name: "templates", type: "address[]" },
      { name: "params", type: "bytes[]" },
      { name: "configureDeadlines", type: "uint256[]" },
      { name: "configureSigs", type: "bytes[]" },
      { name: "kernelDeadline", type: "uint256" },
      { name: "kernelBatchSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reconfigure",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "template", type: "address" },
      { name: "params", type: "bytes" },
      { name: "deadline", type: "uint256" },
      { name: "configureSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "replace",
    stateMutability: "payable",
    inputs: [
      { name: "account", type: "address" },
      { name: "oldTemplate", type: "address" },
      { name: "newTemplate", type: "address" },
      { name: "newParams", type: "bytes" },
      { name: "configureDeadline", type: "uint256" },
      { name: "configureSig", type: "bytes" },
      { name: "kernelReplaceSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "detach",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "template", type: "address" },
      { name: "kernelSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "detachBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "templates", type: "address[]" },
      { name: "kernelDeadline", type: "uint256" },
      { name: "kernelBatchSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "deployAndAttach",
    stateMutability: "payable",
    inputs: [
      { name: "account", type: "address" },
      { name: "impl", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "initData", type: "bytes" },
      { name: "kernelSig", type: "bytes" },
    ],
    outputs: [{ name: "clone", type: "address" }],
  },
  {
    type: "function",
    name: "predictCloneAddress",
    stateMutability: "view",
    inputs: [
      { name: "impl", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
