export * from "./types.js";
export { SailorClient } from "./client.js";
export { LocalKeyring } from "./keyring.js";
export type { EncryptedKeystore, LocalKeyringOptions } from "./keyring.js";
export { SailKernelAbi } from "./abis/SailKernel.js";
export { MandateFactoryAbi } from "./abis/MandateFactory.js";
export { SailGovernanceAbi } from "./abis/SailGovernance.js";

// ── Onboarding / mandate-deploy primitives (verified against Base Sepolia) ──
export type {
  ClientMessage,
  ServerMessage,
  SerializedTypedData,
  SigningRequest,
  SigningRequestBase,
  SigningRequestKind,
  SigningResponse,
  SigningTxRequest,
  SigningTypedDataRequest,
} from "./signing.js";
export {
  SAFE_V141,
  buildSafeSetupInitializer,
  gnosisSafeAbi,
  safeModuleEnablerAbi,
} from "./safe.js";
export { discoverSafesForOwner, getSafeTransactionServiceUrl } from "./discovery.js";
export type { KnownTemplate, SailChainId, SailDeployment } from "./deployments.js";
export {
  getSailDeployment,
  normalizeDeployment,
  sailDeployments,
} from "./deployments.js";
export {
  REGISTER_PERMISSION_TYPES,
  buildRegisterPermissionTypedData,
  sailKernelDomain,
  signRegisterPermission,
} from "./eip712.js";
export { estimatePermissionFee } from "./fees.js";
