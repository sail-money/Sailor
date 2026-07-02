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

// Minimal ABI: the session kill switch + its signer nonce. revokeSession/activateSession are
// permissionSigner-signed over RevokeSession/ActivateSession(account, nonce, deadline).
const SESSION_ABI = [
  {
    type: 'function',
    name: 'revokeSession',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'activateSession',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
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

const typesFor = (primaryType) => ({
  [primaryType]: [
    { name: 'account', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
})

async function logSession(event) {
  try {
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  } catch {
    // best-effort
  }
}

/**
 * Session kill switch — pause (revokeSession) or resume (activateSession) the SMA's session.
 *
 * `mode` is 'pause' when the session is currently active, 'resume' when paused. The
 * permissionSigner (the owner in retail setups) signs the RevokeSession/ActivateSession digest;
 * the same wallet submits the tx. Both flip `sessionActive` and bump the manager/batch nonce
 * epochs, so any dispatch pre-signed in the prior state is invalidated (#70).
 */
export default function SessionControlModal({ open, mode, sma, kernel, chainId, onClose, onDone }) {
  const { address: ownerAddress, chainId: walletChainId } = useAccount()
  const publicClient = usePublicClient({ chainId })
  const { signTypedDataAsync } = useSignTypedData()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()

  const pausing = mode === 'pause'
  const primaryType = pausing ? 'RevokeSession' : 'ActivateSession'
  const fn = pausing ? 'revokeSession' : 'activateSession'

  const [step, setStep] = useState('confirm') // 'confirm' | 'pending' | 'done'
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
    logSession({ type: pausing ? 'session_paused' : 'session_resumed', actor: 'owner', sma, txHash, chainId })
      .then(() => onDone?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed, txHash])

  if (!open) return null

  async function handleSubmit() {
    if (!ownerAddress) { setError('Connect your owner wallet first.'); return }
    if (!kernel || !sma) { setError('Missing SMA or kernel address.'); return }
    setStep('pending')
    setError('')
    try {
      if (walletChainId !== chainId) await switchChainAsync({ chainId })

      // Signer nonce read just-in-time — revoke advances it a full epoch, so a cached
      // value would sign a stale nonce and revert.
      const nonce = await publicClient.readContract({
        address: kernel,
        abi: SESSION_ABI,
        functionName: 'signerNonces',
        args: [sma],
      })
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

      const signature = await signTypedDataAsync({
        domain: { name: 'SailKernel', version: '1', chainId, verifyingContract: kernel },
        types: typesFor(primaryType),
        primaryType,
        message: { account: sma, nonce, deadline },
      })

      const data = encodeFunctionData({ abi: SESSION_ABI, functionName: fn, args: [sma, deadline, signature] })
      const hash = await sendTransactionAsync({ to: kernel, data, chainId })
      setTxHash(hash)
    } catch (err) {
      setError(err?.shortMessage || err?.message || 'Transaction rejected.')
      setStep('confirm')
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={pausing ? 'Pause session' : 'Resume session'}
      onClick={step === 'pending' ? undefined : onClose}
    >
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        {step !== 'pending' && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        )}

        {step === 'done' ? (
          <>
            <h2 className={styles.title}>Session {pausing ? 'paused' : 'resumed'}</h2>
            <p className={styles.body}>
              {pausing
                ? <>Agent dispatch for this SMA is now <strong>halted</strong>. Permissions stay registered — resume anytime without re-signing. It now appears in Recent Activity.</>
                : <>Agent dispatch is <strong>re-enabled</strong> for this SMA. It now appears in Recent Activity.</>}
            </p>
            <div className={styles.actions}>
              <SailButton onClick={onClose}>Done</SailButton>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title}>{pausing ? 'Pause this session?' : 'Resume this session?'}</h2>
            <p className={styles.body}>
              {pausing ? (
                <>
                  This immediately <strong>halts all agent dispatch</strong> for this SMA — the manager
                  can execute nothing until you resume. It does <strong>not</strong> remove any
                  permissions; they stay registered and the SMA keeps custody of its funds.
                </>
              ) : (
                <>
                  This <strong>re-enables agent dispatch</strong> for this SMA. The manager can again
                  execute transactions within the registered permissions.
                </>
              )}
            </p>
            <ul className={styles.confirmList}>
              <li className={styles.confirmItem}>
                Any transaction the agent <strong>pre-signed</strong> before now becomes invalid — the
                kernel advances the signing epoch, so stale signatures can’t execute.
              </li>
              <li className={styles.confirmItem}>
                {pausing
                  ? 'Fully reversible: Resume re-enables dispatch without re-registering or re-signing permissions.'
                  : 'You can pause again at any time.'}
              </li>
              <li className={styles.confirmItem}>
                You authorize this in your wallet (a signature + one transaction) and pay gas.
              </li>
            </ul>
            <dl className={styles.meta}>
              <div><dt>SMA</dt><dd>{sma}</dd></div>
            </dl>
            {error && <p className={styles.error}>{error}</p>}
            {!ownerAddress && <p className={styles.warn}>Connect your owner wallet to continue.</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose} disabled={step === 'pending'}>
                Cancel
              </button>
              <SailButton onClick={handleSubmit} disabled={step === 'pending' || !ownerAddress}>
                {step === 'pending' ? 'Awaiting wallet…' : pausing ? 'Pause session' : 'Resume session'}
              </SailButton>
            </div>
          </>
        )}
      </GlassCard>
    </div>
  )
}
