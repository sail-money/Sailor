import sailorMark from './sailor-mark.png'
import styles from '../signer/SigningPage.module.css'

/*
 * Signing-surface header (signer + mandate-signing pages).
 * Deliberately minimal: the Sailor mark + page title on the left, and one
 * page-level "leave" action on the right. There's no wallet/identity control —
 * the meaningful signing view is connected-only, and the wallet extension
 * confirms which account is signing at sign time, so a header identity chip
 * would just duplicate it (and the disconnected gate carries its own Connect
 * button). The `leaveLabel` reads "Sign later" when something's pending.
 */
export default function PageHeader({ eyebrow, title, backTo = '#/dashboard', showBack = true, leaveLabel = 'Back to dashboard' }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <button type="button" className={styles.brand}
          onClick={() => { window.location.hash = '#/dashboard' }} aria-label="Go to dashboard">
          <img src={sailorMark} className={styles.brandAvatar} alt="" />
        </button>
        <div className={styles.headerTitle}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h1 className={styles.title}>{title}</h1>
        </div>
      </div>

      {showBack && (
        <button type="button" className={styles.leaveBtn}
          onClick={() => { window.location.hash = backTo }}>
          {leaveLabel}
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 7h8M8 4l3 3-3 3" />
          </svg>
        </button>
      )}
    </header>
  )
}
