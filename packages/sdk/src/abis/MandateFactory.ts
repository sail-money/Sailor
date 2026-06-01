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
] as const;
// Note: deployAndAttach and predictCloneAddress were removed — they do not
// exist on the deployed PermissionFactory contract. Clone template deployment
// goes through PermissionFactory.attach with a configureSig signed by the
// permission signer, which handles clone deployment + initialization atomically.
