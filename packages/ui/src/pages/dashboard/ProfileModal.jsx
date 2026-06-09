import { useEffect, useState } from 'react'
import styles from './ProfileModal.module.css'

function truncate(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function ProfileModal({
  open,
  wallet,
  onClose,
  onDisconnect,
}) {
  const [closing, setClosing] = useState(false)
  const [copiedEoa, setCopiedEoa] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleClose() {
    setClosing(true)
    setTimeout(() => { setClosing(false); onClose?.() }, 320)
  }

  function copyEoa() {
    if (!wallet) return
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(wallet)
    setCopiedEoa(true)
    setTimeout(() => setCopiedEoa(false), 1400)
  }

  if (!open) return null

  return (
    <>
      <div className={styles.overlay} onClick={handleClose} aria-hidden />
      <aside
        className={`${styles.panel} ${closing ? styles.panelOut : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Account"
      >
        <div className={styles.hero}>
          <div className={styles.avatarRing}>
            <div className={styles.avatar}>{wallet?.slice(2, 4).toUpperCase() ?? 'U'}</div>
          </div>
          <div className={styles.identity}>
            <span className={styles.identityKicker}>EOA · Owner</span>
            <button
              type="button"
              className={styles.identityAddress}
              onClick={copyEoa}
              aria-label="Copy EOA address"
            >
              <span>{truncate(wallet)}</span>
              <span className={styles.identityCopyIcon} aria-hidden>
                {copiedEoa ? <CheckIcon /> : <CopyIcon />}
              </span>
            </button>
          </div>
          <button
            type="button"
            className={styles.disconnectPill}
            onClick={onDisconnect ?? handleClose}
          >
            Disconnect
          </button>
        </div>
      </aside>
    </>
  )
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M4 4V3a1 1 0 011-1h4.5a1 1 0 011 1v5a1 1 0 01-1 1H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7.4l2.6 2.6L11 4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
