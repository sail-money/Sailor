import type { ChainConfig } from "./types.js";

/**
 * Registry of live SailKernel deployments, keyed by EVM chainId.
 *
 * All entries run the Safe-governed CREATE2-deterministic deployment (gitCommit
 * 1dc1960, create2-2026-07-01) in which every core contract lands at the same
 * address on every chain. Add new chains here as SailKernel is deployed on
 * additional networks.
 */
const CREATE2_KERNEL = "0x38b508756c976e876EFF05a29E731A4d348BA6ED";
const CREATE2_MANDATE_FACTORY = "0x6d2C802ffa0d9A8Ed69A5Bf22c1b63ccB566B8Fc";
const CREATE2_GOVERNANCE = "0x4315B37cA4A315A7042af1Fcb37F8436f4D24356";

const ETH = { name: "Ether", symbol: "ETH", decimals: 18 } as const;
const BNB = { name: "BNB", symbol: "BNB", decimals: 18 } as const;
const HYPE = { name: "HYPE", symbol: "HYPE", decimals: 18 } as const;

export const chains: Record<number, ChainConfig> = {
  // Ethereum mainnet
  1: {
    chainId: 1,
    name: "Ethereum",
    slug: "ethereum",
    blockExplorer: { name: "Etherscan", url: "https://etherscan.io" },
    safePrefix: "eth",
    rpcEnvVar: "ETH_MAINNET_RPC_URL",
    defaultRpcUrl: "https://eth.llamarpc.com",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // Base mainnet
  8453: {
    chainId: 8453,
    name: "Base",
    slug: "base",
    blockExplorer: { name: "Basescan", url: "https://basescan.org" },
    safePrefix: "base",
    rpcEnvVar: "BASE_RPC_URL",
    defaultRpcUrl: "https://mainnet.base.org",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // Arbitrum mainnet
  42161: {
    chainId: 42161,
    name: "Arbitrum",
    slug: "arbitrum",
    displayName: "Arbitrum One",
    blockExplorer: { name: "Arbiscan", url: "https://arbiscan.io" },
    safePrefix: "arb1",
    rpcEnvVar: "ARBITRUM_RPC_URL",
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // Optimism mainnet
  10: {
    chainId: 10,
    name: "Optimism",
    slug: "optimism",
    blockExplorer: { name: "Optimistic Etherscan", url: "https://optimistic.etherscan.io" },
    safePrefix: "oeth",
    rpcEnvVar: "OPTIMISM_RPC_URL",
    defaultRpcUrl: "https://mainnet.optimism.io",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // Unichain mainnet
  130: {
    chainId: 130,
    name: "Unichain",
    slug: "unichain",
    blockExplorer: { name: "Uniscan", url: "https://uniscan.xyz" },
    safePrefix: "unichain",
    rpcEnvVar: "UNICHAIN_RPC_URL",
    defaultRpcUrl: "https://mainnet.unichain.org",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // BSC mainnet — native gas token is BNB, not ETH.
  56: {
    chainId: 56,
    name: "BSC",
    slug: "bsc",
    displayName: "BNB Smart Chain",
    blockExplorer: { name: "BscScan", url: "https://bscscan.com" },
    safePrefix: "bnb",
    rpcEnvVar: "BSC_RPC_URL",
    defaultRpcUrl: "https://bsc-dataseed.binance.org",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: BNB,
  },
  // World Chain mainnet
  480: {
    chainId: 480,
    name: "World Chain",
    slug: "world",
    blockExplorer: { name: "Worldscan", url: "https://worldscan.org" },
    rpcEnvVar: "WORLD_RPC_URL",
    defaultRpcUrl: "https://worldchain-mainnet.g.alchemy.com/public",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // HyperEVM mainnet — native gas token is HYPE, not ETH.
  999: {
    chainId: 999,
    name: "HyperEVM",
    slug: "hyperevm",
    blockExplorer: { name: "HyperEVM Scan", url: "https://hyperevmscan.io" },
    rpcEnvVar: "HYPEREVM_RPC_URL",
    defaultRpcUrl: "https://rpc.hyperliquid.xyz/evm",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: HYPE,
  },
  // MegaETH mainnet
  4326: {
    chainId: 4326,
    name: "MegaETH",
    slug: "megaeth",
    blockExplorer: { name: "MegaExplorer", url: "https://megaexplorer.xyz" },
    rpcEnvVar: "MEGAETH_RPC_URL",
    defaultRpcUrl: "https://mainnet.megaeth.com/rpc",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // Robinhood Chain mainnet
  4663: {
    chainId: 4663,
    name: "Robinhood",
    slug: "robinhood",
    blockExplorer: { name: "Robinhood Explorer", url: "https://robinhoodchain.blockscout.com" },
    rpcEnvVar: "ROBINHOOD_RPC_URL",
    defaultRpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // Base Sepolia (testnet)
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    slug: "base-sepolia",
    blockExplorer: { name: "Basescan Sepolia", url: "https://sepolia.basescan.org" },
    testnet: true,
    rpcEnvVar: "BASE_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia.base.org",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // Eth Sepolia (testnet)
  11155111: {
    chainId: 11155111,
    name: "Eth Sepolia",
    slug: "eth-sepolia",
    blockExplorer: { name: "Etherscan Sepolia", url: "https://sepolia.etherscan.io" },
    testnet: true,
    rpcEnvVar: "SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // Arbitrum Sepolia (testnet)
  421614: {
    chainId: 421614,
    name: "Arbitrum Sepolia",
    slug: "arbitrum-sepolia",
    blockExplorer: { name: "Arbiscan Sepolia", url: "https://sepolia.arbiscan.io" },
    testnet: true,
    rpcEnvVar: "ARBITRUM_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
  // Unichain Sepolia (testnet)
  1301: {
    chainId: 1301,
    name: "Unichain Sepolia",
    slug: "unichain-sepolia",
    blockExplorer: { name: "Uniscan Sepolia", url: "https://sepolia.uniscan.xyz" },
    testnet: true,
    rpcEnvVar: "UNICHAIN_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia.unichain.org",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
    nativeCurrency: ETH,
  },
};

/** Returns the ChainConfig for a given chainId, or throws if unsupported. */
export function getChain(chainId: number): ChainConfig {
  const config = chains[chainId];
  if (!config) {
    throw new Error(
      `Chain ${chainId} is not supported. Supported chains: 1 (Ethereum), 8453 (Base), 42161 (Arbitrum), 10 (Optimism), 130 (Unichain), 56 (BSC), 480 (World Chain), 999 (HyperEVM), 4326 (MegaETH), 4663 (Robinhood), 84532 (Base Sepolia), 11155111 (Eth Sepolia).`,
    );
  }
  return config;
}

/** Returns the ChainConfig for a canonical slug (e.g. "base", "bsc"), or undefined. */
export function chainBySlug(slug: string): ChainConfig | undefined {
  const key = slug.trim().toLowerCase();
  return Object.values(chains).find((c) => c.slug === key);
}

/**
 * Public default RPC URLs keyed by chainId — the canonical fallback map derived
 * from the chain registry. Consumers (CLI, UI, dashboard server) should import
 * this instead of hand-maintaining their own copies. Returns a plain
 * `Record<number, string>` for easy spreading/merging with env-provided URLs.
 */
export const defaultRpcUrls: Record<number, string> = Object.fromEntries(
  Object.values(chains).map((c) => [c.chainId, c.defaultRpcUrl]),
);

/** The public default RPC URL for a chainId, or undefined if unsupported. */
export function getDefaultRpcUrl(chainId: number): string | undefined {
  return chains[chainId]?.defaultRpcUrl;
}

/**
 * The native gas token symbol for a chain (e.g. "ETH", "BNB", "HYPE") — what
 * `permissionRegistrationFee` is denominated in on that chain. Falls back to
 * "ETH" for an unrecognized chainId so display code degrades gracefully
 * instead of throwing.
 */
export function getNativeCurrencySymbol(chainId: number): string {
  return chains[chainId]?.nativeCurrency.symbol ?? "ETH";
}
