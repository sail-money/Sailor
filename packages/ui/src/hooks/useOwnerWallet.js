import { useCallback } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'

/**
 * Owner wallet — LIVE (wagmi + RainbowKit).
 *
 * The Owner IS the connected wallet: the custody anchor and the only key that
 * can authorize anything. This hook is the wallet seam — every surface that
 * needs the owner address or connection state reads it here.
 *
 * Providers (WagmiProvider + RainbowKitProvider) are mounted in src/main.jsx.
 */
export function useOwnerWallet() {
  const { address, isConnected, chainId, connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()

  // Best-effort "switch account". No dApp API can force Phantom to re-open its
  // account chooser (it ignores wallet_requestPermissions). The most aggressive
  // thing we can do is REVOKE the site's eth_accounts permission, then
  // disconnect and re-open connect — on wallets that honor wallet_revokePermissions
  // (MetaMask/Rabby) this forces a fresh account selection. Phantom may ignore
  // the revoke; for Phantom the reliable lever is switching the active account
  // INSIDE the extension, which wagmi follows automatically via accountsChanged.
  const switchAccount = useCallback(async () => {
    try {
      const provider = await connector?.getProvider?.()
      await provider?.request?.({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      })
    } catch {
      // wallet doesn't support revoke (e.g. Phantom) — fall through
    }
    disconnect()
    // Reopen the connect modal so the user can re-select (fresh, if revoke took).
    setTimeout(() => openConnectModal?.(), 350)
  }, [connector, disconnect, openConnectModal])

  return {
    address: address ?? null,
    isConnected,
    chainId: chainId ?? null,
    connect: () => openConnectModal?.(),
    disconnect,
    switchAccount,
  }
}
