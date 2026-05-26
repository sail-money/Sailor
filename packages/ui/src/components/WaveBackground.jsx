import styles from './WaveBackground.module.css'

function WaveBackground({ isDark }) {
  return (
    <div className={styles.waveBackground}>
      <div className={`${styles.wave} ${styles.wave1} ${!isDark ? styles.light : ''}`} />
      <div className={`${styles.wave} ${styles.wave2} ${!isDark ? styles.light : ''}`} />
      <div className={`${styles.wave} ${styles.wave3} ${!isDark ? styles.light : ''}`} />
    </div>
  )
}

export default WaveBackground
