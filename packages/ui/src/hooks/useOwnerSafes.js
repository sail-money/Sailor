import { useEffect, useState } from 'react'
import { useOwnerWallet } from './useOwnerWallet'
import { getAccounts } from '../data/sailorClient'

/**
 * Owner-safes seam — the set of SMAs (Safes) owned by the connected wallet.
 *
 * One owner EOA can own multiple SMAs; the protocol binds each SMA to a single
 * chain. This is the wallet-side companion to `useOwnerWallet`: the wallet
 * gives identity, this gives the accounts that identity controls.
 *
 * LIVE: resolves from `getAccounts()` (GET /api/accounts), gated on connection.
 * Each account is mapped into the shape consumers expect
 * ({ id, name, address, network, networks, chainId }). Consumer today is
 * ContractModal.jsx. Return shape: { safes, primary, isConnected }.
 */
const CHAIN_NAMES = {
  8453: 'base',
  42161: 'arbitrum',
  84532: 'base sepolia',
  130: 'unichain',
}

function chainNameFor(id) {
  return CHAIN_NAMES[id] ?? ''
}

export function useOwnerSafes() {
  const { isConnected } = useOwnerWallet()
  const [safes, setSafes] = useState([])

  useEffect(() => {
    if (!isConnected) {
      setSafes([])
      return
    }
    let alive = true
    getAccounts()
      .then((accounts) => {
        if (!alive) return
        setSafes(
          (accounts ?? []).map((a) => ({
            id: a.safe,
            name: a.name || 'My SMA',
            address: a.safe,
            network: chainNameFor(a.chainId),
            networks: [chainNameFor(a.chainId)],
            chainId: a.chainId,
          })),
        )
      })
      .catch(() => { if (alive) setSafes([]) })
    return () => { alive = false }
  }, [isConnected])

  return {
    safes,
    primary: safes[0] ?? null,
    isConnected,
  }
}
