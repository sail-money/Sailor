import styles from './Atmosphere.module.css'

/**
 * Deterministic star field — placed by hand so it looks composed, not random.
 * Each entry: [x%, y%, size, opacity, delaySec, bright?]
 * y% is within the .sky band (top 62% of viewport).
 */
const STARS = [
  // bright accent stars
  [18, 22, 2.0, 0.95, 0.0, true],
  [62, 14, 1.8, 0.9,  1.4, true],
  [84, 36, 1.6, 0.8,  2.8, true],

  // upper sky — sparse
  [4,  8,  1.0, 0.55, 0.6],
  [11, 4,  0.8, 0.45, 1.1],
  [27, 11, 1.2, 0.65, 2.1],
  [33, 6,  0.7, 0.4,  3.3],
  [41, 18, 0.9, 0.55, 0.4],
  [49, 5,  1.0, 0.5,  2.0],
  [55, 16, 0.7, 0.4,  3.7],
  [69, 7,  1.1, 0.6,  0.9],
  [76, 11, 0.8, 0.5,  4.4],
  [88, 5,  0.9, 0.55, 1.8],
  [93, 14, 0.7, 0.4,  3.0],
  [97, 22, 1.0, 0.6,  2.3],

  // mid-band
  [7,  26, 0.8, 0.4,  4.0],
  [14, 34, 1.1, 0.6,  0.2],
  [22, 44, 0.7, 0.4,  2.7],
  [29, 38, 1.0, 0.55, 1.2],
  [36, 28, 0.8, 0.45, 3.5],
  [44, 42, 0.7, 0.4,  4.7],
  [52, 32, 1.1, 0.6,  0.8],
  [58, 46, 0.8, 0.45, 2.5],
  [66, 28, 0.9, 0.5,  4.1],
  [72, 40, 1.0, 0.55, 1.6],
  [78, 24, 0.8, 0.5,  3.2],
  [86, 48, 0.9, 0.5,  2.0],
  [92, 36, 0.7, 0.4,  4.6],

  // tiny shimmer cluster (denser, dim)
  [15, 12, 0.5, 0.35, 1.0],
  [16, 14, 0.5, 0.3,  2.4],
  [50, 22, 0.6, 0.4,  3.6],
  [51, 25, 0.5, 0.3,  0.5],
  [74, 18, 0.6, 0.4,  2.9],
  [75, 20, 0.5, 0.3,  4.3],

  // near-horizon dim stars
  [10, 52, 0.6, 0.3,  3.8],
  [38, 56, 0.7, 0.35, 1.5],
  [61, 54, 0.6, 0.3,  2.7],
  [82, 58, 0.7, 0.35, 4.0],
]

export default function Atmosphere() {
  return (
    <div className={styles.atmosphere} aria-hidden>
      <div className={styles.sky}>
        {STARS.map(([x, y, size, opacity, delay, bright], i) => (
          <span
            key={i}
            className={`${styles.star} ${bright ? styles.starBright : ''}`}
            style={{
              left: `${x}%`,
              top: `${(y / 62) * 100}%`,
              width: `${size}px`,
              height: `${size}px`,
              animationDelay: `${delay}s`,
              '--o': opacity,
            }}
          />
        ))}
      </div>
      <div className={styles.horizon} />
      <div className={styles.water} />
      <div className={styles.vignette} />
    </div>
  )
}
