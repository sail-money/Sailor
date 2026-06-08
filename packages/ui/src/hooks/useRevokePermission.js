'use client'

import { useCallback } from 'react'
import { createPublicClient, http, isAddress } from 'viem'
import { useSwitchChain } from 'wagmi'
import { chains } from '../wagmi'
import { buildRevoke, buildRevokeTx, revokeComplete } from '../data/sailorClient'
import { useMockSigner } from './useMockSigner'
import { useOwnerWallet } from './useOwnerWallet'

/**
 * A read client PINNED to a specific chain — see the same note in useRotateSigner:
 * wagmi's usePublicClient() can lag the connected chain after a switch, so we
 * build the client from the chain definition to guarantee receipts poll the
 * chain the tx was broadcast on.
 */
function readsFor(chainId) {
  const chain = chains.find((c) => c.id === chainId)
  if (!chain) throw new Error(`Unsupported chain ${chainId} — not in the wallet config.`)
  return createPublicClient({ chain, transport: http() })
}

const RECEIPT_OPTS = { timeout: 180_000, pollingInterval: 2_000 }

/**
 * Revoke seam — LIVE (wagmi). Removes one or more permissions (mandates) from
 * the SMA via the OWNER's connected wallet, mirroring the rotation re-attach
 * path: the server builds the EIP-712 RevokePermissions typed-data + the
 * kernel.revokePermissions calldata, and the owner signs + submits both. Because
 * the OWNER (the on-chain permission signer) submits — not the unfunded agent
 * wallet — there is no gas-funding gotcha to resume around, and the same wallet
 * that authorizes the removal is the one that pays for it.
 *
 * `revoke(opts)` resolves to a result describing what happened; progress is
 * surfaced via the optional `onStatus(status)` callback:
 *   'building' → 'sign' → 'build-tx' → 'wallet' → 'confirming' → 'persisting' → 'done'
 */
export function useRevokePermission() {
  const { sendTransactionAsync, signTypedDataAsync } = useMockSigner()
  const { switchChainAsync } = useSwitchChain()
  const { address: owner } = useOwnerWallet()

  /**
   * @param {{
   *   chainId: number,
   *   permission?: string,          // single permission address to revoke
   *   permissions?: string[],       // or several at once
   *   onStatus?: (s: string) => void,
   * }} opts
   */
  const revoke = useCallback(
    async ({ chainId, permission, permissions, onStatus } = {}) => {
      const status = (s) => onStatus?.(s)
      if (!owner) throw new Error('Connect your wallet to revoke.')
      if (!chainId) throw new Error('No chain for this SMA.')
      const targets = (permissions ?? (permission ? [permission] : [])).filter(Boolean)
      if (targets.length === 0 || !targets.every((p) => isAddress(p))) {
        throw new Error('No valid permission to revoke.')
      }

      // 1. Build the EIP-712 typed data the owner signs (reads the signer nonce
      //    + asserts the targets are in the live permission set server-side).
      status('building')
      const { typedData, deadline } = await buildRevoke({ permissions: targets })

      // 2. Ensure the wallet is on the SMA's chain, then sign the authorization.
      try { await switchChainAsync({ chainId }) } catch { /* may already be on chain */ }
      const reads = readsFor(chainId)

      status('sign')
      const signature = await signTypedDataAsync(typedData)

      // 3. Build + submit kernel.revokePermissions (owner pays gas).
      status('build-tx')
      const tx = await buildRevokeTx({ permissions: targets, deadline, signature })

      status('wallet')
      const txHash = await sendTransactionAsync({ to: tx.to, data: tx.data, chainId })
      status('confirming')
      const receipt = await reads.waitForTransactionReceipt({ hash: txHash, ...RECEIPT_OPTS })
      if (receipt?.status === 'reverted') {
        throw new Error('Revoke transaction reverted — the mandate is still active.')
      }

      // 4. Record it locally (activity log + cache bust) so the ledger flips.
      status('persisting')
      await revokeComplete({ permissions: targets, txHash })

      status('done')
      return { chainId, permissions: targets, txHash }
    },
    [owner, switchChainAsync, sendTransactionAsync, signTypedDataAsync],
  )

  return { revoke }
}
