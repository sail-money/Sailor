/**
 * Studio data seam — the boundary for the dashboard's presentational helpers
 * that have NO matching `/api` endpoint in the Sailor framework.
 *
 * The only consumer left is Dashboard.jsx, which imports four explorer-URL
 * helpers plus `getOwnerProfile`. Everything else (rich mandates, journal,
 * agents, governance, manager endpoint, bookkeeping) belonged to the now-deleted
 * Agent/Mandate/Journal pages and has been removed.
 *
 * The owner is the LIVE connected wallet (useOwnerWallet), so there is no mock
 * owner profile — `getOwnerProfile` returns null and Dashboard falls back to the
 * wallet address.
 */

/** Owner EOA profile. The live connected wallet (useOwnerWallet) is the
 *  source of truth. Returns null so Dashboard falls back to wallet.address. */
export async function getOwnerProfile() {
  return null
}

export function explorerUrl(chain, address) {
  const map = {
    42161: `https://arbiscan.io/address/${address}`,
    1: `https://etherscan.io/address/${address}`,
    8453: `https://basescan.org/address/${address}`,
    10: `https://optimistic.etherscan.io/address/${address}`,
  }
  return map[chain.id] ?? map[1]
}

export function txExplorerUrl(chain, hash) {
  const base = {
    42161: 'https://arbiscan.io/tx/',
    1: 'https://etherscan.io/tx/',
    8453: 'https://basescan.org/tx/',
    10: 'https://optimistic.etherscan.io/tx/',
  }
  return (base[chain.id] ?? base[1]) + hash
}

export function safeAppUrl(chain, address) {
  const prefix = { 42161: 'arb1', 1: 'eth', 8453: 'base', 10: 'oeth' }[chain.id] ?? 'eth'
  return `https://app.safe.global/home?safe=${prefix}:${address}`
}

export function debankUrl(address) {
  return `https://debank.com/profile/${address}`
}
