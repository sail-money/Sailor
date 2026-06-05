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
  buildApprovedHashSignature,
  buildSafeSetupInitializer,
  buildSetManagerExecTransaction,
  encodeSetManager,
  gnosisSafeAbi,
  gnosisSafeExecAbi,
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
  DISPATCH_EIP712_FIELDS,
  REGISTER_PERMISSION_TYPES,
  REGISTER_PERMISSION_TYPES_NO_DEADLINE,
  REGISTER_PERMISSIONS_BATCH_TYPES,
  buildDispatchSignature,
  buildRegisterPermissionTypedData,
  buildRegisterPermissionsBatchTypedData,
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

// ── Intelligence API (auto-generated from api.sail.money/openapi.json) ────────
export type {
  AllocationItem,
  AllocationRequest,
  AllocationResponse,
  BenchmarkResponse,
  ComparePosition,
  CompareRequest,
  CompareResponse,
  ExplainRequest,
  ExplainResponse,
  InstitutionalRequest,
  InstitutionalResponse,
  OpportunitiesResponse,
  PortfolioCheckResponse,
  RebalanceRequest,
  RebalanceResponse,
  RisksSummaryResponse,
  SafeCheckResponse,
  SailIntelligenceOptions,
  ScreenRequest,
  ScreenResponse,
  ValidateRequest,
  ValidateResponse,
  VaultRiskResponse,
  VaultScreenResult,
  YieldOpportunity,
  YieldSourceItem,
  YieldSourcesResponse,
} from "./intelligence.js";
export {
  SAIL_INTELLIGENCE_BASE_URL,
  SAIL_INTELLIGENCE_DOCS_URL,
  SailIntelligence,
} from "./intelligence.js";
