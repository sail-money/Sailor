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
   * read is unavailable. All active deployments run the "selective" model.
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
    chainId: 84532,
    blockNumber: 41583106,
    deployer: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    governance: "0xd289CcbA0302fB819F68056526e2B495b033895d",
    timelock: "0x957E2460C3D46f5A2dBAF2d6B5C4Ff86CD1338cA",
    kernel: "0x7d3BDAAB150af93f057C38e9baef88061B17dE1D",
    permissionFactory: "0x14D35766C6d8f8F21e86d122d788d0218026f93f",
    standardFeePolicy: "0xA799f142469D8eF17fDb3AAe5710e6b44c9E5518",
    safeModuleEnabler: "0x4C1DEb53666490ca462F31ede4047aa02ad5a97e",
    treasury: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    maxPermissionFeeWei: 10_000_000_000_000_000n,
    initialBaseFee: 100_000_000_000_000n,
    initialComplexityRate: 100n,
    // PENDING post-Octane redeploy — do NOT activate until timelock allowlists are set
    // kernel 0x2e22Cc96F5C069C9eC8B9310E1BbF08C41Ae613E | mandateFactory 0x19650F55577242953Cea668D59F5049a6faf3480 | governance 0x2287e52c7fDb5748bB05a857c026D732D1634707
    dispatchModel: "conjunctive", // conjunctive: verified on-chain DISPATCH_TYPEHASH 0x7510c80e081cb7da97f59eadd13c9941a013c4a37d514f597bd209c0c746599a
    knownTemplates: [],
    standaloneTemplates: {
      azuroPrediction: "0x10f98807E7DBBAed599b8246167660e0660C490b",
      boundedApprove: "0x6F8845bbf837E18821e93b08F6F052200D618593",
      boundedBorrow: "0xFcDb4B3856DC25D0e81019B73407edd2585f550F",
      boundedDeposit: "0x18EA6F93C74A997093273EC8b5490bD5570eaD9A",
      boundedLiFi: "0x52Fe34Cc86A93c4FD46A49A30e90Da396A531AA1",
      boundedSwap: "0x40F1b6c0c30Cb9672026297AE145855226532781",
      boundedWithdraw: "0x4D86241D4E0DB6D2DD996C9C92B50E84e38442b3",
      gmxPerp: "0x03A0e0973874DD788eD0a519Ab612b4F722d1176",
      gainsNetworkPerp: "0x1A1aeDe8021690A3536e7dB4Fb83008f3B9b0062",
      limitlessPrediction: "0x46f045AD9B6a4b568F7651B11686b5268BCeE403",
      synthetixPerp: "0xd38566B009025F04A2959E9195Fc590C1F061f33",
      transferTarget: "0x807dA7B33218301f7349159EB224711F2cdA766A",
    },
  },
  8453: {
    chainId: 8453,
    blockNumber: 46074750,
    deployer: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    governance: "0x255147f05C1CB0bA33d0bA6025Ea6E55598CF985",
    timelock: "0xdC061104D4C2F4aD735964395D4D6cEfe8dD0348",
    kernel: "0xbEd6F78c6d89547Fb9B43d599621dd80ce57F154",
    permissionFactory: "0xc3FFb7128bc95B5e3a3268f6E168c331FF13fE07",
    standardFeePolicy: "0xadf7f1574128C59FAC13e0207030Bb361D82adFa",
    safeModuleEnabler: "0x8508B2EFA351F6FEe4F7938aDbF36294a4c18F63",
    treasury: "0xB01dCE443d052e44b7D13726c0EC9fFB7f5815B6",
    maxPermissionFeeWei: 10_000_000_000_000_000n,
    initialBaseFee: 0n,
    initialComplexityRate: 0n,
    // PENDING post-Octane redeploy — do NOT activate until timelock allowlists are set
    // kernel 0x852553c5ceb0B2c4c429F355fFBB719ECeF6d0d4 | mandateFactory 0x0402b812cCD90608Ca91AdE265082aCa0b8780C8 | governance 0xe88668dEd183ef283A606b0D7f6Dbcc4D3f4639B
    dispatchModel: "conjunctive", // conjunctive: verified on-chain DISPATCH_TYPEHASH 0x7510c80e081cb7da97f59eadd13c9941a013c4a37d514f597bd209c0c746599a
    knownTemplates: [
      {
        address: "0xe5DE579F8D8C99F83C0b979a85049c7D68b381c6",
        kind: "SharedBoundedSwapPermission",
        chainId: 8453,
        label: "Shared Uniswap V3 Swap",
        description:
          "Bounded swap via Uniswap V3 — enforces allowed tokens, max trade size, and slippage.",
      },
      {
        address: "0x8901e20089F2b9E0473EDA96b3FB9376dDb2160F",
        kind: "SharedTransferTargetPermission",
        chainId: 8453,
        label: "Shared Transfer Target",
        description: "Allows transfers only to a pre-approved target address.",
      },
    ],
    standaloneTemplates: {
      // EIP-1167 clone LOGIC for LiFi DCA on Base mainnet — pass-through,
      // initialize()-configured, registered per account via deployAndAttach.
      // boundedLiFi: LifiDiamondSwapPermissionCloneable (swap bounded to the LiFi
      //   diamond + selector allowlist + receiver==account + minAmount cap).
      // boundedApprove: LifiBoundedApprovePermissionCloneable (approve only the LiFi
      //   diamond, PER-TOKEN caps so mixed-decimal tokens like DAI/USDC are bounded).
      boundedLiFi: "0xF1abcF774250fD1A8147B56DA07Bf9021064650A",
      boundedApprove: "0x9c0b86daf9e75d759a5D165aD7366e52b3353fD8",
    },
    cloneTemplates: [
      {
        key: "boundedLiFi",
        address: "0xF1abcF774250fD1A8147B56DA07Bf9021064650A",
        kind: "LifiDiamondSwapPermissionCloneable",
        label: "LiFi Swap (bounded)",
        description:
          "Restricts manager swaps to the official LiFi Diamond — selector allowlist, " +
          "receiver must equal the account, and a cap on the minAmount field. Passes " +
          "through non-LiFi calls (conjunctive model).",
        initParams: [
          { name: "allowedSelectors", type: "bytes4[]", description: "LiFi Diamond selectors to allowlist (e.g. 0x5fd9ae2e)." },
          { name: "maxMinAmountPerTx", type: "uint256", description: "Cap on the minAmount field; type(uint256).max = uncapped." },
          { name: "permissionSigner", type: "address", description: "Owner wallet; sole authority for post-init updates." },
        ],
        sourceRef: "templates/lifi-permissions/LifiDiamondSwapPermissionCloneable.sol",
      },
      {
        key: "boundedApprove",
        address: "0x9c0b86daf9e75d759a5D165aD7366e52b3353fD8",
        kind: "LifiBoundedApprovePermissionCloneable",
        label: "LiFi Approve (per-token cap)",
        description:
          "Approve only the LiFi Diamond, only on tokens with a configured cap, up to " +
          "that cap. Per-token caps because token value/decimals differ (1 DAI = 1e18 vs " +
          "1 USDC = 1e6). Passes through non-approve calls (conjunctive model).",
        initParams: [
          { name: "tokens", type: "address[]", description: "Tokens the manager may approve to the LiFi Diamond." },
          { name: "caps", type: "uint256[]", description: "Per-token cap in base units; index-aligned with tokens." },
          { name: "permissionSigner", type: "address", description: "Owner wallet; sole authority for post-init updates." },
        ],
        sourceRef: "templates/lifi-permissions/LifiBoundedApprovePermissionCloneable.sol",
      },
    ],
  },
  42161: {
    chainId: 42161,
    blockNumber: 25136878,
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
    // PENDING post-Octane redeploy — do NOT activate until timelock allowlists are set
    // kernel 0x7542c3BCEd0014C14d79dA9A98Ec043F1ceC63E2 | mandateFactory 0x19BD2629790e602aF22840b37208e44e4F9B0aaE | governance 0xA3ee24e4fB7800c4f4c1481Bd920A4034Dfc34cf
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
