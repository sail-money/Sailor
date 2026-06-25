import { useEffect } from 'react'
import { useDisconnect } from 'wagmi'

/**
 * Keeps the dashboard's wallet state in sync with the injected provider (F3).
 *
 * wagmi persists the last connection and auto-reconnects on mount. When the user
 * disconnects Sailor from inside MetaMask (rather than via the in-app button) the
 * provider fires `accountsChanged` with an empty array — or a bare `disconnect`.
 * Without handling those, the UI keeps showing "connected" and a refresh
 * re-hydrates the stale session (the genesis tester had to clear site data to
 * recover). Calling wagmi's `disconnect()` updates the UI immediately AND clears
 * wagmi's persisted storage, so a subsequent refresh stays disconnected.
 *
 * Account *switches* (a non-empty `accountsChanged`) need no handling here —
 * wagmi's `useAccount` already re-renders consumers with the new address.
 */
export function useWalletLifecycle() {
  const { disconnect } = useDisconnect()

  useEffect(() => {
    const provider = typeof window !== 'undefined' ? window.ethereum : undefined
    if (!provider?.on) return

    const onAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) disconnect()
    }
    const onDisconnect = () => disconnect()

    provider.on('accountsChanged', onAccountsChanged)
    provider.on('disconnect', onDisconnect)
    return () => {
      provider.removeListener?.('accountsChanged', onAccountsChanged)
      provider.removeListener?.('disconnect', onDisconnect)
    }
  }, [disconnect])
}
