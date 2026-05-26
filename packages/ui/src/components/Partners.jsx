import { useInView } from '../hooks/useInView'
import styles from './Partners.module.css'

const metrics = [
  { value: '4',         label: 'Exploits prevented',  caption: 'detected and stopped before user impact' },
  { value: '143',       label: 'Vaults monitored',    caption: 'across Base, Arbitrum, Ethereum' },
  { value: '6',         label: 'Detection layers',    caption: 'running independently, 24/7' },
  { value: '< 1 BLOCK', label: 'Detection latency',   caption: 'for protocol exploits' },
]

const features = [
  {
    name: 'Stablecoin & collateral depeg alerts',
    desc: 'Stablecoin and collateral feeds checked every 5 min via Chainlink and CoinGecko. Any 5%+ depeg blocks every vault with exposure — including downstream collateral dependencies.',
  },
  {
    name: 'Liquidity, utilization & DEX imbalance',
    desc: 'Three live signals — borrow utilization, redeemable-liquidity floor, and DEX imbalance via 30-min Uniswap TWAP — freeze vaults under stress and catch whale withdrawals in real time.',
  },
  {
    name: 'Agent-layer integration',
    desc: "Signals feed two hard kill-switches — vault and token — read by every Sail agent cycle. Re-entry is gated by risk tier: 1h cooldown, 24h, or manual review only.",
  },
  {
    name: 'Protocol & off-chain monitoring',
    desc: 'Protocol GitHub repos watched 24/7 for incident keywords, direct pushes to main, fast-merged PRs, and off-hours releases. Any hit triggers a Tier 3 flag — no auto re-entry.',
  },
]

const blips = [
  { id: 1, top: '22%', left: '71%', delay: '0.4s', label: 'USDC' },
  { id: 2, top: '38%', left: '24%', delay: '2.2s', label: 'USDT' },
  { id: 3, top: '18%', left: '44%', delay: '1.1s', label: 'EURC' },
]

function SonarVisual() {
  return (
    <div className={styles.sonarWrap}>

      {/* Ambient background glow */}
      <div className={styles.bgGlow} />

      {/* SVG: grid rings + crosshair + tick marks */}
      <svg className={styles.sonarSvg} viewBox="0 0 400 400" fill="none">
        {/* Grid rings */}
        <circle cx="200" cy="200" r="60"  stroke="rgba(25,144,255,0.12)" strokeWidth="0.8" />
        <circle cx="200" cy="200" r="110" stroke="rgba(25,144,255,0.10)" strokeWidth="0.8" />
        <circle cx="200" cy="200" r="160" stroke="rgba(25,144,255,0.08)" strokeWidth="0.8" />

        {/* Crosshair */}
        <line x1="30"  y1="200" x2="370" y2="200" stroke="rgba(25,144,255,0.08)" strokeWidth="0.8" />
        <line x1="200" y1="30"  x2="200" y2="370" stroke="rgba(25,144,255,0.08)" strokeWidth="0.8" />

        {/* Diagonal guides */}
        <line x1="87"  y1="87"  x2="313" y2="313" stroke="rgba(25,144,255,0.04)" strokeWidth="0.8" />
        <line x1="313" y1="87"  x2="87"  y2="313" stroke="rgba(25,144,255,0.04)" strokeWidth="0.8" />

        {/* Tick marks around outer ring */}
        {Array.from({ length: 36 }).map((_, i) => {
          const angle = (i * 10 * Math.PI) / 180
          const x1 = 200 + Math.sin(angle) * 158
          const y1 = 200 - Math.cos(angle) * 158
          const x2 = 200 + Math.sin(angle) * (i % 3 === 0 ? 150 : 154)
          const y2 = 200 - Math.cos(angle) * (i % 3 === 0 ? 150 : 154)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={i % 9 === 0 ? 'rgba(25,144,255,0.30)' : 'rgba(25,144,255,0.12)'}
            strokeWidth={i % 9 === 0 ? '1.2' : '0.7'} />
        })}

        {/* Cardinal labels */}
        <text x="200" y="18"  textAnchor="middle" fill="rgba(25,144,255,0.35)" fontSize="9" fontFamily="monospace" letterSpacing="0.1em">N</text>
        <text x="388" y="204" textAnchor="middle" fill="rgba(25,144,255,0.35)" fontSize="9" fontFamily="monospace" letterSpacing="0.1em">E</text>
        <text x="200" y="390" textAnchor="middle" fill="rgba(25,144,255,0.35)" fontSize="9" fontFamily="monospace" letterSpacing="0.1em">S</text>
        <text x="12"  y="204" textAnchor="middle" fill="rgba(25,144,255,0.35)" fontSize="9" fontFamily="monospace" letterSpacing="0.1em">W</text>

        {/* Range labels */}
        <text x="208" y="142" fill="rgba(25,144,255,0.25)" fontSize="7" fontFamily="monospace">25</text>
        <text x="208" y="92"  fill="rgba(25,144,255,0.22)" fontSize="7" fontFamily="monospace">50</text>
        <text x="208" y="42"  fill="rgba(25,144,255,0.18)" fontSize="7" fontFamily="monospace">75</text>
      </svg>

      {/* Sweep */}
      <div className={styles.sweep} />

      {/* Sweep glow trail */}
      <div className={styles.sweepTrail} />

      {/* Blips */}
      {blips.map(({ id, top, left, delay, label }) => (
        <div key={id} className={styles.blipWrap} style={{ top, left, animationDelay: delay }}>
          <div className={styles.blipRing} style={{ animationDelay: delay }} />
          <div className={styles.blipRing2} style={{ animationDelay: delay }} />
          <div className={styles.blipDot} />
          <span className={styles.blipLabel}>{label}</span>
        </div>
      ))}

      {/* Center icon */}
      <div className={styles.centerWrap}>
        <div className={styles.centerOrbit} />
        <div className={styles.centerGlow} />
        <div className={styles.centerIcon}>
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M16 3L4 8v9c0 7 5.1 13.5 12 15.3C22.9 30.5 28 24 28 17V8L16 3z"
              fill="rgba(25,144,255,0.20)" stroke="rgba(100,200,255,0.90)"
              strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M11 16.5l3.5 3.5 6.5-6.5" stroke="white"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Top-right status */}
      <div className={styles.statusChip}>
        <span className={styles.statusDot} />
        LIVE SCANNING
      </div>

      {/* Bottom info bar */}
      <div className={styles.sonarBar}>
        <div className={styles.sonarBarLeft}>
          <span className={styles.sonarName}>Sonar</span>
          <span className={styles.sonarSub}>Security Agent</span>
        </div>
        <div className={styles.sonarStats}>
          <div className={styles.sonarStat}><span>5%</span><span>depeg</span></div>
          <div className={styles.sonarStat}><span>20%</span><span>TVL</span></div>
          <div className={styles.sonarStat}><span>24/7</span><span>active</span></div>
        </div>
      </div>

    </div>
  )
}

export default function Partners({ onContact }) {
  const [sectionRef, inView] = useInView()

  return (
    <section className={`${styles.section} ${inView ? styles.visible : ''}`} ref={sectionRef}>

      {/* ── Band 1 — Header (centered) ─────────────────────────── */}
      <header className={styles.headerBand}>
        <p className={styles.eyebrow}>
          <span className={styles.eyebrowDot} />
          Sail Intelligence
        </p>
        <h2 className={styles.title}>Security Agent: <span className={styles.sonarShimmer}>Sonar</span></h2>
        <p className={styles.subtitle}>
          Sonar monitors on-chain signals in real time and alerts Sail's agents
          to act before threats reach your capital.
        </p>
      </header>

      {/* ── Band 2 — Stats grid ────────────────────────────────── */}
      <ul className={styles.statsGrid}>
        {metrics.map(({ value, label, caption }) => (
          <li key={label} className={styles.statCard}>
            <span className={styles.statValue}>{value}</span>
            <span className={styles.statLabel}>{label}</span>
            <span className={styles.statCaption}>{caption}</span>
          </li>
        ))}
      </ul>

      {/* ── Band 3 — Showcase: capabilities (left) + visual (right) ── */}
      <div className={styles.showcase}>

        <div className={styles.showcaseInfo}>
          <h3 className={styles.capsHeading}>How Sonar protects capital</h3>
          <ul className={styles.capsList}>
            {features.map(({ name, desc }) => (
              <li key={name} className={styles.capsItem}>
                <div className={styles.checkIcon}>
                  <svg viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="6" fill="#4F87FF" />
                    <path d="M4.5 7l2 2 3-3" stroke="white" strokeWidth="1.5"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <p className={styles.capsName}>{name}</p>
                  <p className={styles.capsDesc}>{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.showcaseVisual}>
          <SonarVisual />
          <button type="button" className={styles.ctaBtn} onClick={onContact}>
            <span>Get security agent</span>
            <span className={styles.ctaArrow}>
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>

      </div>

    </section>
  )
}
