import { getNativeCurrencySymbol, chains as sdkChains } from '@sail/sdk/chains'
import { chains as viemChains } from '../wagmi'

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

// chainId -> { name, url }. The SDK registry is authoritative for Sail chains;
// viem supplies explorers for well-known testnets not in the SDK (e.g. Arbitrum
// / Unichain Sepolia). viem entries are applied first, then SDK overrides them.
const EXPLORER_BY_ID = {}
for (const c of viemChains) {
  const d = c?.blockExplorers?.default
  if (d?.url) EXPLORER_BY_ID[c.id] = { name: d.name, url: d.url.replace(/\/$/, '') }
}
for (const c of Object.values(sdkChains)) {
  if (c.blockExplorer?.url) {
    EXPLORER_BY_ID[c.chainId] = { name: c.blockExplorer.name, url: c.blockExplorer.url.replace(/\/$/, '') }
  }
}

// Network name/slug -> chainId, derived entirely from the SDK registry. Every
// label a chain is known by — slug, name, and displayName — is indexed, using
// the same normalisation resolveChainId applies to its input, so callers can
// pass any of them (e.g. 'base', 'arbitrum one', 'unichain sepolia').
const normalize = (s) => s.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
const NAME_TO_ID = {}
for (const c of Object.values(sdkChains)) {
  for (const label of [c.slug, c.name, c.displayName]) {
    if (label) NAME_TO_ID[normalize(label)] = c.chainId
  }
}

function resolveChainId(chainOrNetwork) {
  if (typeof chainOrNetwork === 'number') return chainOrNetwork
  if (typeof chainOrNetwork === 'string') {
    return NAME_TO_ID[normalize(chainOrNetwork)] ?? null
  }
  return null
}

/**
 * Native gas-token symbol for a chainId or network name. Defaults to "ETH".
 * Delegates to the SDK chain registry (`@sail/sdk/chains`) so it is the single
 * source of truth — a new non-ETH chain added there is reflected here with no
 * second table to keep in sync. `@sail/sdk/chains` is already in the browser
 * bundle (via `src/wagmi.js`), so this adds no new dependency.
 */
export function nativeCurrencySymbol(chainOrNetwork) {
  const id = resolveChainId(chainOrNetwork)
  if (id == null) return 'ETH'
  return getNativeCurrencySymbol(id)
}

/** Returns `{ name, url }` for a chainId or network name, or null if unknown. */
export function explorer(chainOrNetwork) {
  const id = resolveChainId(chainOrNetwork)
  if (id == null) return null
  return EXPLORER_BY_ID[id] ?? null
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
