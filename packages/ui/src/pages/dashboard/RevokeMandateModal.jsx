import { useEffect, useState } from 'react'
import {
  useAccount,
  usePublicClient,
  useSendTransaction,
  useSignTypedData,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { encodeFunctionData } from 'viem'
import { GlassCard, SailButton } from '../shared'
import styles from './RevokeMandateModal.module.css'

// Old-kernel (conjunctive v1) batch-revoke shapes, matching the deployed Base
// kernel's on-chain typehash. Owner signs RevokePermissions off-chain, then
// submits revokePermissions from their own wallet (they pay gas).
const REVOKE_ABI = [
  {
    type: 'function',
    name: 'revokePermissions',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'permissions', type: 'address[]' },
      { name: 'deadline', type: 'uint256' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'signerNonces',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
]

const REVOKE_TYPES = {
  RevokePermissions: [
    { name: 'account', type: 'address' },
    { name: 'permissions', type: 'address[]' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

async function logRevoked(event) {
  try {
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  } catch {
    // best-effort — the on-chain revoke already succeeded
  }
}

/**
 * Revoke a single permission from the SMA. The owner authorizes the removal
 * with an EIP-712 RevokePermissions signature and submits the transaction from
 * their connected wallet. On success the action is recorded to the activity log
 * so it shows up in Recent Activity.
 */
export default function RevokeMandateModal({ open, mandate, sma, kernel, chainId, onClose, onRevoked }) {
  const { address: ownerAddress, chainId: walletChainId } = useAccount()
  const publicClient = usePublicClient({ chainId })
  const { signTypedDataAsync } = useSignTypedData()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()

  const [step, setStep] = useState('confirm') // confirm | pending | done
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState(null)
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!open) return
    setStep('confirm')
    setError('')
    setTxHash(null)
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape' && step !== 'pending') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!confirmed || !txHash || step === 'done') return
    setStep('done')
    logRevoked({
      type: 'permission_revoked',
      actor: 'owner',
      permission: mandate?.address,
      name: mandate?.name ?? null,
      sma,
      txHash,
      chainId,
    }).then(() => onRevoked?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed, txHash])

  if (!open) return null

  async function handleRevoke() {
    if (!ownerAddress) { setError('Connect your owner wallet first.'); return }
    if (!kernel || !sma || !mandate?.address) { setError('Missing SMA or kernel address.'); return }
    setStep('pending')
    setError('')
    try {
      if (walletChainId !== chainId) await switchChainAsync({ chainId })

      const nonce = await publicClient.readContract({
        address: kernel,
        abi: REVOKE_ABI,
        functionName: 'signerNonces',
        args: [sma],
      })
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
      const permissions = [mandate.address]

      const signature = await signTypedDataAsync({
        domain: { name: 'SailKernel', version: '1', chainId, verifyingContract: kernel },
        types: REVOKE_TYPES,
        primaryType: 'RevokePermissions',
        message: { account: sma, permissions, nonce, deadline },
      })

      const data = encodeFunctionData({
        abi: REVOKE_ABI,
        functionName: 'revokePermissions',
        args: [sma, permissions, deadline, signature],
      })
      const hash = await sendTransactionAsync({ to: kernel, data, chainId })
      setTxHash(hash)
    } catch (err) {
      setError(err?.shortMessage || err?.message || 'Transaction rejected.')
      setStep('confirm')
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Revoke permission"
      onClick={step === 'pending' ? undefined : onClose}>
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        {step !== 'pending' && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        )}

        {step === 'done' ? (
          <>
            <h2 className={styles.title}>Permission revoked</h2>
            <p className={styles.body}>
              <strong>{mandate?.name ?? mandate?.address}</strong> is no longer attached to your SMA.
              It now appears in Recent Activity.
            </p>
            <div className={styles.actions}>
              <SailButton onClick={onClose}>Done</SailButton>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title}>Revoke this permission?</h2>
            <p className={styles.body}>
              Removing <strong>{mandate?.name ?? 'this permission'}</strong> from your SMA means the
              agent can no longer act under it. You authorize the removal in your wallet and pay gas.
            </p>
            <dl className={styles.meta}>
              <div><dt>Permission</dt><dd>{mandate?.address}</dd></div>
              <div><dt>SMA</dt><dd>{sma}</dd></div>
            </dl>
            {error && <p className={styles.error}>{error}</p>}
            {!ownerAddress && <p className={styles.warn}>Connect your owner wallet to continue.</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose} disabled={step === 'pending'}>
                Cancel
              </button>
              <SailButton onClick={handleRevoke} disabled={step === 'pending' || !ownerAddress}>
                {step === 'pending' ? 'Awaiting wallet…' : 'Revoke'}
              </SailButton>
            </div>
          </>
        )}
      </GlassCard>
    </div>
  )
}
