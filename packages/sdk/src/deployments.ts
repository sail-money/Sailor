import type { Address } from "viem";
import type { DispatchModel } from "./capabilities.js";

/**
 * Chains with a bundled Sail Protocol deployment.
 * Mainnets: Ethereum (1), Base (8453), Arbitrum (42161), Unichain (130).
 * Testnets: Base Sepolia (84532), Eth Sepolia (11155111).
 *
 * Core contracts deploy via CREATE2 (global salt, version create2-safe-2026-06-17)
 * through factory 0x4e59b44847b379578588920cA78FbF26c0B4956C so every core
 * contract lands at the same address on every chain. Live on 8453, 42161, 130,
 * 84532, 11155111 (2026-06-17); Ethereum mainnet (1) is pending (safe batch
 * prepared, awaiting execution) but shares these addresses once deployed.
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
 * CREATE2-deterministic core addresses — identical on every chain (version
 * create2-safe-2026-06-17, deployment mode: create2-global-salt, factory:
 * 0x4e59b44847b379578588920cA78FbF26c0B4956C).
 *
 * Because kernel, safeModuleEnabler, and standardFeePolicy are the same on every chain,
 * SailKernel.createAccount produces the same SMA address with the same owner/manager/salt
 * on every supported chain — enabling true cross-chain deterministic SMA deployment.
 */
export const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;
export const CREATE2_SAFE_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67" as Address;
export const CREATE2_OWNER = "0x152a32c851d317Cd54F1E6423377d7D58Dd3DE8C" as Address;
export const CREATE2_KERNEL = "0x3E4C45D34Ea49DB66a78dd965B005f91d483C13F" as Address;
export const CREATE2_GOVERNANCE = "0xCBC9DcC44485250c6C8D3597E5CD45beCb858c7b" as Address;
export const CREATE2_TIMELOCK = "0xC1E5F9A581D4100Aa949f80204540a33aD97A7b6" as Address;
export const CREATE2_SAFE_MODULE_ENABLER = "0x7897Cb53a4be4a2eaAf46D60573C4Fd83b33fE1F" as Address;
export const CREATE2_MANDATE_FACTORY = "0x7c1714C2B7CF7ED2AAAEbdb615692A9c1F3eb46f" as Address;
export const CREATE2_STANDARD_FEE_POLICY = "0x9a73C8E1BC4772959cB0c40Fd1d37234d6743819" as Address;

/** Canonical core contract addresses — single source of truth for tooling and docs. */
export const sailCoreAddresses = {
  create2Factory: CREATE2_FACTORY,
  safeProxyFactory: CREATE2_SAFE_PROXY_FACTORY,
  owner: CREATE2_OWNER,
  governance: CREATE2_GOVERNANCE,
  timelock: CREATE2_TIMELOCK,
  kernel: CREATE2_KERNEL,
  mandateFactory: CREATE2_MANDATE_FACTORY,
  standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
  safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
} as const;

/** Flat per-permission registration fee at genesis (wei). Read live on-chain at sign time. */
export const INITIAL_PERMISSION_REGISTRATION_FEE_WEI = 10_000_000_000_000n;

export const sailDeployments: Record<SailChainId, SailDeployment> = {
  // ── Ethereum mainnet ─────────────────────────────────────────────────────────
  1: {
    // CREATE2 deterministic deploy (create2-safe-2026-06-17). PENDING — safe batch
    // prepared (deployments/1/safe-deploy-batch.json), awaiting execution. Shares
    // the same core addresses as live chains once deployed.
    chainId: 1,
    blockNumber: 0,
    deployer: CREATE2_OWNER,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_OWNER,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    knownTemplates: [],
    standaloneTemplates: {},
  },
  // ── Base mainnet ─────────────────────────────────────────────────────────────
  8453: {
    // CREATE2 deterministic deploy (create2-safe-2026-06-17). Live, bootstrapped.
    chainId: 8453,
    blockNumber: 0,
    deployer: CREATE2_OWNER,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_OWNER,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    knownTemplates: [],
    standaloneTemplates: {},
  },
  // ── Arbitrum mainnet ─────────────────────────────────────────────────────────
  42161: {
    // CREATE2 deterministic deploy (create2-safe-2026-06-17). Live, bootstrapped.
    chainId: 42161,
    blockNumber: 0,
    deployer: CREATE2_OWNER,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_OWNER,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    knownTemplates: [],
    standaloneTemplates: {},
  },
  // ── Unichain mainnet ─────────────────────────────────────────────────────────
  130: {
    // CREATE2 deterministic deploy (create2-safe-2026-06-17). Live, bootstrapped.
    chainId: 130,
    blockNumber: 0,
    deployer: CREATE2_OWNER,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_OWNER,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    knownTemplates: [],
    standaloneTemplates: {},
  },
  // ── Base Sepolia (testnet) ───────────────────────────────────────────────────
  84532: {
    // CREATE2 deterministic deploy (create2-safe-2026-06-17). Live, bootstrapped.
    chainId: 84532,
    blockNumber: 0,
    deployer: CREATE2_OWNER,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_OWNER,
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective",
    knownTemplates: [],
    standaloneTemplates: {},
  },
  // ── Eth Sepolia (testnet) ────────────────────────────────────────────────────
  11155111: {
    // CREATE2 deterministic deploy (create2-safe-2026-06-17). Live, bootstrapped.
    chainId: 11155111,
    blockNumber: 0,
    deployer: CREATE2_OWNER,
    governance: CREATE2_GOVERNANCE,
    timelock: CREATE2_TIMELOCK,
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
    safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
    treasury: CREATE2_OWNER,
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
  // Guard: mandateFactory is required. Accept the legacy permissionFactory alias too,
  // but if both are absent the config is malformed — cast-to-Address would silently
  // produce undefined and cause a confusing runtime error far from the source.
  if (!input.mandateFactory && !input.permissionFactory) {
    throw new Error(
      'normalizeDeployment: deployment config is missing "mandateFactory" ' +
        '(and the legacy "permissionFactory" alias). ' +
        "Add a mandateFactory address to the deployment configuration.",
    );
  }
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
