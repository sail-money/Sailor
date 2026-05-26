import { useState } from 'react'
import styles from './RevealCalldata.module.css'

export default function RevealCalldata({
  calldata,
  label = 'View technical details',
  caption,
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{label}</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden>
          ↓
        </span>
      </button>
      {open && (
        <div className={styles.body}>
          <pre className={styles.code}>{calldata}</pre>
          {caption && <p className={styles.caption}>{caption}</p>}
        </div>
      )}
    </div>
  )
}
