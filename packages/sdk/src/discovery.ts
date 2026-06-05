import type { Address } from "viem";

/**
 * Safe Transaction Service endpoints per chain. Safe consolidated the old
 * per-chain hosts into one unified API at api.safe.global/tx-service/<slug>.
 * No API key is required for these reads.
 */
const SAFE_TX_SERVICE_SLUGS: Record<number, string> = {
  1: "eth",
  100: "gno",
  137: "pol",
  42161: "arb1",
  8453: "base",
  84532: "basesep",
  130: "unichain",
};

function safeTxServiceBase(chainId: number): string | undefined {
  const slug = SAFE_TX_SERVICE_SLUGS[chainId];
  return slug ? `https://api.safe.global/tx-service/${slug}` : undefined;
}

/**
 * Discover all Safe (SMA) addresses owned by a given EOA or contract on a
 * specific chain, via the official Gnosis Safe Transaction Service. This is the
 * recommended way to find all SMAs associated with a connected owner wallet.
 */
export async function discoverSafesForOwner(owner: Address, chainId: number): Promise<Address[]> {
  const baseUrl = safeTxServiceBase(chainId);
  if (!baseUrl) {
    throw new Error(`No Safe Transaction Service configured for chain ${chainId}`);
  }

  const url = `${baseUrl}/api/v1/owners/${owner}/safes/`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });

  if (!res.ok) {
    throw new Error(`Failed to fetch Safes for owner ${owner} on chain ${chainId}: ${res.status}`);
  }

  const data = (await res.json()) as { safes: string[] };
  return (data.safes ?? []) as Address[];
}

/** Returns the base URL for the Safe Transaction Service on a chain (if known). */
export function getSafeTransactionServiceUrl(chainId: number): string | undefined {
  return safeTxServiceBase(chainId);
}
