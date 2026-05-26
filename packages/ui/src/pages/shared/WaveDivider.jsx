import styles from './WaveDivider.module.css'

/**
 * Subtle nautical divider — a slim two-wave SVG used between dashboard
 * sections. The visual rhythm references Sail's sailing metaphor without
 * leaning on illustration. Drifts gently on a long, looping translate.
 */
export default function WaveDivider({ label }) {
  return (
    <div className={styles.divider} role="separator" aria-hidden={!label}>
      <span className={styles.tick} />
      <span className={styles.waveWrap}>
        <svg
          className={styles.wave}
          viewBox="0 0 600 24"
          preserveAspectRatio="none"
          aria-hidden
        >
          {/* back wave — fainter, slower drift */}
          <path
            className={styles.waveBack}
            d="M0 14 C 75 4, 150 24, 225 14 S 375 4, 450 14 S 600 24, 675 14 L 675 24 L 0 24 Z"
          />
          {/* front wave — slightly brighter */}
          <path
            className={styles.waveFront}
            d="M0 16 C 60 8, 120 22, 180 16 S 300 10, 360 16 S 480 22, 540 16 S 660 8, 720 16 L 720 24 L 0 24 Z"
          />
        </svg>
      </span>
      <span className={styles.tick} />
      {label && <span className={styles.label}>{label}</span>}
    </div>
  )
}
