import styles from './MandateStatus.module.css'

/**
 * Status pill. Same dot+label visual treatment for mandates and agents,
 * but the label vocabulary differs by `kind`:
 *
 *  - kind="mandate" (default): Active · Paused · Expired · Revoked
 *  - kind="agent":              Active · Stopped · Expired · Ended
 *
 * Why: mandates can be revoked (atomic onchain action), but agents are
 * only ever STOPPED by the user. An agent whose parent mandate was
 * revoked is shown as "Ended" rather than "Revoked" so the user never
 * sees the word "revoke" attached to an agent.
 */
const LABELS = {
  mandate: {
    active:  'Active',
    paused:  'Paused',
    expired: 'Expired',
    revoked: 'Revoked',
  },
  agent: {
    active:  'Active',
    paused:  'Stopped',
    expired: 'Expired',
    revoked: 'Ended',
  },
}

export default function MandateStatus({ status = 'active', kind = 'mandate' }) {
  const cls = `${styles.pill} ${styles[status] ?? styles.muted}`
  const dict = LABELS[kind] ?? LABELS.mandate
  return (
    <span className={cls}>
      <span className={styles.dot} aria-hidden />
      <span>{dict[status] ?? status}</span>
    </span>
  )
}
