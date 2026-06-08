import { useCallback } from 'react'
import { encodeFunctionData, getAddress, createPublicClient, http } from 'viem'
import { useSwitchChain } from 'wagmi'
import { chains } from '../wagmi'
import { useMockSigner } from './useMockSigner'
import { useOwnerWallet } from './useOwnerWallet'
import {
  buildCreateTx,
  buildRegisterPath,
  onboardComplete,
  generateKey,
} from '../data/sailorClient'

/**
 * A read client PINNED to a specific chain. We do NOT use wagmi's
 * usePublicClient() for receipts: after a chain switch its client can lag the
 * connected chain, so waitForTransactionReceipt polls the wrong network and
 * hangs forever. Building the client from the chain definition guarantees the
 * reads hit the same chain the tx was broadcast on.
 */
function readsFor(chainId) {
  const chain = chains.find((c) => c.id === chainId)
  if (!chain) throw new Error(`Unsupported chain ${chainId} — not in the wallet config.`)
  return createPublicClient({ chain, transport: http() })
}

const RECEIPT_OPTS = { timeout: 180_000, pollingInterval: 2_000 }

// topic0 of AccountRegistered(address indexed account, address indexed permissionSigner, address indexed manager)
// Copied verbatim from the original OnboardingWizard (commit 8944aee).
const ACCOUNT_REGISTERED_TOPIC =
  '0x05f9a81a3b5e45d338f25347928e56b0aaaa0c65d4087a980c4e41370fcccfeb'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Deploy seam — LIVE (wagmi). Stands up a new SMA (Safe) on the connected chain
 * via the owner's wallet, then persists it through `/api/onboard/complete`.
 *
 * Return shape is unchanged: { preview, deploy }.
 *   - `preview` still carries the static tx-preview fields the review surfaces
 *     render (type / network / gasEstimate / calldata).
 *   - `deploy({ chainId, onStatus })` runs the PROVEN deploy sequence from the
 *     original onboarding wizard and resolves to { safe, chainId }.
 *
 * Progress is surfaced via the optional `onStatus(status)` callback:
 *   'switching' → 'building' → 'wallet' → 'confirming' → 'done'
 */
export function useDeploySma() {
  const { sendTransactionAsync } = useMockSigner()
  const { switchChainAsync } = useSwitchChain()
  const { address: owner } = useOwnerWallet()

  const preview = {
    type: 'Safe deployment',
    network: '',
    gasEstimate: 'Estimated in your wallet',
    calldata: '',
  }

  /**
   * Sign + submit the SMA deployment on a single chain.
   * @param {{ chainId: number, onStatus?: (s: string) => void }} opts
   * @returns {Promise<{ safe: string, chainId: number }>}
   */
  const deploy = useCallback(
    async ({ chainId, passphrase, onStatus } = {}) => {
      const status = (s) => onStatus?.(s)
      if (!owner) throw new Error('Connect your wallet to deploy an SMA.')
      if (!chainId) throw new Error('No chain selected for deployment.')

      // Manager (agent) wallet — generateKey is idempotent: returns the existing
      // key if one is already provisioned, otherwise creates it, encrypted on
      // this device with the passphrase from the SECURE step.
      status('building')
      const { address: manager } = await generateKey({ passphrase })
      if (!manager) throw new Error('Could not provision the agent wallet.')

      const saltNonce = String(Date.now())

      // 1. Ensure the wallet is on the target chain (ignore "already on chain").
      status('switching')
      try { await switchChainAsync({ chainId }) } catch { /* may already be on chain */ }

      // Read client pinned to the target chain — used for simulate + receipts.
      const reads = readsFor(chainId)

      // 2. Build the direct createAccount tx.
      status('building')
      const body = await buildCreateTx({ owner, manager, chainId, saltNonce })

      // 3. Simulate. Any revert → fall back to the two-step register path.
      let useRegisterPath = false
      try {
        await reads.call({ account: owner, to: body.to, data: body.data })
      } catch {
        useRegisterPath = true
      }

      if (useRegisterPath) {
        // 4. REGISTER PATH (fallback).
        status('building')
        const path = await buildRegisterPath({ owner, manager, chainId, saltNonce })

        // a. Deploy the Safe directly via the factory.
        status('wallet')
        const deployHash = await sendTransactionAsync({ to: path.deployTx.to, data: path.deployTx.data, chainId })
        status('confirming')
        const deployReceipt = await reads.waitForTransactionReceipt({ hash: deployHash, ...RECEIPT_OPTS })

        // b. Parse the Safe address from the ProxyCreation event (topic[1]).
        const proxyLog = deployReceipt?.logs?.find(
          (l) => l.address?.toLowerCase() === path.deployTx.to.toLowerCase() && l.topics?.length >= 2,
        )
        if (!proxyLog) throw new Error('ProxyCreation event not found in deploy receipt')
        const safe = getAddress(`0x${proxyLog.topics[1].slice(26)}`)

        // c. registerAccount(permissionSigner=owner, manager, feePolicy=0) on the kernel.
        const registerData = encodeFunctionData({
          abi: [{ name: 'registerAccount', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }], outputs: [] }],
          functionName: 'registerAccount',
          args: [owner, manager, ZERO_ADDRESS],
        })
        status('wallet')
        const registerHash = await sendTransactionAsync({ to: path.kernel, data: registerData, chainId })
        status('confirming')
        const registerReceipt = await reads.waitForTransactionReceipt({ hash: registerHash, ...RECEIPT_OPTS })
        if (registerReceipt?.status === 'reverted') {
          throw new Error('registerAccount reverted — check the kernel address and try again.')
        }

        await onboardComplete({ safe, owner, manager, txHash: registerHash, chainId })
        status('done')
        return { chainId, safe }
      }

      // 5. DIRECT PATH.
      status('wallet')
      const hash = await sendTransactionAsync({ to: body.to, data: body.data, chainId })
      status('confirming')
      const receipt = await reads.waitForTransactionReceipt({ hash, ...RECEIPT_OPTS })
      if (receipt?.status === 'reverted') {
        throw new Error('createAccount transaction reverted. The Safe factory may not be supported on this chain.')
      }
      const log = receipt?.logs?.find((l) => l.topics?.[0] === ACCOUNT_REGISTERED_TOPIC)
      if (!log) throw new Error('AccountRegistered event not found in receipt (kernel version mismatch?).')
      const safe = getAddress(`0x${log.topics[1].slice(26)}`)

      await onboardComplete({ safe, owner, manager, txHash: hash, chainId })
      status('done')
      return { chainId, safe }
    },
    [owner, switchChainAsync, sendTransactionAsync],
  )

  return { preview, deploy }
}
