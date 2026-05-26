import styles from './ConstraintPill.module.css'

export default function ConstraintPill({ label, children }) {
  return <span className={styles.pill}>{label ?? children}</span>
}
