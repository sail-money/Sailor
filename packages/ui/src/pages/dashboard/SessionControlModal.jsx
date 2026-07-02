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
            <h2 className={styles.title}>{pausing ? 'Your SMA is paused' : 'Your SMA is back online'}</h2>
            <p className={styles.body}>
              {pausing
                ? <>It’s <strong>on hold</strong> and can’t make any moves until you resume. Your permissions and funds are untouched — resume anytime, no re-setup needed. (Saved to Recent Activity.)</>
                : <>It can <strong>act again</strong> within the permissions you’ve set. (Saved to Recent Activity.)</>}
            </p>
            <div className={styles.actions}>
              <SailButton onClick={onClose}>Done</SailButton>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title}>{pausing ? 'Pause this SMA?' : 'Resume this SMA?'}</h2>
            <p className={styles.body}>
              {pausing ? (
                <>
                  This puts your SMA <strong>on hold right away</strong> — it won’t be able to make
                  any moves until you resume. Nothing else changes: the permissions you set stay in
                  place, and your funds stay safe in your account.
                </>
              ) : (
                <>
                  This brings your SMA <strong>back online</strong> — it can act again within the
                  permissions you’ve set.
                </>
              )}
            </p>
            <ul className={styles.confirmList}>
              <li className={styles.confirmItem}>
                Anything your SMA already had lined up to send stops working — you’re starting from
                a clean slate.
              </li>
              <li className={styles.confirmItem}>
                {pausing
                  ? 'Reversible anytime — resuming is instant, with no re-setup or re-signing.'
                  : 'You can pause again whenever you like.'}
              </li>
              <li className={styles.confirmItem}>
                You’ll approve this in your wallet — a quick signature plus one transaction.
              </li>
            </ul>
            <details className={styles.tech}>
              <summary className={styles.techSummary}>What happens on-chain</summary>
              <div className={styles.techBody}>
                <p>
                  Your wallet signs an EIP-712 <code>{primaryType}</code> message, then submits{' '}
                  <code>{fn}(account, deadline, sig)</code> to the SailKernel. The kernel verifies
                  the signature against the account’s <strong>permission signer</strong>.
                </p>
                <p>
                  It flips the account’s <code>sessionActive</code> flag — the kernel checks this on{' '}
                  <em>every</em> dispatch, so {pausing ? 'all manager dispatch is blocked' : 'manager dispatch is allowed again'}.
                </p>
                <p>
                  It also advances the account’s signer and manager/batch <strong>nonce epochs</strong>,
                  which is what invalidates anything pre-signed under the old epoch (the “clean slate”
                  above). Your registered permissions and the SMA’s custody of funds are untouched.
                </p>
              </div>
            </details>
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
