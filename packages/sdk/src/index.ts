export * from "./types.js";
export {
  chains,
  getChain,
  defaultRpcUrls,
  getDefaultRpcUrl,
  getNativeCurrencySymbol,
} from "./chains.js";
export { SailorClient } from "./client.js";
export { LocalKeyring } from "./keyring.js";
export type { EncryptedKeystore, LocalKeyringOptions } from "./keyring.js";
export { SailKernelAbi } from "./abis/SailKernel.js";
export { MandateFactoryAbi } from "./abis/MandateFactory.js";
export { SailGovernanceAbi } from "./abis/SailGovernance.js";
export {
  ConfigurablePermissionAbi,
  CONFIGURE_TYPES,
} from "./abis/ConfigurablePermission.js";

// ── Onboarding / mandate-deploy primitives (verified against Base Sepolia) ──
export type {
  ClientMessage,
  ServerMessage,
  SerializedTypedData,
  SigningConfirmation,
  SigningRequest,
  SigningRequestBase,
  SigningRequestKind,
  SigningResponse,
  SigningTxRequest,
  SigningTypedDataRequest,
} from "./signing.js";
export {
  SAFE_V141,
  buildApprovedHashSignature,
  buildRegisterAccountExecTransaction,
  buildSafeSetupInitializer,
  buildSetManagerExecTransaction,
  computeKernelBoundSalt,
  computeSafeProxyAddress,
  computeSailSmaAddress,
  encodeSetManager,
  gnosisSafeAbi,
  gnosisSafeExecAbi,
  safeModuleEnablerAbi,
  safeProxyFactoryAbi,
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
  sailCoreAddresses,
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
  DISPATCH_EIP712_FIELDS,
  REGISTER_ACCOUNT_TYPES,
  REGISTER_PERMISSION_TYPES,
  REGISTER_PERMISSION_TYPES_NO_DEADLINE,
  REGISTER_PERMISSIONS_BATCH_TYPES,
  buildConfigureTypedData,
  buildDispatchSignature,
  buildRegisterAccountTypedData,
  buildRegisterPermissionTypedData,
  buildRegisterPermissionsBatchTypedData,
  sailKernelDomain,
  signRegisterPermission,
} from "./eip712.js";
export {
  RegistrationFeeError,
  assertFeeAffordable,
  describeMandateFee,
  estimateMandateRegistrationFee,
  feeShortfall,
  readPermissionRegistrationFee,
} from "./fees.js";
export type { MandateFeeEstimate, PermissionFee } from "./fees.js";
export type { FetchLifiQuoteParams, LifiSwapQuote } from "./lifi.js";
export {
  DEFAULT_SLIPPAGE,
  LIFI_QUOTE_URL,
  LIFI_ROUTERS,
  encodeApprove,
  fetchLifiQuote,
  minTokenOut,
} from "./lifi.js";
