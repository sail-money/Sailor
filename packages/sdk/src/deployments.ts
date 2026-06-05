import type { Address } from "viem";
import type { DispatchModel } from "./capabilities.js";

/** Chains with a bundled Sail Protocol deployment: Base, Base Sepolia, Arbitrum, Unichain. */
export type SailChainId = 8453 | 84532 | 42161 | 130;

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
   * read is unavailable. All three bundled chains (Base, Base Sepolia, Arbitrum)
   * run the "selective" model, verified on-chain against each kernel's DISPATCH_TYPEHASH.
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
    // SAIL-405 redeploy (2026-06-04, gitCommit 0ed0561): adds owner-gated
    // setManager(newManager) to rotate the SMA's delegated signer (clears the
    // permission set + bumps the nonce epoch). Genesis allowlist bootstrap +
    // local CREATE2 proxy prediction carried over; allowlistBootstrapped=true,
    // zero fees, onboarding live. Supersedes 0x20eff0DbE752e22655A6dAA5A94521FA06CDdE06.
    // Only `core` was redeployed; shared/standalone permission templates are NOT yet
    // deployed against this kernel (run the templates targets + refill the maps first).
    chainId: 8453,
    blockNumber: 46898030,
    deployer: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    governance: "0x7E897D919872b1587577617ffFC42113679d0C50",
    timelock: "0x8eC3Ca951E193C6E3713A70022454d7A1f083281",
    kernel: "0x6319d3dfDDe3804ba93D65752b00c52bFb05a1ab",
    permissionFactory: "0x7724EACd97C8601d5AC244Aadbf76ad87353Ff31",
    standardFeePolicy: "0x65850a8D5050aeAade68289ff96c4F119a24B82e",
    safeModuleEnabler: "0xC84EdE78f93291A1fab19F51c4c7e938AB302Edf",
    treasury: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    knownTemplates: [],
    standaloneTemplates: {},
  },
  42161: {
    // SAIL-405 redeploy (2026-06-04, gitCommit 0ed0561): adds owner-gated
    // setManager(newManager) to rotate the SMA's delegated signer (clears the
    // permission set + bumps the nonce epoch). Genesis allowlist bootstrap +
    // local CREATE2 proxy prediction carried over; allowlistBootstrapped=true,
    // zero fees, onboarding live. Supersedes 0x9AF32E0C395fb31f5cA28994351F8fAE3003e125.
    // Bootstrap was sent as a standalone tx post-core-deploy; identical end state to Base.
    // Only `core` was redeployed; shared/standalone permission templates are NOT yet
    // deployed against this kernel (run the templates targets + refill the maps first).
    chainId: 42161,
    blockNumber: 25244824,
    deployer: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    governance: "0xd6AbB7A1036ADc7958Abffec9Da03450c5a2Ec8e",
    timelock: "0x114CB7110C780f7E3a6093AfE0B52463a569857C",
    kernel: "0x2716B12832DED0EF5688519c5Fe069EFc0374E02",
    permissionFactory: "0x23681A8A4C9819D8EaB37E46B858da6F3c85E683",
    standardFeePolicy: "0xAdfB986D48480bC67a7cF3751d30599161632e0D",
    safeModuleEnabler: "0xabe2a6D03F592BC602cA1dBDCD885ba2493274f9",
    treasury: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    knownTemplates: [],
    standaloneTemplates: {},
  },
  130: {
    // SAIL-406 deploy (2026-06-05, gitCommit 2c9e325): full protocol deploy on
    // Unichain mainnet — core + the complete template suite (7 shared + 12
    // standalone), all source-verified on uniscan.xyz. Genesis allowlist
    // bootstrap (allowlistBootstrapped=true: Safe v1.4.1 factory, both
    // singletons, SafeModuleEnabler, StandardFeePolicy, SafeProxy codehash
    // 0xd7d408eb…fb4c), zero fees, onboarding live without the 48h timelock.
    // First chain to ship permission templates against the kernel.
    chainId: 130,
    blockNumber: 49897206,
    deployer: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    governance: "0xAb5C90ECfF2763f6f20f8E553E3b8778dD9C349A",
    timelock: "0xd44FbBB37f01e235E0EE5386948F216d36D0CEf2",
    kernel: "0xD985029960a9B7C2E7E38e102C448b8b8539B156",
    permissionFactory: "0x8edDb62Aa49CeB837abf2653be2d93Ad9Fe6777D",
    standardFeePolicy: "0x7bBA8BE3c01c972757aA4a230A00D58aB600A1F1",
    safeModuleEnabler: "0xFE9227A9F2baf704060c604466df354a5A137b9B",
    treasury: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    maxPermissionFeeWei: 1_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    knownTemplates: [
      {
        address: "0xbD624eC67e2685872A60c0aF8F020727e20D096e",
        kind: "SharedAMMLiquidityPermission",
        chainId: 130,
        label: "Shared AMM Liquidity",
        description:
          "Bounded AMM liquidity provision/removal — enforces allowed pools and bounds.",
      },
      {
        address: "0x9d386605518FA81ff536b351ff055d26203229A9",
        kind: "SharedApproveAndCallBatchPermission",
        chainId: 130,
        label: "Shared Approve-and-Call Batch",
        description:
          "Bounded approve-then-call batch — enforces token, spender, and selector allowlists.",
      },
      {
        address: "0x948a9F9a6f2828E50f7e71bd569ba75A69da2BEb",
        kind: "SharedBoundedBorrowPermission",
        chainId: 130,
        label: "Shared Bounded Borrow",
        description: "Bounded borrow — enforces allowed markets and max borrow size.",
      },
      {
        address: "0xfD19fad56Ca3d6FaCd4279a2F84f09bef8967f6a",
        kind: "SharedBoundedSwapPermission",
        chainId: 130,
        label: "Shared Uniswap V3 Swap",
        description:
          "Bounded swap via Uniswap V3 — enforces allowed tokens, max trade size, and slippage.",
      },
      {
        address: "0x900cd03ee15e629bC4e94F6344d5529F4862071c",
        kind: "SharedDeFiBundlePermission",
        chainId: 130,
        label: "Shared DeFi Bundle",
        description: "Bounded multi-step DeFi bundle within a single permission.",
      },
      {
        address: "0x1dF90a2484bCF3c6Da2FB035aa0C9f523e77Cd62",
        kind: "SharedPendlePermission",
        chainId: 130,
        label: "Shared Pendle",
        description: "Bounded Pendle interactions — enforces allowed markets and bounds.",
      },
      {
        address: "0x851Ad196b7DC6c05eaf0B9420f2a72dc336D7739",
        kind: "SharedTransferTargetPermission",
        chainId: 130,
        label: "Shared Transfer Target",
        description: "Allows transfers only to a pre-approved target address.",
      },
    ],
    standaloneTemplates: {
      // EIP-1167 clone LOGIC addresses — the `impl` argument to
      // PermissionFactory.deployAndAttach(account, impl, salt, initData). A clone
      // is created and configured per account via its initialize(...).
      azuroPrediction: "0xd48cdBB25bF0A214dEffECac3c9431650834b046",
      boundedApprove: "0xbF7089A905081054c9dA628707f2e1EF70A7F300",
      boundedBorrow: "0x17D466309C7E0237960f68126Cc4A109D194ac28",
      boundedDeposit: "0xf49E304EDf806AF46E8f17740e56C1CBFad5d264",
      boundedLiFi: "0x6a0171013FeD6B2Eda16A4dd4DB33Fa34b7F3e3f",
      boundedSwap: "0x06696F9dd4bD0994f55b075600627Dc6E54635c9",
      boundedWithdraw: "0xE207CfC8c2204b15ee5fD22B79472929706c7E4b",
      gmxPerp: "0xB1bb967aC11D61C0599c8458D9B950461db5D4E9",
      gainsNetworkPerp: "0x1297673f71A9be02bc876Dbd0ceaB3c96D268bE3",
      limitlessPrediction: "0x2bE4280d8816626e1dea4E94A83d9334A971AF90",
      synthetixPerp: "0x711a70B16D013a9B96Bd6733F4b3097e5787f860",
      transferTarget: "0x8428155b6b9eea4E78b9a52c2312752eD04Baf16",
    },
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
