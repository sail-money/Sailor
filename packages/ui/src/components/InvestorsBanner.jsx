import { useState } from 'react'
import styles from './InvestorsBanner.module.css'

const investors = [
  'Gami Capital',
  'CoinIX',
  'SeedClub',
  'Luis Cuende',
  'Singularity Venture Hub',
  'Arbitrum Foundation',
]

const trustedBy = [
  'Gami Labs',
  'Turtle',
  'Bond Credit',
]

// Enough copies to always fill the screen — animate exactly one set width (-25%)
const track = [...investors, ...investors, ...investors, ...investors]
const trustedTrack = [...trustedBy, ...trustedBy, ...trustedBy, ...trustedBy]

export default function InvestorsBanner() {
  const [paused, setPaused] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const [trustedPaused, setTrustedPaused] = useState(false)
  const [trustedHoveredIndex, setTrustedHoveredIndex] = useState(null)

  return (
    <section className={styles.section}>
      <p className={styles.label}>Backed by</p>

      <div className={styles.marqueeWrap}>
        <div
          className={styles.track}
          style={{ animationPlayState: paused ? 'paused' : 'running' }}
        >
          {track.map((name, i) => {
            const isHovered = hoveredIndex !== null && (i % investors.length) === (hoveredIndex % investors.length)
            return (
              <span
                key={i}
                className={`${styles.item} ${hoveredIndex !== null ? (isHovered ? styles.itemActive : styles.itemDim) : ''}`}
                onMouseEnter={() => { setPaused(true); setHoveredIndex(i) }}
                onMouseLeave={() => { setPaused(false); setHoveredIndex(null) }}
              >
                {name}
              </span>
            )
          })}
        </div>
      </div>

      <p className={styles.labelSmall}>Trusted by</p>

      <div className={styles.marqueeWrap}>
        <div
          className={`${styles.track} ${styles.trackReverse}`}
          style={{ animationPlayState: trustedPaused ? 'paused' : 'running' }}
        >
          {trustedTrack.map((name, i) => {
            const isHovered = trustedHoveredIndex !== null && (i % trustedBy.length) === (trustedHoveredIndex % trustedBy.length)
            return (
              <span
                key={i}
                className={`${styles.item} ${styles.itemTrusted} ${trustedHoveredIndex !== null ? (isHovered ? styles.itemActive : styles.itemDim) : ''}`}
                onMouseEnter={() => { setTrustedPaused(true); setTrustedHoveredIndex(i) }}
                onMouseLeave={() => { setTrustedPaused(false); setTrustedHoveredIndex(null) }}
              >
                {name}
              </span>
            )
          })}
        </div>
      </div>
    </section>
  )
}
