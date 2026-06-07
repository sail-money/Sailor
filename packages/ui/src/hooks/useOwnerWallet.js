'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Owner wallet — mock seam mirroring the wagmi surface the live build uses.
 *
 * The Owner IS the connected wallet (custody anchor + signer of every on-chain
 * action). Today this is a mock with a shared in-module store so connect /
 * disconnect reflect everywhere at once.
 *
 * LIVE swap: replace this hook's body with wagmi —
 *   const { address, isConnected, chainId } = useAccount()
 *   const { disconnect } = useDisconnect()
 *   const { openConnectModal } = useConnectModal()   // RainbowKit
 * Keep the SAME return shape ({ address, isConnected, chainId, connect,
 * disconnect }) so no caller changes. Wrap the app in WagmiProvider +
 * RainbowKitProvider (see HANDOFF.md) and configure chains/projectId to match
 * Sailor/packages/ui/src/wagmi.js.
 */

const MOCK_OWNER = '0x6f2A8b3f9C4d5E1A7B0c2D3E4F5A6B7C8D9E0F12'

// Module-level store so state survives component remounts in the mockup.
const store = { connected: true, address: MOCK_OWNER, chainId: 42161 }
const subscribers = new Set()
function notify() { for (const cb of subscribers) cb() }

export function useOwnerWallet() {
  const [, force] = useState(0)
  useEffect(() => {
    const cb = () => force((n) => n + 1)
    subscribers.add(cb)
    return () => subscribers.delete(cb)
  }, [])

  const connect = useCallback(() => {
    // LIVE: openConnectModal() — RainbowKit handles wallet selection.
    store.connected = true
    notify()
  }, [])

  const disconnect = useCallback(() => {
    store.connected = false
    notify()
  }, [])

  return {
    address: store.connected ? store.address : null,
    isConnected: store.connected,
    chainId: store.chainId,
    connect,
    disconnect,
  }
}
