import type { Chain } from "viem";
import { arbitrum, base, baseSepolia } from "viem/chains";
import { parseEnvFile, sailPath } from "./io.js";

const CHAINS: Record<number, Chain> = {
  8453: base,
  84532: baseSepolia,
  42161: arbitrum,
};

/** Resolve a viem Chain for a supported Sail chain id. */
export function getChainById(chainId: number): Chain {
  const chain = CHAINS[chainId];
  if (!chain) {
    throw new Error(
      `Unsupported chainId: ${chainId}. Supported: 8453 (Base), 84532 (Base Sepolia), 42161 (Arbitrum)`,
    );
  }
  return chain;
}

const RPC_ENV_VARS: Record<number, string> = {
  8453: "BASE_RPC_URL",
  84532: "BASE_SEPOLIA_RPC_URL",
  42161: "ARBITRUM_RPC_URL",
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
