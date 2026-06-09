import type { Address } from "viem";
import type { DispatchModel } from "./capabilities.js";

/**
 * Chains with a bundled Sail Protocol deployment.
 * Mainnets: Ethereum (1), Base (8453), Arbitrum (42161), Unichain (130).
 * Testnets: Base Sepolia (84532), Eth Sepolia (11155111).
 *
 * All six chains were redeployed via CREATE2 (global salt, gitCommit 1199b33)
 * so every core contract lands at the same address on every chain.
 */
export type SailChainId = 1 | 8453 | 42161 | 130 | 84532 | 11155111;

/** A pre-audited mandate template available on a chain. */
export type KnownTemplate = {
  kind: string;
  address: Address;
  chainId: SailChainId;
  label: string;
  description?: string;
};

/** One `initialize()` parameter of a clone template, for wizard/tooling display. */
export type CloneTemplateParam = {
  name: string;
  /** Solidity ABI type, e.g. "address[]", "uint256[]", "bytes4[]". */
  type: string;
  description?: string;
};

/**
 * Rich, self-describing metadata for an EIP-1167 clone permission template — the
 * wizard-/tooling-facing companion to the bare `standaloneTemplates` address map.
 * `address` mirrors `standaloneTemplates[key]` (the clone LOGIC). A clone is created
 * per account via `MandateFactory.deployAndAttach(account, address, salt,
 * initData)`, where `initData` ABI-encodes a call to `initialize(initParams…)`.
 */
export type CloneTemplateInfo = {
  /** Matching key in `standaloneTemplates`. */
  key: string;
  /** Clone LOGIC address (mirrors `standaloneTemplates[key]`). */
  address: Address;
  /** IPermission.discriminator() contract name. */
  kind: string;
  label: string;
  description?: string;
  /** ABI of the clone's `initialize(...)`, in order — what a wizard collects. */
  initParams: CloneTemplateParam[];
  /** Path (within this repo) to the canonical reference source. */
  sourceRef?: string;
};

/** Full on-chain deployment of the Sail Protocol on a given chain. */
export type SailDeployment = {
  chainId: SailChainId;
  blockNumber: number;
  deployer: Address;
  governance: Address;
  timelock: Address;
  kernel: Address;
  mandateFactory: Address;
  standardFeePolicy: Address;
  safeModuleEnabler: Address;
  treasury: Address;
  maxPermissionFeeWei: bigint;
  initialBaseFee: bigint;
  initialComplexityRate: bigint;
  /**
   * Dispatch model this kernel implements, as a static hint. Verified on-chain
   * against each kernel's DISPATCH_TYPEHASH. The SDK still prefers live detection
   * (detectKernelCapabilities) and uses this only as a fallback when the on-chain
   * read is unavailable. All deployed chains run the "selective" model, verified
   * on-chain against each kernel's DISPATCH_TYPEHASH.
   */
  dispatchModel?: DispatchModel;
  /** Pre-audited shared mandate templates available on this chain. */
  knownTemplates?: KnownTemplate[];
  /**
   * Standalone (EIP-1167 clone) permission template LOGIC addresses, keyed by a
   * short name. These are the `impl` argument to MandateFactory.deployAndAttach.
   */
  standaloneTemplates?: Record<string, Address>;
  /**
   * Self-describing metadata for selected `standaloneTemplates`, so a wizard can
   * present and configure them (label, description, `initialize()` params) without
   * authoring Solidity. Optional and incremental — not every standalone template
   * has an entry here yet.
   */
  cloneTemplates?: CloneTemplateInfo[];
};

const zero = "0x0000000000000000000000000000000000000000" as Address;

/**
 * CREATE2-deterministic core addresses — identical on every chain (gitCommit 1199b33,
 * deployment mode: create2-global-salt, factory: 0x4e59b44847b379578588920cA78FbF26c0B4956C).
 *
 * Because kernel, safeModuleEnabler, and standardFeePolicy are the same on every chain,
 * SailKernel.createAccount produces the same SMA address with the same owner/manager/salt
 * on every supported chain — enabling true cross-chain deterministic SMA deployment.
 */
const CREATE2_KERNEL = "0x02ABC18B65A328de2e749F56ba79ACF2718a6659" as Address;
const CREATE2_GOVERNANCE = "0x7A478118715791728BDE3bc7A4D7ECfdEB89C6EC" as Address;
const CREATE2_TIMELOCK = "0xE48Ba8DB6d748adafD13155c3590f62e58a77f56" as Address;
const CREATE2_SAFE_MODULE_ENABLER = "0x7897Cb53a4be4a2eaAf46D60573C4Fd83b33fE1F" as Address;
const CREATE2_MANDATE_FACTORY = "0x14EDd6c2a56EfC0d71E215ab13094B9AF90543d2" as Address;
const CREATE2_STANDARD_FEE_POLICY = "0xe7B5901b839cFFDEd9D4108A22712C8BfdA1D80D" as Address;
const CREATE2_TREASURY = "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6" as Address;

export const sailDeployments: Record<SailChainId, SailDeployment> = {
  // ── Ethereum mainnet ─────────────────────────────────────────────────────────
  1: {
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33).
    // allowlistBootstrapped=true (genesis bootstrap), zero fees, 48h timelock.
    chainId: 1,
    blockNumber: 25280925,
    deployer: CREATE2_TREASURY,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_TREASURY,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    knownTemplates: [],
    standaloneTemplates: {},
  },
  // ── Base mainnet ─────────────────────────────────────────────────────────────
  8453: {
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33). Supersedes
    // 0x6319d3dfDDe3804ba93D65752b00c52bFb05a1ab (SAIL-405 redeploy).
    // allowlistBootstrapped=true, zero fees, 48h timelock.
    chainId: 8453,
    blockNumber: 47115338,
    deployer: CREATE2_TREASURY,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_TREASURY,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    knownTemplates: [],
    standaloneTemplates: {},
  },
  // ── Arbitrum mainnet ─────────────────────────────────────────────────────────
  42161: {
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33). Supersedes
    // 0x2716B12832DED0EF5688519c5Fe069EFc0374E02 (SAIL-405 redeploy).
    // allowlistBootstrapped=true, zero fees, 48h timelock.
    chainId: 42161,
    blockNumber: 471736462,
    deployer: CREATE2_TREASURY,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_TREASURY,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    knownTemplates: [],
    standaloneTemplates: {},
  },
  // ── Unichain mainnet ─────────────────────────────────────────────────────────
  130: {
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33). Supersedes
    // 0xD985029960a9B7C2E7E38e102C448b8b8539B156 (SAIL-406 deploy).
    // NOTE: knownTemplates and standaloneTemplates from SAIL-406 were deployed
    // against the old kernel 0xD985029... and are now invalid. They must be
    // redeployed against the new kernel 0x02ABC1... and re-populated here.
    chainId: 130,
    blockNumber: 50271704,
    deployer: CREATE2_TREASURY,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_TREASURY,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    // Templates cleared: the SAIL-406 shared + standalone templates were deployed
    // against the old kernel (0xD985029...) and are invalid against the new one.
    // Re-populate after redeploying templates against 0x02ABC1...
    knownTemplates: [],
    standaloneTemplates: {},
  },
  // ── Base Sepolia (testnet) ───────────────────────────────────────────────────
  84532: {
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33). Supersedes
    // 0xf1D0F4C9893612627409948BAa9d82a01a373799 (SAIL-405 redeploy).
    // allowlistBootstrapped=true, zero fees, 48h timelock.
    chainId: 84532,
    blockNumber: 42625843,
    deployer: CREATE2_TREASURY,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_TREASURY,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    knownTemplates: [],
    standaloneTemplates: {},
  },
  // ── Eth Sepolia (testnet) ────────────────────────────────────────────────────
  11155111: {
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33).
    // allowlistBootstrapped=true, zero fees, 48h timelock.
    chainId: 11155111,
    blockNumber: 11023571,
    deployer: CREATE2_TREASURY,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_TREASURY,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    knownTemplates: [],
    standaloneTemplates: {},
  },
};

export function getSailDeployment(chainId: number): SailDeployment {
  const deployment = sailDeployments[chainId as SailChainId];
  if (!deployment) {
    throw new Error(`No Sail deployment is bundled for chain ${chainId}`);
  }
  return deployment;
}

export function normalizeDeployment(input: Record<string, unknown>): SailDeployment {
  return {
    chainId: Number(input.chainId) as SailChainId,
    blockNumber: Number(input.blockNumber),
    deployer: (input.deployer as Address) ?? zero,
    governance: input.governance as Address,
    timelock: input.timelock as Address,
    kernel: input.kernel as Address,
    // Accept both names: new manifests use mandateFactory; old ones used permissionFactory.
    mandateFactory: (input.mandateFactory ?? input.permissionFactory) as Address,
    standardFeePolicy: input.standardFeePolicy as Address,
    safeModuleEnabler: input.safeModuleEnabler as Address,
    treasury: input.treasury as Address,
    maxPermissionFeeWei: BigInt(input.maxPermissionFeeWei as string | number | bigint),
    initialBaseFee: BigInt(input.initialBaseFee as string | number | bigint),
    initialComplexityRate: BigInt(input.initialComplexityRate as string | number | bigint),
    dispatchModel: input.dispatchModel as SailDeployment["dispatchModel"],
  };
}
