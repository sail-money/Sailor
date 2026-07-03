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

export const chains: Record<number, ChainConfig> = {
  // Ethereum mainnet
  1: {
    chainId: 1,
    name: "Ethereum",
    rpcEnvVar: "ETH_MAINNET_RPC_URL",
    defaultRpcUrl: "https://eth.llamarpc.com",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
  // Base mainnet
  8453: {
    chainId: 8453,
    name: "Base",
    rpcEnvVar: "BASE_RPC_URL",
    defaultRpcUrl: "https://mainnet.base.org",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
  // Arbitrum mainnet
  42161: {
    chainId: 42161,
    name: "Arbitrum",
    rpcEnvVar: "ARBITRUM_RPC_URL",
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
  // Optimism mainnet
  10: {
    chainId: 10,
    name: "Optimism",
    rpcEnvVar: "OPTIMISM_RPC_URL",
    defaultRpcUrl: "https://mainnet.optimism.io",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
  // Unichain mainnet
  130: {
    chainId: 130,
    name: "Unichain",
    rpcEnvVar: "UNICHAIN_RPC_URL",
    defaultRpcUrl: "https://mainnet.unichain.org",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
  // BSC mainnet
  56: {
    chainId: 56,
    name: "BSC",
    rpcEnvVar: "BSC_RPC_URL",
    defaultRpcUrl: "https://bsc-dataseed.binance.org",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
  // World Chain mainnet
  480: {
    chainId: 480,
    name: "World Chain",
    rpcEnvVar: "WORLD_RPC_URL",
    defaultRpcUrl: "https://worldchain-mainnet.g.alchemy.com/public",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
  // HyperEVM mainnet
  999: {
    chainId: 999,
    name: "HyperEVM",
    rpcEnvVar: "HYPEREVM_RPC_URL",
    defaultRpcUrl: "https://rpc.hyperliquid.xyz/evm",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
  // MegaETH mainnet
  4326: {
    chainId: 4326,
    name: "MegaETH",
    rpcEnvVar: "MEGAETH_RPC_URL",
    defaultRpcUrl: "https://mainnet.megaeth.com/rpc",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
  // Base Sepolia (testnet)
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    rpcEnvVar: "BASE_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia.base.org",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
  // Eth Sepolia (testnet)
  11155111: {
    chainId: 11155111,
    name: "Eth Sepolia",
    rpcEnvVar: "SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    kernel: CREATE2_KERNEL,
    mandateFactory: CREATE2_MANDATE_FACTORY,
    governance: CREATE2_GOVERNANCE,
    dispatchModel: "selective",
    protocols: {},
  },
};

/** Returns the ChainConfig for a given chainId, or throws if unsupported. */
export function getChain(chainId: number): ChainConfig {
  const config = chains[chainId];
  if (!config) {
    throw new Error(
      `Chain ${chainId} is not supported. Supported chains: 1 (Ethereum), 8453 (Base), 42161 (Arbitrum), 10 (Optimism), 130 (Unichain), 56 (BSC), 480 (World Chain), 999 (HyperEVM), 4326 (MegaETH), 84532 (Base Sepolia), 11155111 (Eth Sepolia).`,
    );
  }
  return config;
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
