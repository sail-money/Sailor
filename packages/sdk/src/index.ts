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
export type {
  CloneTemplateInfo,
  CloneTemplateParam,
  KnownTemplate,
  SailChainId,
  SailDeployment,
} from "./deployments.js";
export {
  getSailDeployment,
  normalizeDeployment,
  sailDeployments,
} from "./deployments.js";
export type { DispatchModel, KernelCapabilities } from "./capabilities.js";
export {
  DISPATCH_TYPE_STRINGS,
  DISPATCH_TYPEHASHES,
  REGISTER_PERMISSION_TYPE_STRINGS,
  REGISTER_PERMISSION_TYPEHASHES,
  clearCapabilityCache,
  detectKernelCapabilities,
} from "./capabilities.js";
export type { KernelError } from "./errors.js";
export {
  KERNEL_ERROR_ABI,
  KERNEL_ERROR_SIGNATURES,
  decodeKernelError,
  explainKernelRevert,
} from "./errors.js";
export {
  REGISTER_PERMISSION_TYPES,
  buildRegisterPermissionTypedData,
  sailKernelDomain,
  signRegisterPermission,
} from "./eip712.js";
export { estimatePermissionFee } from "./fees.js";
export type { FetchLifiQuoteParams, LifiSwapQuote } from "./lifi.js";
export {
  DEFAULT_SLIPPAGE,
  LIFI_QUOTE_URL,
  LIFI_ROUTERS,
  encodeApprove,
  fetchLifiQuote,
} from "./lifi.js";
