import { useEffect, useState } from 'react'
import { SailButton } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './FundModal.module.css'

function CopyGlyph() {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4.5" y="4.5" width="7" height="7" rx="0.5" />
      <path d="M9.5 2.5H2.5V9.5" />
    </svg>
  )
}
function CheckGlyph() {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7.5l2.5 2.5L11 4" />
    </svg>
  )
}
function ArrowOutIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 9 L9 5" /><path d="M5.4 5 H9 V8.6" />
    </svg>
  )
}
function WarnGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3" /><circle cx="8" cy="12" r=".7" fill="currentColor" stroke="none" />
    </svg>
  )
}

function explorerUrl(chain, address) {
  if (chain?.id === 8453) return `https://basescan.org/address/${address}`
  if (chain?.id === 84532) return `https://sepolia.basescan.org/address/${address}`
  return null
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

/**
 * Fund modal — a focused "receive ETH" screen for a gas wallet (the SMA or the
 * manager). The address is the hero: send native ETH on the account's chain to
 * it. On-direction: flat raised surface, sharp corners, mono address, one blue
 * accent, grey for the network warning.
 *
 * `target`: { kind: 'sma'|'manager', label, role, address, chain }
 */
export default function FundModal({ open, target, onClose }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    setCopied(false)
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open || !target) return null

  const { label = 'wallet', role, address, chain } = target
  const network = capitalize(chain?.name || '')
  const explorer = explorerUrl(chain, address)

  function copy() {
    if (address && navigator?.clipboard?.writeText) navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div
      className={`${styles.overlay} ${styles.overlayOpen}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Fund ${label}`}
      onClick={onClose}
    >
      <div className={`${styles.card} ${styles.cardOpen}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>

        <header className={styles.header}>
          <span className={styles.eyebrow}>
            <span className={styles.eyebrowDot} aria-hidden />
            Add funds
          </span>
          <h2 className={`${shared.displayHeadline} ${styles.headline}`}>Fund the {label}.</h2>
          <p className={styles.subtitle}>
            Send native ETH on {network || 'this network'} to the address below.
            {role ? ` It covers ${role}.` : ''}
          </p>
        </header>

        <div className={styles.body}>
          {/* Network + chain */}
          <div className={styles.netRow}>
            <span className={styles.netLabel}>Network</span>
            <span className={styles.netValue}>
              <span className={styles.netDot} aria-hidden />
              {network || 'Unknown'}
            </span>
          </div>

          {/* The address — the hero of this screen. */}
          <div className={styles.addrLabel}>{label} address</div>
          <button type="button" className={styles.addrBlock} onClick={copy} title="Copy address">
            <span className={styles.addrText}>{address}</span>
            <span className={`${styles.addrCopy} ${copied ? styles.addrCopyOn : ''}`} aria-hidden>
              {copied ? <CheckGlyph /> : <CopyGlyph />}
              {copied ? 'Copied' : 'Copy'}
            </span>
          </button>
          {explorer && (
            <a className={styles.explorer} href={explorer} target="_blank" rel="noreferrer">
              View on explorer <ArrowOutIcon />
            </a>
          )}

          {/* Network warning — neutral grey, not amber. */}
          <div className={styles.warn} role="note">
            <span className={styles.warnIcon} aria-hidden><WarnGlyph /></span>
            <span className={styles.warnText}>
              Only send <strong>ETH on {network || 'the right network'}</strong>. Funds sent on another
              network, or tokens other than ETH, may be lost.
            </span>
          </div>
        </div>

        <footer className={styles.footer}>
          <SailButton onClick={copy}>{copied ? 'Address copied' : 'Copy address'}</SailButton>
          <SailButton variant="secondary" onClick={onClose}>Done</SailButton>
        </footer>
      </div>
    </div>
  )
}
