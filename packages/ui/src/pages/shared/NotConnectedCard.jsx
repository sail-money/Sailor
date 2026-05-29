import { useConnectModal } from '@rainbow-me/rainbowkit'
import { GlassCard, Sai, SailButton } from './index'
import shared from './shared.module.css'
import styles from '../signing/Signing.module.css'

export default function NotConnectedCard({ eyebrow = 'WELCOME TO SAIL', title = 'Separately Managed Accounts.', sub = 'Enforced by code, run by agents.' }) {
  const { openConnectModal } = useConnectModal()

  return (
    <GlassCard className={styles.welcomeCard}>
      <div className={styles.cardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.cardHeader}>
        <span className={styles.kicker}>{eyebrow}</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          {title}
        </h1>
        <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
          {sub}
        </p>
      </header>
      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={openConnectModal}>
          Connect wallet
        </SailButton>
      </div>
      <p className={styles.fineprint}>
        Self-custody. Sail never holds your keys.
      </p>
    </GlassCard>
  )
}
