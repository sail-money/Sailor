import { defineChain, type Chain } from "viem";
import { arbitrum, base, baseSepolia, bsc, mainnet, optimism, sepolia, unichain, worldchain } from "viem/chains";
import { chains } from "@sail/sdk";
import { parseEnvFile, sailPath } from "./io.js";

// Not (yet) published in viem/chains — defined here from the Sail Protocol deployment
// data. RPC URLs come from the SDK chain registry (single source of truth).
const hyperevm = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [chains[999].defaultRpcUrl] } },
});
const megaeth = defineChain({
  id: 4326,
  name: "MegaETH",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [chains[4326].defaultRpcUrl] } },
});
const robinhood = defineChain({
  id: 4663,
  name: "Robinhood",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [chains[4663].defaultRpcUrl] } },
});

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  130: unichain,
  56: bsc,
  480: worldchain,
  999: hyperevm,
  4326: megaeth,
  4663: robinhood,
  84532: baseSepolia,
  11155111: sepolia,
};

/** Resolve a viem Chain for a supported Sail chain id. */
export function getChainById(chainId: number): Chain {
  const chain = CHAINS[chainId];
  if (!chain) {
    throw new Error(
      `Unsupported chainId: ${chainId}. Supported: 1 (Ethereum), 8453 (Base), 42161 (Arbitrum), 10 (Optimism), 130 (Unichain), 56 (BSC), 480 (World Chain), 999 (HyperEVM), 4326 (MegaETH), 4663 (Robinhood), 84532 (Base Sepolia), 11155111 (Eth Sepolia)`,
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

  // 1. .env.local named chain var (e.g. BASE_RPC_URL)
  const fromProjectChain = perChainVar ? env[perChainVar] : undefined;
  if (fromProjectChain?.trim()) return fromProjectChain.trim();

  // 2. .env.local chainId-keyed var (e.g. RPC_URL_8453) — written by the UI's save-config
  const fromProjectChainId = env[`RPC_URL_${chainId}`];
  if (fromProjectChainId?.trim()) return fromProjectChainId.trim();

  // 3. .env.local generic fallback
  if (env.RPC_URL?.trim()) return env.RPC_URL.trim();

  // 4. Shell named chain var
  const fromEnvChain = perChainVar ? process.env[perChainVar] : undefined;
  if (fromEnvChain?.trim()) return fromEnvChain.trim();

  // 5. Shell generic
  return process.env.RPC_URL?.trim() || undefined;
}
