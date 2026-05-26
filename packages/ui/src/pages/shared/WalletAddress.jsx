import { useState } from 'react'
import styles from './WalletAddress.module.css'

function truncate(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function WalletAddress({ address }) {
  const [copied, setCopied] = useState(false)

  const onClick = () => {
    if (!address) return
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button type="button" className={styles.addr} onClick={onClick} aria-label="Copy wallet address">
      <span className={styles.dot} aria-hidden />
      <span className={styles.text}>{truncate(address)}</span>
      <span className={`${styles.check} ${copied ? styles.checkVisible : ''}`} aria-hidden>
        ✓
      </span>
    </button>
  )
}
