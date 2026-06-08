import { useEffect, useState } from 'react'
import { isAddress } from 'viem'
import { InfoTip, SailButton, WalletAddress } from '../shared'
import shared from '../shared/shared.module.css'
import { getRotationPreview } from '../../data/sailorClient'
import { useRotateSigner } from '../../hooks/useRotateSigner'
import { useOwnerWallet } from '../../hooks/useOwnerWallet'
import styles from './RotateSignerModal.module.css'

/* Friendly label for each step the rotate hook reports via onStatus. */
const STEP_LABEL = {
  building: 'Provisioning the new agent wallet…',
  'rotate-wallet': 'Approve the rotation in your wallet…',
  'rotate-confirming': 'Confirming the rotation on-chain…',
  'reattach-sign': 'Sign to re-approve your mandates…',
  'reattach-wallet': 'Approve the re-binding in your wallet…',
  'reattach-confirming': 'Confirming the mandate re-binding…',
  persisting: 'Finishing up…',
}

function WarningGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2.5l6 11H2l6-11z" />
      <path d="M8 7v3" />
      <circle cx="8" cy="12" r=".7" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Manager-key rotation — rotates the SMA's delegated signer (the agent wallet).
 *
 * Drives the live, owner-signed flow (useRotateSigner): the owner submits
 * Safe.execTransaction(setManager) — which CLEARS every attached mandate
 * on-chain — then signs + submits the re-approval that re-binds those mandates
 * to the new signer. The whole flow stays on this surface; the owner's wallet is
 * the only thing that signs.
 */
export default function RotateSignerModal({ open, chain, currentManager, onClose, onRotated }) {
  const { address: owner } = useOwnerWallet()
  const { rotate } = useRotateSigner()

  const [preview, setPreview] = useState(null)
  const [previewErr, setPreviewErr] = useState(null)
  const [mode, setMode] = useState('generate') // 'generate' | 'existing'
  const [newSigner, setNewSigner] = useState('')
  const [passphrase, setPassphrase] = useState('')

  const [phase, setPhase] = useState('intro') // intro | running | done | error
  const [step, setStep] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  // Load what the rotation would touch (current signer + mandates) on open.
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setPreview(null)
    setPreviewErr(null)
    getRotationPreview()
      .then((p) => { if (!cancelled) setPreview(p) })
      .catch((err) => { if (!cancelled) setPreviewErr(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [open])

  // Reset the form each time the modal is opened fresh.
  useEffect(() => {
    if (!open) return
    setMode('generate')
    setNewSigner('')
    setPassphrase('')
    setPhase('intro')
    setStep(null)
    setResult(null)
    setError(null)
  }, [open])

  // Esc to close + lock body scroll while open (only when not mid-flight).
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && phase !== 'running') onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, phase, onClose])

  const mandateCount = preview?.permissions?.length ?? 0
  const chainId = preview?.chainId ?? chain?.id ?? null
  const shownManager = preview?.currentManager ?? currentManager ?? null

  const existingInvalid = mode === 'existing' && newSigner.trim() !== '' && !isAddress(newSigner.trim())
  const canRotate =
    Boolean(owner) &&
    Boolean(chainId) &&
    !previewErr &&
    (mode === 'generate' || (isAddress(newSigner.trim()) && newSigner.trim().toLowerCase() !== (shownManager ?? '').toLowerCase()))

  async function runRotation() {
    setPhase('running')
    setError(null)
    try {
      const res = await rotate({
        chainId,
        generate: mode === 'generate',
        newSigner: mode === 'existing' ? newSigner.trim() : undefined,
        passphrase,
        reattach: true,
        onStatus: setStep,
      })
      setResult(res)
      setPhase('done')
      onRotated?.(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  if (!open) return null

  return (
    <div
      className={`${styles.overlay} ${styles.overlayOpen}`}
      role="dialog"
      aria-modal="true"
      aria-label="Rotate agent signer"
      onClick={() => { if (phase !== 'running') onClose?.() }}
    >
      <div className={`${styles.card} ${styles.cardOpen}`} onClick={(e) => e.stopPropagation()}>
        {phase !== 'running' && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        )}

        <header className={styles.header}>
          <span className={styles.pill}>
            <span className={styles.pillDot} aria-hidden />
            Rotate signer
          </span>
          <h2 className={`${shared.displayHeadline} ${styles.headline}`}>
            {phase === 'done' ? 'Signer rotated.' : phase === 'error' ? 'Rotation failed.' : 'Rotate the agent wallet.'}
          </h2>
          <p className={styles.subtitle}>
            {phase === 'done'
              ? 'Your agent now signs with the new key.'
              : phase === 'error'
                ? 'Nothing was persisted unless a step confirmed on-chain. See the details below.'
                : 'Hand the agent role to a fresh key. The recovery path when a key is lost, or when you simply want to rotate.'}
            {' '}
            <InfoTip label="What is the agent wallet?">
              The agent wallet (the kernel <em>manager</em>) is the delegated signer that submits your
              agent&rsquo;s on-chain actions and pays gas. Rotating it replaces that key. Your owner wallet,
              which holds the Safe, is unchanged.
            </InfoTip>
          </p>
        </header>

        {/* ── INTRO: preview + warning + new-signer choice ── */}
        {phase === 'intro' && (
          <div className={styles.body}>
            {/* 2-row grid so labels align with labels and values align with
                values; the arrow sits on the value row, vertically centered. */}
            <section className={styles.previewRow}>
              <span className={`${styles.fieldLabel} ${styles.cellLabelA}`}>Current signer</span>
              <div className={styles.cellValA}>
                {shownManager ? <WalletAddress address={shownManager} /> : <span className={styles.muted}>Not set</span>}
              </div>
              <span className={`${styles.arrow} ${styles.cellArrow}`} aria-hidden>→</span>
              <span className={`${styles.fieldLabel} ${styles.cellLabelB}`}>New signer</span>
              <div className={styles.cellValB}>
                {mode === 'generate'
                  ? <span className={styles.muted}>Freshly generated</span>
                  : (isAddress(newSigner.trim())
                      ? <WalletAddress address={newSigner.trim()} />
                      : <span className={styles.muted}>Enter an address</span>)}
              </div>
            </section>

            <div className={styles.warning} role="note">
              <span className={styles.warningIcon} aria-hidden><WarningGlyph /></span>
              <span className={styles.warningBody}>
                <span className={styles.warningTitle}>
                  {mandateCount > 0
                    ? `Rotation clears your ${mandateCount} attached mandate${mandateCount === 1 ? '' : 's'}`
                    : 'Rotation clears all attached mandates'}
                </span>
                <span className={styles.warningSub}>
                  {mandateCount > 0
                    ? 'The protocol detaches every mandate the instant the signer changes (fail-closed). They are re-approved and re-bound to the new signer in the same flow, so you sign twice: once to rotate, once to re-bind.'
                    : 'No mandates are currently attached, so there is nothing to re-bind. You sign once.'}
                </span>
              </span>
            </div>

            <section className={styles.choice}>
              <button
                type="button"
                className={`${styles.choiceOpt} ${mode === 'generate' ? styles.choiceOptOn : ''}`}
                onClick={() => setMode('generate')}
              >
                <span className={styles.choiceRadio} aria-hidden />
                <span className={styles.choiceText}>
                  <span className={styles.choiceTitle}>Generate a new key <span className={styles.recommend}>Recommended</span></span>
                  <span className={styles.choiceSub}>Creates a fresh agent keystore on this machine. The old key is backed up.</span>
                </span>
              </button>
              <button
                type="button"
                className={`${styles.choiceOpt} ${mode === 'existing' ? styles.choiceOptOn : ''}`}
                onClick={() => setMode('existing')}
              >
                <span className={styles.choiceRadio} aria-hidden />
                <span className={styles.choiceText}>
                  <span className={styles.choiceTitle}>Use an existing address</span>
                  <span className={styles.choiceSub}>Hand the role to a key you already hold. The local keystore is left as-is.</span>
                </span>
              </button>
            </section>

            {mode === 'existing' && (
              <section className={styles.field}>
                <label htmlFor="rotate-new-signer" className={styles.fieldLabel}>New signer address</label>
                <input
                  id="rotate-new-signer"
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  className={`${styles.input} ${existingInvalid ? styles.inputError : ''}`}
                  placeholder="0x…"
                  value={newSigner}
                  onChange={(e) => setNewSigner(e.target.value)}
                />
                {existingInvalid && <span className={styles.inputHint}>That doesn&rsquo;t look like a valid address.</span>}
              </section>
            )}

            {mode === 'generate' && (
              <section className={styles.field}>
                <label htmlFor="rotate-passphrase" className={styles.fieldLabel}>
                  Keystore passphrase <span className={styles.optional}>optional</span>
                </label>
                <input
                  id="rotate-passphrase"
                  type="password"
                  autoComplete="new-password"
                  className={styles.input}
                  placeholder="Leave blank to match your current agent setup"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
                <span className={styles.inputHint}>
                  Must match the passphrase your agent uses to load the key (<code>SAIL_PASSPHRASE</code>). Blank is fine if it&rsquo;s unset.
                </span>
              </section>
            )}

            {previewErr && <div className={styles.errorNote}>Couldn&rsquo;t read on-chain state: {previewErr}</div>}
            {!owner && <div className={styles.note}>Connect your owner wallet to rotate.</div>}

            <footer className={styles.footer}>
              <SailButton onClick={runRotation} disabled={!canRotate}>
                {mandateCount > 0 ? 'Rotate and re-bind mandates' : 'Rotate signer'}
              </SailButton>
              <SailButton variant="secondary" onClick={onClose}>Cancel</SailButton>
            </footer>
          </div>
        )}

        {/* ── RUNNING: live progress ── */}
        {phase === 'running' && (
          <div className={styles.running}>
            <span className={styles.spinner} aria-hidden />
            <p className={`${shared.displayHeadline} ${styles.runningHeadline}`}>
              {STEP_LABEL[step] ?? 'Working…'}
            </p>
            <p className={shared.italicMannerism}>
              {step === 'rotate-wallet' || step === 'reattach-wallet' || step === 'reattach-sign'
                ? 'Confirm in your wallet to continue.'
                : 'This can take a moment while the chain confirms.'}
            </p>
            <p className={styles.runningNote}>Keep this window open until both steps complete.</p>
          </div>
        )}

        {/* ── DONE: success summary ── */}
        {phase === 'done' && result && (
          <div className={styles.body}>
            <section className={styles.summaryRow}>
              <div className={styles.summaryCell}>
                <span className={styles.fieldLabel}>New signer</span>
                <div className={styles.summaryVal}><WalletAddress address={result.newManager} /></div>
              </div>
              <div className={styles.summaryCell}>
                <span className={styles.fieldLabel}>Mandates</span>
                <div className={styles.summaryVal}>
                  <span className={styles.muted}>
                    {result.reattachTxHash
                      ? `${result.permissions.length} re-bound`
                      : result.reattachDeferred
                        ? `${result.permissions.length} cleared, not yet re-bound`
                        : 'None to re-bind'}
                  </span>
                </div>
              </div>
            </section>

            {result.reattachDeferred && (
              <div className={styles.warning} role="note">
                <span className={styles.warningIcon} aria-hidden><WarningGlyph /></span>
                <span className={styles.warningBody}>
                  <span className={styles.warningTitle}>Mandates cleared but not re-bound</span>
                  <span className={styles.warningSub}>
                    The rotation succeeded, but re-approval didn&rsquo;t complete{result.reattachError ? `: ${result.reattachError}` : '.'} Your
                    agent can&rsquo;t act until the mandates are re-attached. Re-open this dialog to retry, or re-author the mandate.
                  </span>
                </span>
              </div>
            )}

            <div className={styles.txLinks}>
              <TxLink chain={chain} hash={result.txHash} label="Rotation tx" />
              {result.reattachTxHash && <TxLink chain={chain} hash={result.reattachTxHash} label="Re-bind tx" />}
            </div>

            <footer className={styles.footer}>
              <SailButton onClick={onClose}>Done</SailButton>
            </footer>
          </div>
        )}

        {/* ── ERROR ── */}
        {phase === 'error' && (
          <div className={styles.body}>
            <div className={styles.errorNote}>{error}</div>
            <footer className={styles.footer}>
              <SailButton onClick={() => setPhase('intro')}>Back</SailButton>
              <SailButton variant="secondary" onClick={onClose}>Close</SailButton>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}

/* A small explorer link for a tx hash, using the chain's explorer if known. */
function TxLink({ chain, hash, label }) {
  if (!hash) return null
  const base = chain?.id === 8453 ? 'https://basescan.org/tx/'
    : chain?.id === 84532 ? 'https://sepolia.basescan.org/tx/'
    : null
  const short = `${hash.slice(0, 8)}…${hash.slice(-6)}`
  return base ? (
    <a className={styles.txLink} href={`${base}${hash}`} target="_blank" rel="noreferrer">
      {label}: <span className={styles.txMono}>{short}</span> ↗
    </a>
  ) : (
    <span className={styles.txLink}>{label}: <span className={styles.txMono}>{short}</span></span>
  )
}
