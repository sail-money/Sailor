'use client'

import { useCallback } from 'react'
import { createPublicClient, http } from 'viem'
import { useSwitchChain } from 'wagmi'
import { chains } from '../wagmi'
import {
  buildDeployMandate,
  buildReattach,
  buildReattachTx,
  mandateComplete,
} from '../data/sailorClient'
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
 * Create-mandate seam — LIVE (wagmi). Authors a NEW permission contract in the
 * browser and brings it on-chain end-to-end, the same two-step the CLI `sailor
 * mandate deploy --attach` runs, but OWNER-driven (no unfunded-agent gas gotcha):
 *
 *   1. Deploy   — owner submits the permission contract-creation tx (server
 *                 encodes the artifact + constructor args).
 *   2. Register — owner signs the EIP-712 RegisterPermissions authorization and
 *                 submits kernel.registerPermissions (reuses the proven batch
 *                 build-reattach / build-reattach-tx path with a 1-element set).
 *   3. Persist  — record the mandate (state/mandates.json) + activity log.
 *
 * `create(opts)` resolves to { address, deployTxHash, registerTxHash }; progress
 * is surfaced via the optional `onStatus(status)` callback:
 *   'building' → 'deploy-wallet' → 'deploy-confirming'
 *     → 'register-sign' → 'register-wallet' → 'register-confirming'
 *     → 'persisting' → 'done'
 */
export function useCreateMandate() {
  const { sendTransactionAsync, signTypedDataAsync } = useMockSigner()
  const { switchChainAsync } = useSwitchChain()
  const { address: owner } = useOwnerWallet()

  /**
   * @param {{
   *   chainId: number,
   *   template: string,        // compiled artifact name (e.g. BoundedCallPermission)
   *   args: any[],             // constructor args aligned to the template inputs
   *   name?: string,           // label for the mandate record (defaults to template)
   *   onStatus?: (s: string) => void,
   * }} opts
   */
  const create = useCallback(
    async ({ chainId, template, args, name, onStatus } = {}) => {
      const status = (s) => onStatus?.(s)
      if (!owner) throw new Error('Connect your wallet to create a mandate.')
      if (!chainId) throw new Error('No chain for this SMA.')
      if (!template) throw new Error('Pick a mandate template.')

      // 1. Build the contract-creation calldata (server encodes artifact + args).
      status('building')
      const deploy = await buildDeployMandate({ template, args })

      // 2. Deploy — owner submits the contract-creation tx (no `to`).
      try { await switchChainAsync({ chainId }) } catch { /* may already be on chain */ }
      const reads = readsFor(chainId)

      status('deploy-wallet')
      const deployTxHash = await sendTransactionAsync({ data: deploy.data, chainId })
      status('deploy-confirming')
      const deployReceipt = await reads.waitForTransactionReceipt({ hash: deployTxHash, ...RECEIPT_OPTS })
      if (deployReceipt?.status === 'reverted') {
        throw new Error('Deployment reverted — the permission contract was not created.')
      }
      const address = deployReceipt?.contractAddress
      if (!address) throw new Error('Deployment produced no contract address.')

      // 3. Register the freshly deployed permission (owner signs + submits).
      //    Reuses the rotation re-attach builders — they register an arbitrary
      //    permission set; here it's a single new address.
      status('register-sign')
      const { typedData, deadline } = await buildReattach({ permissions: [address] })
      const signature = await signTypedDataAsync(typedData)

      status('register-wallet')
      const tx = await buildReattachTx({ permissions: [address], deadline, signature })
      const registerTxHash = await sendTransactionAsync({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined,
        chainId,
      })
      status('register-confirming')
      const regReceipt = await reads.waitForTransactionReceipt({ hash: registerTxHash, ...RECEIPT_OPTS })
      if (regReceipt?.status === 'reverted') {
        throw new Error('Registration reverted — the mandate was deployed but not bound to your SMA.')
      }

      // 4. Persist the mandate + log the activity.
      status('persisting')
      await mandateComplete({
        name: name || template,
        address,
        template,
        constructorArgs: args,
        deployTxHash,
        registerTxHash,
      })

      status('done')
      return { address, deployTxHash, registerTxHash }
    },
    [owner, switchChainAsync, sendTransactionAsync, signTypedDataAsync],
  )

  return { create }
}
