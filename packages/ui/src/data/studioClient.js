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

import {
  explorerUrl as _explorerUrl,
  txExplorerUrl as _txExplorerUrl,
  safeAppUrl as _safeAppUrl,
  debankUrl as _debankUrl,
} from './mockState'

/** Owner EOA profile. There is no mock owner — the live connected wallet
 *  (useOwnerWallet) is the source of truth for the address. Returns null so
 *  Dashboard uses `wallet.address ?? ownerProfile?.address`. */
export async function getOwnerProfile() {
  return null
}

/* ── Explorer URL helpers ──
   Pure presentational helpers (no endpoint, no wallet state). Re-exported as
   plain functions so pages never import the raw fixtures for them. */
export const explorerUrl = _explorerUrl
export const txExplorerUrl = _txExplorerUrl
export const safeAppUrl = _safeAppUrl
export const debankUrl = _debankUrl
