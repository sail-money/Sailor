import type { Chain } from "viem";
import { arbitrum, base, baseSepolia, mainnet, sepolia, unichain } from "viem/chains";
import { parseEnvFile, sailPath } from "./io.js";

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  130: unichain,
  84532: baseSepolia,
  11155111: sepolia,
};

/** Resolve a viem Chain for a supported Sail chain id. */
export function getChainById(chainId: number): Chain {
  const chain = CHAINS[chainId];
  if (!chain) {
    throw new Error(
      `Unsupported chainId: ${chainId}. Supported: 1 (Ethereum), 8453 (Base), 42161 (Arbitrum), 130 (Unichain), 84532 (Base Sepolia), 11155111 (Eth Sepolia)`,
    );
  }
  return chain;
}

const RPC_ENV_VARS: Record<number, string> = {
  1: "ETH_MAINNET_RPC_URL",
  8453: "BASE_RPC_URL",
  42161: "ARBITRUM_RPC_URL",
  130: "UNICHAIN_RPC_URL",
  84532: "BASE_SEPOLIA_RPC_URL",
  11155111: "SEPOLIA_RPC_URL",
};

/**
 * Resolve an RPC URL for a chain. Prefers the project's `.sail/.env.local`
 * `RPC_URL`, then a per-chain env var, then `process.env.RPC_URL`. Returns
 * undefined when unset so callers fall back to viem's default public RPC. Using
 * a dedicated endpoint avoids the read-after-write lag public replicas exhibit.
 */
export function getRpcUrl(chainId: number): string | undefined {
  const env = parseEnvFile(sailPath(".env.local"));
  const fromProject = env.RPC_URL;
  if (fromProject?.trim()) return fromProject.trim();

  const perChain = RPC_ENV_VARS[chainId];
  const fromPerChain = perChain ? process.env[perChain] : undefined;
  if (fromPerChain?.trim()) return fromPerChain.trim();

  const fromEnv = process.env.RPC_URL;
  return fromEnv?.trim() ? fromEnv.trim() : undefined;
}
