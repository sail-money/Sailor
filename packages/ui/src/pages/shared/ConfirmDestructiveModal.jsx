import { useEffect } from 'react'
import styles from './ConfirmDestructiveModal.module.css'

/**
 * Single confirmation modal for destructive actions (Reject mandate,
 * Revoke permission, Revoke mandate, etc.). Apple HIG: any irreversible or impactful
 * action must surface a confirmation step that names the action and
 * explains the consequence.
 *
 * Props:
 *   open, title, body, confirmLabel, cancelLabel, onConfirm, onCancel
 */
export default function ConfirmDestructiveModal({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <span className={styles.iconWrap} aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l9 16H3l9-16z" />
            <path d="M12 9v5" />
            <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
