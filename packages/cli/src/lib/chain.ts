import type { Chain } from "viem";
import { arbitrum, base, baseSepolia, mainnet, sepolia, unichain } from "viem/chains";
import { chains } from "@sail/sdk";
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


/**
 * Resolve an RPC URL for a given chain. Resolution order (first match wins):
 *
 *  1. `.sail/.env.local` — chain-specific var (e.g. BASE_RPC_URL, ARBITRUM_RPC_URL)
 *  2. `.sail/.env.local` — generic RPC_URL (fallback for the active chain)
 *  3. Shell environment  — chain-specific var
 *  4. Shell environment  — generic RPC_URL
 *
 * This means a project can either set one `RPC_URL` for the active chain, or
 * set individual per-chain vars (BASE_RPC_URL, ARBITRUM_RPC_URL, …) and omit
 * `RPC_URL` entirely. Both patterns work; per-chain vars always take precedence
 * for their specific chain so multi-chain projects resolve each endpoint correctly.
 *
 * Returns undefined when no URL is configured so callers can fall back to
 * viem's default public RPC. A dedicated endpoint avoids the read-after-write
 * lag that rate-limited public replicas exhibit.
 */
export function getRpcUrl(chainId: number): string | undefined {
  const env = parseEnvFile(sailPath(".env.local"));
  const perChainVar = chains[chainId]?.rpcEnvVar;

  // 1. .env.local chain-specific
  const fromProjectChain = perChainVar ? env[perChainVar] : undefined;
  if (fromProjectChain?.trim()) return fromProjectChain.trim();

  // 2. .env.local generic
  if (env.RPC_URL?.trim()) return env.RPC_URL.trim();

  // 3. Shell chain-specific
  const fromEnvChain = perChainVar ? process.env[perChainVar] : undefined;
  if (fromEnvChain?.trim()) return fromEnvChain.trim();

  // 4. Shell generic
  return process.env.RPC_URL?.trim() || undefined;
}
