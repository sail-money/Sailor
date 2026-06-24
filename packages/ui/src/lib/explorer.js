import { chains } from '../wagmi'

/**
 * Chain-aware block-explorer URLs (F5).
 *
 * Previously each page hard-coded an explorer map keyed by a network *name*
 * slug, with a fallback to Etherscan. Testnet slugs (e.g. the server emits
 * "base sepolia" for chain 84532) were absent from those maps, so they fell
 * through to etherscan.io and every Base Sepolia tx link 404'd ("trx not
 * found"). This module is the single source of truth, keyed by chainId and
 * sourced from the authoritative viem chain registry (`src/wagmi.js`), so it
 * stays in sync with the configured chains and covers every testnet.
 *
 * Helpers accept EITHER a numeric chainId OR a network name/slug, so existing
 * name-based call sites keep working while new code can pass chainId directly.
 */

// chainId -> { name, url } from the configured viem chains (includes testnets).
const EXPLORER_BY_ID = Object.fromEntries(
  chains
    .filter((c) => c?.blockExplorers?.default?.url)
    .map((c) => [
      c.id,
      { name: c.blockExplorers.default.name, url: c.blockExplorers.default.url.replace(/\/$/, '') },
    ]),
)

// Supplement chains that aren't in the wagmi config but may appear in legacy
// data (vestigial CHAIN_NAMES entries). Does not override viem-sourced entries.
const EXPLORER_SUPPLEMENT = {
  10: { name: 'Optimistic Etherscan', url: 'https://optimistic.etherscan.io' },
  137: { name: 'Polygonscan', url: 'https://polygonscan.com' },
}

// Network name/slug (as produced by the server's CHAIN_NAMES) -> chainId.
// Normalised: lower-cased, separators collapsed to single spaces.
const NAME_TO_ID = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  'arbitrum one': 42161,
  unichain: 130,
  optimism: 10,
  polygon: 137,
  'base sepolia': 84532,
  'eth sepolia': 11155111,
  'ethereum sepolia': 11155111,
  'arbitrum sepolia': 421614,
  'unichain sepolia': 1301,
}

function resolveChainId(chainOrNetwork) {
  if (typeof chainOrNetwork === 'number') return chainOrNetwork
  if (typeof chainOrNetwork === 'string') {
    const key = chainOrNetwork.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
    return NAME_TO_ID[key] ?? null
  }
  return null
}

/** Returns `{ name, url }` for a chainId or network name, or null if unknown. */
export function explorer(chainOrNetwork) {
  const id = resolveChainId(chainOrNetwork)
  if (id == null) return null
  return EXPLORER_BY_ID[id] ?? EXPLORER_SUPPLEMENT[id] ?? null
}

/** Block-explorer URL for a transaction hash, or null if the chain is unknown. */
export function explorerTxUrl(chainOrNetwork, hash) {
  const e = explorer(chainOrNetwork)
  return e ? `${e.url}/tx/${hash}` : null
}

/** Block-explorer URL for an address, or null if the chain is unknown. */
export function explorerAddressUrl(chainOrNetwork, address) {
  const e = explorer(chainOrNetwork)
  return e ? `${e.url}/address/${address}` : null
}

/** Block-explorer URL for a verified contract's code tab. */
export function explorerCodeUrl(chainOrNetwork, address) {
  const url = explorerAddressUrl(chainOrNetwork, address)
  return url ? `${url}#code` : null
}
