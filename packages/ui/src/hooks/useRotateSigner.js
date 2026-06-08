'use client'

import { useCallback } from 'react'
import { createPublicClient, http, isAddress } from 'viem'
import { useSwitchChain } from 'wagmi'
import { chains } from '../wagmi'
import {
  buildReattach,
  buildReattachTx,
  buildSetManager,
  rotateComplete,
  rotateGenerateKey,
} from '../data/sailorClient'
import { useMockSigner } from './useMockSigner'
import { useOwnerWallet } from './useOwnerWallet'

/**
 * A read client PINNED to a specific chain — see the same note in useDeploySma.
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
 * Rotate seam — LIVE (wagmi). Rotates the SMA's delegated signer (the agent
 * wallet / manager) via the OWNER's connected wallet, mirroring useDeploySma:
 * the server builds calldata + typed-data, the owner signs + submits.
 *
 * The kernel's setManager is gated by msg.sender == account, so it is wrapped in
 * a Safe.execTransaction the owner submits (1-of-1 Safe → pre-validated
 * signature). setManager CLEARS every attached mandate on-chain (fail-closed);
 * the cleared mandates are then re-approved (owner signs the batch, owner
 * submits) so they re-bind to the new signer. Because the OWNER — not the fresh,
 * unfunded agent wallet — submits the re-approval, there is no gas-funding
 * gotcha to resume around.
 *
 * `rotate(opts)` resolves to a result describing what happened; progress is
 * surfaced via the optional `onStatus(status)` callback:
 *   'building' → 'rotate-wallet' → 'rotate-confirming'
 *     → 'reattach-sign' → 'reattach-wallet' → 'reattach-confirming'
 *     → 'persisting' → 'done'
 */
export function useRotateSigner() {
  const { sendTransactionAsync, signTypedDataAsync } = useMockSigner()
  const { switchChainAsync } = useSwitchChain()
  const { address: owner } = useOwnerWallet()

  /**
   * @param {{
   *   chainId: number,
   *   generate?: boolean,           // generate a fresh agent keystore (default)
   *   newSigner?: string,           // rotate to this existing address instead
   *   passphrase?: string,          // encrypts the generated keystore
   *   reattach?: boolean,           // re-approve cleared mandates (default true)
   *   onStatus?: (s: string) => void,
   * }} opts
   */
  const rotate = useCallback(
    async ({ chainId, generate = true, newSigner, passphrase = '', reattach = true, onStatus } = {}) => {
      const status = (s) => onStatus?.(s)
      if (!owner) throw new Error('Connect your wallet to rotate the signer.')
      if (!chainId) throw new Error('No chain for this SMA.')

      // 1. Resolve the new signer — generate a fresh local keystore, or use the
      //    address the user supplied. Generation backs up + overwrites the old
      //    keystore server-side, returning the new address.
      status('building')
      let newManager
      if (generate) {
        const { address } = await rotateGenerateKey({ passphrase })
        if (!address) throw new Error('Could not provision the new agent wallet.')
        newManager = address
      } else {
        if (!isAddress(newSigner)) throw new Error('Enter a valid new signer address.')
        newManager = newSigner
      }

      // 2. Ensure the wallet is on the SMA's chain.
      try { await switchChainAsync({ chainId }) } catch { /* may already be on chain */ }
      const reads = readsFor(chainId)

      // 3. Build + submit Safe.execTransaction(setManager). The server reads the
      //    current signer + attached mandates fresh on-chain and returns them.
      const setManagerTx = await buildSetManager({ newManager })
      const oldManager = setManagerTx.oldManager
      const permissions = Array.isArray(setManagerTx.permissions) ? setManagerTx.permissions : []

      status('rotate-wallet')
      const txHash = await sendTransactionAsync({ to: setManagerTx.to, data: setManagerTx.data, chainId })
      status('rotate-confirming')
      const receipt = await reads.waitForTransactionReceipt({ hash: txHash, ...RECEIPT_OPTS })
      // The Safe is a 1-of-1 with safeTxGas=0 + gasPrice=0, so a failed inner
      // setManager reverts the whole execTransaction — a 'success' receipt means
      // the rotation applied.
      if (receipt?.status === 'reverted') {
        throw new Error('Rotation transaction reverted — the signer was not changed.')
      }

      // 4. Re-attach the cleared mandates (owner signs the batch, owner submits).
      //    Kept best-effort: if it fails, the rotation already succeeded, so we
      //    persist that and report the re-attach as deferred rather than losing it.
      let reattachTxHash = null
      let reattachError = null
      const willReattach = reattach && permissions.length > 0
      if (willReattach) {
        try {
          status('reattach-sign')
          const { typedData, deadline } = await buildReattach({ permissions })
          const signature = await signTypedDataAsync(typedData)

          const reTx = await buildReattachTx({ permissions, deadline, signature })
          status('reattach-wallet')
          const reHash = await sendTransactionAsync({
            to: reTx.to,
            data: reTx.data,
            value: reTx.value ? BigInt(reTx.value) : undefined,
            chainId,
          })
          status('reattach-confirming')
          const reReceipt = await reads.waitForTransactionReceipt({ hash: reHash, ...RECEIPT_OPTS })
          if (reReceipt?.status === 'reverted') {
            throw new Error('Re-approval transaction reverted.')
          }
          reattachTxHash = reHash
        } catch (err) {
          reattachError = err instanceof Error ? err.message : String(err)
        }
      }

      // 5. Persist the rotation (account.json + list) and log it. Always runs once
      //    the rotation confirmed, even if re-attach was skipped or deferred.
      status('persisting')
      await rotateComplete({
        newManager,
        txHash,
        reattachTxHash,
        permissions: reattachTxHash ? permissions : undefined,
      })

      status('done')
      return {
        chainId,
        oldManager,
        newManager,
        txHash,
        permissions,
        reattachTxHash,
        // True when there were mandates to re-bind but they aren't bound yet.
        reattachDeferred: willReattach && !reattachTxHash,
        reattachError,
      }
    },
    [owner, switchChainAsync, sendTransactionAsync, signTypedDataAsync],
  )

  return { rotate }
}
