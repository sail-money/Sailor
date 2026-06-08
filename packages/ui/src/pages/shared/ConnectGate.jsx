import GlassCard from './GlassCard'
import Sai from './Sai'
import SailButton from './SailButton'
import shared from './shared.module.css'
import styles from './ConnectGate.module.css'

/**
 * ConnectGate — Surface 3's not-connected state. Absorbs the framework's old
 * NotConnectedCard. Shown whenever the dashboard (or any signature-gated
 * action) needs the Owner wallet but it isn't connected.
 *
 * The Owner IS the connected wallet — the custody anchor and the only key that
 * can authorize anything. So this gate is the floor the whole surface stands on.
 *
 * `connect` comes from useOwnerWallet() via RainbowKit's openConnectModal.
 */
export default function ConnectGate({
  eyebrow = 'OWNER WALLET',
  title = 'Connect to your account.',
  sub = 'Your SMA is controlled by the wallet that owns it. Connect the Owner wallet to view the account and authorize what your agent has drafted.',
  cta = 'Connect wallet',
  onConnect,
}) {
  return (
    <div className={styles.wrap}>
      <GlassCard className={styles.card}>
        <div className={styles.sai} aria-hidden><Sai size={60} animate /></div>
        <header className={styles.head}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h1 className={`${shared.displayHeadline} ${styles.title}`}>{title}</h1>
          <p className={styles.sub}>{sub}</p>
        </header>
        <SailButton fullWidth onClick={onConnect}>{cta} →</SailButton>
        <p className={styles.footnote}>
          <span className={styles.footnoteDot} aria-hidden />
          Self-custody · your wallet talks to the chain directly. There is no Sail-hosted backend.
        </p>
      </GlassCard>
    </div>
  )
}
