import { sailDeployments, type SailChainId } from "./deployments.js";
import type { ChainConfig } from "./types.js";

/** Per-chain metadata not stored in the deployment registry. */
const CHAIN_META: Record<SailChainId, { name: string; rpcEnvVar: string }> = {
  1: { name: "Ethereum", rpcEnvVar: "ETH_MAINNET_RPC_URL" },
  8453: { name: "Base", rpcEnvVar: "BASE_RPC_URL" },
  42161: { name: "Arbitrum", rpcEnvVar: "ARBITRUM_RPC_URL" },
  130: { name: "Unichain", rpcEnvVar: "UNICHAIN_RPC_URL" },
  84532: { name: "Base Sepolia", rpcEnvVar: "BASE_SEPOLIA_RPC_URL" },
  11155111: { name: "Eth Sepolia", rpcEnvVar: "SEPOLIA_RPC_URL" },
};

/**
 * Registry of live SailKernel deployments, keyed by EVM chainId.
 *
 * Core contract addresses are sourced from `sailDeployments` (canonical).
 * Add new chains here as SailKernel is deployed on additional networks.
 */
export const chains: Record<number, ChainConfig> = Object.fromEntries(
  (Object.keys(sailDeployments) as unknown as SailChainId[]).map((chainId) => {
    const deployment = sailDeployments[chainId];
    const meta = CHAIN_META[chainId];
    return [
      chainId,
      {
        chainId,
        name: meta.name,
        rpcEnvVar: meta.rpcEnvVar,
        kernel: deployment.kernel,
        mandateFactory: deployment.mandateFactory,
        governance: deployment.governance,
        dispatchModel: deployment.dispatchModel ?? "selective",
        protocols: {},
      } satisfies ChainConfig,
    ];
  }),
) as Record<number, ChainConfig>;

/** Returns the ChainConfig for a given chainId, or throws if unsupported. */
export function getChain(chainId: number): ChainConfig {
  const config = chains[chainId];
  if (!config) {
    throw new Error(
      `Chain ${chainId} is not supported. Supported chains: 1 (Ethereum), 8453 (Base), 42161 (Arbitrum), 130 (Unichain), 84532 (Base Sepolia), 11155111 (Eth Sepolia).`,
    );
  }
  return config;
}