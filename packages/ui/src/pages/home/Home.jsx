import { FluidBackground, Sai } from '../shared'
import PageHeader from '../shared/PageHeader'
import styles from './Home.module.css'

export default function Home() {
  return (
    <div className={styles.shell}>
      <FluidBackground />
      <PageHeader eyebrow="Sailor" title="Home" showBack={false} />

      <main className={styles.main}>
        <div className={styles.center}>
          <div className={styles.mascotWrap}>
            <Sai size={80} animate />
          </div>
          <h1 className={styles.headline}>Your onchain agent hub</h1>
          <p className={styles.sub}>
            One Safe. One mandate. Unlimited agent actions — all within bounds you set.
          </p>
          <div className={styles.divider}>
            <span className={styles.dividerDot} />
            <span className={styles.dividerLine} />
            <span className={styles.dividerDot} />
          </div>
        </div>

        <div className={styles.cards}>
          <button type="button" className={styles.card}
            onClick={() => { window.location.hash = '#/dashboard' }}>
            <span className={styles.cardLabel}>Dashboard</span>
            <span className={styles.cardSub}>SMA · mandate · activity</span>
          </button>

          <button type="button" className={styles.card}
            onClick={() => { window.location.hash = '#/station' }}>
            <span className={styles.cardLabel}>Signing Station</span>
            <span className={styles.cardSub}>Approve agent requests</span>
          </button>

          <button type="button" className={styles.card}
            onClick={() => { window.location.hash = '#/signing' }}>
            <span className={styles.cardLabel}>Connect</span>
            <span className={styles.cardSub}>Sign mandate · authorize agent</span>
          </button>
        </div>
      </main>
    </div>
  )
}
