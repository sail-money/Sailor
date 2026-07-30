import type { Address } from "viem";
import type { DispatchModel } from "./capabilities.js";

/**
 * Chains with a bundled Sail Protocol deployment.
 * Mainnets: Ethereum (1), Base (8453), Arbitrum (42161), Optimism (10),
 * Unichain (130), BSC (56), World Chain (480), HyperEVM (999), MegaETH (4326),
 * Robinhood Chain (4663).
 * Testnets: Base Sepolia (84532), Eth Sepolia (11155111).
 *
 * All twelve chains run the Safe-governed CREATE2 deployment (global salt,
 * gitCommit 1dc1960, deploy version create2-2026-07-01) so every core contract
 * and every shared template lands at the same address on every chain.
 */
export type SailChainId = 1 | 8453 | 42161 | 10 | 130 | 56 | 480 | 999 | 4326 | 4663 | 84532 | 11155111;

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
 * (The on-chain function is named `deployAndAttach`; in Sailor and protocol
 * vocabulary this operation is permission registration — the kernel's own
 * functions are registerPermission/registerPermissions.)
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
 * CREATE2-deterministic core addresses — identical on every chain (gitCommit 1dc1960,
 * deployment mode: create2-global-salt, factory: 0x4e59b44847b379578588920cA78FbF26c0B4956C).
 * Safe-governed deploy (create2-2026-07-01), superseding the prior EOA-governed
 * 2026-06-09 deploy.
 *
 * Because kernel, safeModuleEnabler, and standardFeePolicy are the same on every chain,
 * SailKernel.createAccount produces the same SMA address with the same owner/manager/salt
 * on every supported chain — enabling true cross-chain deterministic SMA deployment.
 */
const CREATE2_KERNEL = "0x38b508756c976e876EFF05a29E731A4d348BA6ED" as Address;
const CREATE2_GOVERNANCE = "0x4315B37cA4A315A7042af1Fcb37F8436f4D24356" as Address;
const CREATE2_TIMELOCK = "0xC1E5F9A581D4100Aa949f80204540a33aD97A7b6" as Address;
const CREATE2_SAFE_MODULE_ENABLER = "0x7897Cb53a4be4a2eaAf46D60573C4Fd83b33fE1F" as Address;
const CREATE2_MANDATE_FACTORY = "0x6d2C802ffa0d9A8Ed69A5Bf22c1b63ccB566B8Fc" as Address;
const CREATE2_STANDARD_FEE_POLICY = "0x1087312447C8a2BfA15EB9cE23590E3502DBA04b" as Address;
const CREATE2_DEPLOYER = "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6" as Address;
const CREATE2_TREASURY = "0x7b37F85575F1568a37dBA342BC5FE6d393F0872f" as Address;
const CREATE2_MAX_PERMISSION_FEE_WEI = 10_000_000_000_000_000n;

/**
 * Canonical core CONTRACT addresses — chain-invariant, single source of truth for
 * tooling and docs.
 *
 * Deliberately excludes `deployer`: it is an EOA (the wallet that signed the
 * deploys), not a contract, and consumers that treat these as "safe to publish"
 * constants (e.g. the CLI's share redactor) must be free to redact it as identity.
 */
export const sailCoreAddresses = {
  governance: CREATE2_GOVERNANCE,
  timelock: CREATE2_TIMELOCK,
  kernel: CREATE2_KERNEL,
  mandateFactory: CREATE2_MANDATE_FACTORY,
  standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
  safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
  treasury: CREATE2_TREASURY,
} as const;

/**
 * Shared, multi-tenant permission templates (CREATE2, same address on every chain).
 * Constructor is (kernel, author); kernel is CREATE2_KERNEL, author is CREATE2_DEPLOYER.
 */
const CREATE2_TEMPLATES: Record<string, Address> = {
  swap: "0x35cEEa0db96997Cc3CF3beB42FFa36A499342F7C",
  swapNoOracle: "0x34Ba96CbEd1f46c88A5265E645DC5fe41662b519",
  borrow: "0x3e2666051599223cEAb10De55C89A0842857d8AF",
  deposit: "0xBfB5e13a97b12Ee89d2F2b9B65eCf7e0E371911f",
  withdraw: "0xF5eF5dda450a130e3020d54f565E830e4a7531f8",
  transfer: "0xda909a1CC584fb7559Ce4A828b008B473Da095e1",
  approveAndCallBatch: "0x0535A4D51333484ef583103DAB1a9449756ab732",
};

const CREATE2_KNOWN_TEMPLATES: Omit<KnownTemplate, "chainId">[] = [
  { kind: "SwapPermission", address: CREATE2_TEMPLATES.swap, label: "Swap" },
  {
    kind: "SwapPermissionNoOracle",
    address: CREATE2_TEMPLATES.swapNoOracle,
    label: "Swap (no oracle)",
  },
  { kind: "BorrowPermission", address: CREATE2_TEMPLATES.borrow, label: "Borrow" },
  { kind: "DepositPermission", address: CREATE2_TEMPLATES.deposit, label: "Deposit" },
  { kind: "WithdrawPermission", address: CREATE2_TEMPLATES.withdraw, label: "Withdraw" },
  { kind: "TransferPermission", address: CREATE2_TEMPLATES.transfer, label: "Transfer" },
  {
    kind: "ApproveAndCallBatchPermission",
    address: CREATE2_TEMPLATES.approveAndCallBatch,
    label: "Approve + call batch",
  },
];

/** Shared `SailDeployment` fields identical across every chain in this deploy. */
const COMMON_DEPLOYMENT_FIELDS = {
  deployer: CREATE2_DEPLOYER,
  governance: CREATE2_GOVERNANCE,
  timelock: CREATE2_TIMELOCK,
  kernel: CREATE2_KERNEL,
  mandateFactory: CREATE2_MANDATE_FACTORY,
  standardFeePolicy: CREATE2_STANDARD_FEE_POLICY,
  safeModuleEnabler: CREATE2_SAFE_MODULE_ENABLER,
  treasury: CREATE2_TREASURY,
  maxPermissionFeeWei: CREATE2_MAX_PERMISSION_FEE_WEI,
  initialBaseFee: 0n,
  initialComplexityRate: 0n,
  dispatchModel: "selective" as const,
  // The seven launch templates are SHARED multi-tenant ConfigurablePermission instances
  // (registered by address, configured via configure()), NOT EIP-1167 clone logic. They
  // belong in knownTemplates only. standaloneTemplates is the clone-implementation registry
  // (the `impl` arg to MandateFactory.deployAndAttach) — empty until standalone clones deploy.
  // Populating it with shared templates mislabels them as unaudited community clones in
  // `sailor mandate templates` and makes capabilities advertise them as deployAndAttach-able.
  standaloneTemplates: {} as Record<string, Address>,
};

/** `knownTemplates` for a given chain — same addresses everywhere, chainId varies. */
function knownTemplatesFor(chainId: SailChainId): KnownTemplate[] {
  return CREATE2_KNOWN_TEMPLATES.map((t) => ({ ...t, chainId }));
}

export const sailDeployments: Record<SailChainId, SailDeployment> = {
  // ── Ethereum mainnet ─────────────────────────────────────────────────────────
  1: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 1,
    blockNumber: 25432741,
    knownTemplates: knownTemplatesFor(1),
  },
  // ── Base mainnet ─────────────────────────────────────────────────────────────
  8453: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 8453,
    blockNumber: 48029413,
    knownTemplates: knownTemplatesFor(8453),
  },
  // ── Arbitrum mainnet ─────────────────────────────────────────────────────────
  42161: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 42161,
    blockNumber: 25432669,
    knownTemplates: knownTemplatesFor(42161),
  },
  // ── Optimism mainnet ─────────────────────────────────────────────────────────
  10: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 10,
    blockNumber: 153625159,
    knownTemplates: knownTemplatesFor(10),
  },
  // ── Unichain mainnet ─────────────────────────────────────────────────────────
  130: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 130,
    blockNumber: 52100873,
    knownTemplates: knownTemplatesFor(130),
  },
  // ── BSC mainnet ──────────────────────────────────────────────────────────────
  56: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 56,
    blockNumber: 107312662,
    knownTemplates: knownTemplatesFor(56),
  },
  // ── World Chain mainnet ──────────────────────────────────────────────────────
  480: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 480,
    blockNumber: 31756901,
    knownTemplates: knownTemplatesFor(480),
  },
  // ── HyperEVM mainnet ─────────────────────────────────────────────────────────
  999: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 999,
    blockNumber: 39238629,
    knownTemplates: knownTemplatesFor(999),
  },
  // ── MegaETH mainnet ──────────────────────────────────────────────────────────
  4326: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 4326,
    blockNumber: 20056530,
    knownTemplates: knownTemplatesFor(4326),
  },
  // ── Robinhood Chain mainnet ──────────────────────────────────────────────────
  4663: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 4663,
    blockNumber: 11313197,
    knownTemplates: knownTemplatesFor(4663),
  },
  // ── Base Sepolia (testnet) ───────────────────────────────────────────────────
  84532: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 84532,
    blockNumber: 43539604,
    knownTemplates: knownTemplatesFor(84532),
  },
  // ── Eth Sepolia (testnet) ────────────────────────────────────────────────────
  11155111: {
    ...COMMON_DEPLOYMENT_FIELDS,
    chainId: 11155111,
    blockNumber: 11174750,
    knownTemplates: knownTemplatesFor(11155111),
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
