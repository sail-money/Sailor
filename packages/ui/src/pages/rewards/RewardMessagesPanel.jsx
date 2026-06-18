import styles from './RewardMessagesPanel.module.css'
import { useRewardMessages } from './useRewardMessages'

/**
 * Dismissible "you earned it" notes, each tied to a real detected on-chain
 * event (see useRewardMessages / rewardMessages). Lives inside the rewards
 * module — the operational dashboard has no dependency on it.
 */
export default function RewardMessages({ weeks, decimals, symbol }) {
  const { messages, dismiss } = useRewardMessages({ weeks, decimals, symbol })
  if (messages.length === 0) return null

  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {messages.map((m) => (
        <div key={m.key} className={styles.toast}>
          <span className={styles.spark} aria-hidden>✦</span>
          <p className={styles.text}>{m.text}</p>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => dismiss(m.key)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
