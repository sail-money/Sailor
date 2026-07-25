/* UI chain helpers — the single place the dashboard reads chain metadata from.
 *
 * Objective facts come from the SDK registry (@sail/sdk/chains); presentation
 * (color, description, RPC provider hosts) from ./chainPresentation. Consumers
 * import from here rather than hand-maintaining their own per-chain tables. */
import { chains, getChain, chainBySlug } from '@sail/sdk/chains'
import { CHAIN_PRESENTATION as P } from './chainPresentation'

// Testnet → its mainnet sibling, so a testnet reuses the mainnet's brand color
// and icon. (The SDK doesn't model this pairing; it's a UI rendering concern.)
const TESTNET_TO_MAINNET = {
  11155111: 1, 84532: 8453, 421614: 42161, 1301: 130,
  11155420: 10, 97: 56, 4801: 480, 998: 999,
}
export const canonicalChainId = (id) => TESTNET_TO_MAINNET[Number(id)] ?? Number(id)

// ── Presentation (UI-only) ──────────────────────────────────────────────────
export const chainColor       = (id) => P[canonicalChainId(id)]?.color ?? 'rgba(255,255,255,0.5)'
export const chainDescription = (id) => P[Number(id)]?.description ?? ''
export const alchemyHost      = (id) => P[Number(id)]?.alchemyHost
export const infuraHost       = (id) => P[Number(id)]?.infuraHost

// ── Objective facts (SDK) ───────────────────────────────────────────────────
export const chainDisplayName = (id) => { const c = chains[Number(id)]; return c ? (c.displayName ?? c.name) : `Chain ${id}` }
export const chainSlug        = (id) => chains[Number(id)]?.slug
export const chainSafePrefix  = (id) => chains[Number(id)]?.safePrefix ?? 'eth'
export const isTestnet        = (id) => Boolean(chains[Number(id)]?.testnet)
export const slugToChainId    = (slug) => chainBySlug(String(slug))?.chainId

/** All non-testnet chains, in registry order. */
export const mainnetChains = () => Object.values(chains).filter((c) => !c.testnet)

export { chains, getChain, chainBySlug }
