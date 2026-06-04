import type { Address } from "viem";
import type { DispatchModel } from "./capabilities.js";

/** Chains with a bundled Sail Protocol deployment: Base, Base Sepolia, Arbitrum. */
export type SailChainId = 8453 | 84532 | 42161;

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
 * per account via `PermissionFactory.deployAndAttach(account, address, salt,
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
  permissionFactory: Address;
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
   * read is unavailable. Active models differ per chain: both Base chains run the
   * "conjunctive" model; Arbitrum runs "selective" — do NOT assume one globally.
   */
  dispatchModel?: DispatchModel;
  /** Pre-audited shared mandate templates available on this chain. */
  knownTemplates?: KnownTemplate[];
  /**
   * Standalone (EIP-1167 clone) permission template LOGIC addresses, keyed by a
   * short name. These are the `impl` argument to PermissionFactory.deployAndAttach.
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

export const sailDeployments: Record<SailChainId, SailDeployment> = {
  84532: {
    // SAIL-405 redeploy (2026-06-04, gitCommit 6d872e6): adds owner-gated
    // setManager(newManager) to rotate the SMA's delegated signer (clears the
    // permission set + bumps the nonce epoch). Genesis allowlist bootstrap +
    // local CREATE2 proxy prediction carried over; allowlistBootstrapped=true,
    // createAccount verified working, zero fees, onboarding live. Supersedes
    // 0xcC50009115DAaBCB40513e03a1a0Cc2Fdf6Be558. Only `core` was redeployed;
    // shared/standalone permission templates are NOT yet deployed against this
    // kernel (run the templates targets + refill the template maps before clones).
    chainId: 84532,
    blockNumber: 42400417,
    deployer: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    governance: "0xEaD44bC6999E7b00b9b2E11c1660248DC2a30993",
    timelock: "0x97B863e392C9859336788D5Ec454527d33C95B74",
    kernel: "0xf1D0F4C9893612627409948BAa9d82a01a373799",
    permissionFactory: "0xdfF6a2272F667cDf78Af4681b9c88A219998db95",
    standardFeePolicy: "0x05570F7973b46Eb9Ed4518422891EFC26BD58b97",
    safeModuleEnabler: "0xB2C2B52d94412e3472C9fb2B52186eA12a935869",
    treasury: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    knownTemplates: [],
    standaloneTemplates: {},
  },
  8453: {
    chainId: 8453,
    blockNumber: 46074750,
    deployer: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    // Bootstrap redeploy (2026-06-03) — fixed kernel, allowlists bootstrapped at genesis, zero fees.
    // Only core was redeployed; templates not yet deployed against this kernel.
    governance: "0x690e7Ab3CEB5e3E1c3aC05f79a025429B589F6Cc",
    timelock: "0xcDe8680561B4A96f632622a10E6A4EF5Bac7a516",
    kernel: "0x20eff0DbE752e22655A6dAA5A94521FA06CDdE06",
    permissionFactory: "0x3992106495818E4037e698B8Eb09B452cEfE87F2",
    standardFeePolicy: "0x72c992B1b60cAbec333F745DfF7dbfF575Fe2845",
    safeModuleEnabler: "0xcd4f22edbDc54Ba5612492583C6F498320ee2B84",
    treasury: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    knownTemplates: [],
    standaloneTemplates: {},
  },
  42161: {
    chainId: 42161,
    blockNumber: 25136878,
    deployer: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    // Bootstrap redeploy (2026-06-03) — fixed kernel, allowlists bootstrapped at genesis, zero fees.
    // Only core was redeployed; templates not yet deployed against this kernel.
    governance: "0xb37a203CfdF8CA5e904f3637ef6258aaDA291091",
    timelock: "0xF244bcf4BdAaa2494F919d8DFEFad7129a67caAC",
    kernel: "0x9AF32E0C395fb31f5cA28994351F8fAE3003e125",
    permissionFactory: "0x0E8138dA9175B02Db15cb221497A663BA0807553",
    standardFeePolicy: "0x7711687948F6d4bB6262a72149CD7977981B7e1E",
    safeModuleEnabler: "0x8f1Ac6cbBb321De315d2Bf58973A13d111BF7269",
    treasury: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    knownTemplates: [],
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
    permissionFactory: input.permissionFactory as Address,
    standardFeePolicy: input.standardFeePolicy as Address,
    safeModuleEnabler: input.safeModuleEnabler as Address,
    treasury: input.treasury as Address,
    maxPermissionFeeWei: BigInt(input.maxPermissionFeeWei as string | number | bigint),
    initialBaseFee: BigInt(input.initialBaseFee as string | number | bigint),
    initialComplexityRate: BigInt(input.initialComplexityRate as string | number | bigint),
    dispatchModel: input.dispatchModel as SailDeployment["dispatchModel"],
  };
}
