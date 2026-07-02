// Browser-safe barrel for the contract ABIs. These are pure data (no Node
// dependencies), so the UI can import them via `@sail/sdk/abis` without pulling
// in the Node-only keyring through the main entrypoint.
export { SailKernelAbi } from "./SailKernel.js";
export { MandateFactoryAbi } from "./MandateFactory.js";
export { SailGovernanceAbi } from "./SailGovernance.js";
export { ConfigurablePermissionAbi, CONFIGURE_TYPES } from "./ConfigurablePermission.js";
