import { useConnectModal } from '@rainbow-me/rainbowkit'
import { Sai, SailButton } from './index'
import styles from './NotConnectedCard.module.css'

export default function NotConnectedCard({ eyebrow = 'WELCOME TO SAIL', title = 'Separately Managed Accounts.', sub = 'Enforced by code, run by agents.' }) {
  const { openConnectModal } = useConnectModal()

  return (
    <div className={styles.gate}>
      <div className={styles.gateMark} aria-hidden>
        <Sai size={52} animate />
      </div>
      <span className={styles.gateKicker}>{eyebrow}</span>
      <h2 className={styles.gateTitle}>{title}</h2>
      <p className={styles.gateSub}>{sub}</p>
      <div className={styles.gateActions}>
        <SailButton fullWidth onClick={openConnectModal}>
          Connect wallet
        </SailButton>
      </div>
      <p className={styles.fineprint}>
        Self-custody. Sail never holds your keys.
      </p>
    </div>
  )
}
