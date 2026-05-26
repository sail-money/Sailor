import { useRef, useEffect, useState } from 'react'
import styles from './OptimizationEngine.module.css'

/* Y-axis grid: 3% bottom → 9% top inside viewBox 0 0 800 300 (1% ≈ 41.67 units) */
const GRID = [
  { pct: '3%', y: 272    },
  { pct: '5%', y: 188.67 },
  { pct: '7%', y: 105.33 },
  { pct: '9%', y: 22     },
]

const X_LABELS = [
  { l: 'Oct ’25', q: 'Q4 2025' },
  { l: 'Nov',         q: '' },
  { l: 'Dec',         q: '' },
  { l: 'Jan ’26', q: 'Q1 2026' },
  { l: 'Feb',         q: '' },
  { l: 'Mar',         q: '' },
  { l: 'Now',         q: '' },
]

const METRICS = [
  {
    value: '$700M',
    label: 'AUM routed',
    caption: 'Across all integrated venues',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 17l5-5 4 4 7-7" />
        <path d="M14 9h6v6" />
      </svg>
    ),
  },
  {
    value: '56',
    label: 'Yield sources',
    caption: 'Audited & onboarded',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    ),
  },
  {
    value: '161,776',
    label: 'Autonomous txns',
    caption: 'Executed without human input',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
    ),
  },
  {
    value: '2 / 2',
    label: 'Quarters beating market',
    caption: 'Q4 2025 — Q1 2026',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 21h8M12 17v4M6 3h12v6a6 6 0 0 1-12 0V3z" />
        <path d="M18 5h2a2 2 0 0 1 0 4h-2M6 5H4a2 2 0 0 0 0 4h2" />
      </svg>
    ),
  },
]

function easeOutCubic(t) { return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3) }

function CountUp({ to, prefix = '', suffix = '', duration = 1600, format = 'plain' }) {
  const [val, setVal] = useState(0)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    const t0 = performance.now()
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1)
      setVal(Math.floor(to * easeOutCubic(p)))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [to, duration])

  const display = format === 'comma'
    ? val.toLocaleString()
    : val
  return <>{prefix}{display}{suffix}</>
}

export default function OptimizationEngine({ onContact }) {
  const sectionRef = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); clearTimeout(fallback) } },
      { threshold: 0, rootMargin: '200px 0px 200px 0px' }
    )
    obs.observe(el)
    const fallback = setTimeout(() => setVisible(true), 1200)
    return () => { obs.disconnect(); clearTimeout(fallback) }
  }, [])

  return (
    <section
      ref={sectionRef}
      className={`${styles.section} ${visible ? styles.visible : ''}`}
    >
      <div className={styles.container}>

        {/* Header */}
        <div className={styles.header}>
          <span className={styles.label}>
            <span className={styles.labelDot} />
            Sail Intelligence
          </span>
          <h2 className={styles.title}>Yield Agent</h2>
          <p className={styles.subtitle}>
            Autonomous yield management under bounded delegation.
          </p>
        </div>

        {/* Chart card */}
        <div className={styles.chartCard}>

          {/* APY overlay */}
          <div className={styles.apyOverlay}>
            <div className={styles.apyItem}>
              <span className={styles.apyLabel}>Sail vs Best static · Q4 2025</span>
              <div className={styles.apyCompare}>
                <span className={styles.apyValue}>8.91%</span>
                <span className={styles.apyVs}>vs <span className={styles.apyVsValue}>8.45%</span></span>
                <span className={styles.apyDelta}>+5.43%</span>
              </div>
            </div>
            <div className={styles.apyDivider} />
            <div className={styles.apyItem}>
              <span className={styles.apyLabel}>Sail vs Best static · Q1 2026</span>
              <div className={styles.apyCompare}>
                <span className={styles.apyValue}>6.06%</span>
                <span className={styles.apyVs}>vs <span className={styles.apyVsValue}>5.80%</span></span>
                <span className={styles.apyDelta}>+4.48%</span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className={styles.legend}>
            <div className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: '#66c2ff' }} />
              Sail
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: '#f5b942' }} />
              Best static
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: '#8a99b3' }} />
              T-Bills
            </div>
          </div>

          <svg
            className={styles.chart}
            viewBox="0 0 800 300"
            preserveAspectRatio="none"
            aria-label="Sail vs Best static vs T-Bills APY, Q4 2025 to Q1 2026"
          >
            <defs>
              <linearGradient id="sailFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#1990FF" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#1990FF" stopOpacity="0.01" />
              </linearGradient>
              <filter id="sailGlow" x="-20%" y="-40%" width="140%" height="180%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Horizontal grid */}
            {GRID.map(({ pct, y }) => (
              <g key={pct}>
                <line x1="56" y1={y} x2="800" y2={y}
                  stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                <text x="48" y={y + 4} textAnchor="end" fontSize="10"
                  fill="rgba(255,255,255,0.28)" fontFamily="Inter, sans-serif">{pct}</text>
              </g>
            ))}

            {/* Quarter divider — between Dec and Jan (x = 428) */}
            <line x1="428" y1="20" x2="428" y2="272"
              stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3 4" />
            <text x="240" y="36" fontSize="10" fontFamily="Inter, sans-serif"
              letterSpacing="0.16em" fill="rgba(255,255,255,0.45)">Q4 2025</text>
            <text x="610" y="36" fontSize="10" fontFamily="Inter, sans-serif"
              letterSpacing="0.16em" fill="rgba(102,194,255,0.78)">Q1 2026</text>

            {/* ── Sail (8.91% → 6.06%) ── 3%–9% scale, y: 25.73 → 144.49 ── */}
            <path
              d="M 56 25.73 L 360 25.73 C 400 25.73, 460 144.49, 500 144.49 L 800 144.49 L 800 272 L 56 272 Z"
              fill="url(#sailFill)"
            />
            <path
              d="M 56 25.73 L 360 25.73 C 400 25.73, 460 144.49, 500 144.49 L 800 144.49"
              fill="none"
              stroke="#2B80FF"
              strokeWidth="2.5"
              strokeLinecap="round"
              filter="url(#sailGlow)"
            />
            <path
              d="M 56 25.73 L 360 25.73 C 400 25.73, 460 144.49, 500 144.49 L 800 144.49"
              fill="none"
              stroke="#66c2ff"
              strokeWidth="2"
              strokeLinecap="round"
            />

            {/* ── Best static (8.45% → 5.80%) ── y: 44.90 → 155.32 ── */}
            <path
              d="M 56 44.90 L 360 44.90 C 400 44.90, 460 155.32, 500 155.32 L 800 155.32"
              fill="none"
              stroke="#f5b942"
              strokeWidth="1.8"
              strokeOpacity="0.85"
              strokeLinecap="round"
            />

            {/* ── T-Bills (3.98% → 4.20%) ── y: 231.16 → 222 ── */}
            <path
              d="M 56 231.16 L 360 231.16 C 400 231.16, 460 222, 500 222 L 800 222"
              fill="none"
              stroke="#8a99b3"
              strokeWidth="1.8"
              strokeOpacity="0.75"
              strokeDasharray="6 5"
              strokeLinecap="round"
            />

          </svg>

          <div className={styles.xAxis}>
            {X_LABELS.map(({ l }) => <span key={l}>{l}</span>)}
          </div>
        </div>

        {/* Metrics row */}
        <div className={styles.metricsRow}>
          {METRICS.map((m, i) => (
            <div key={m.label} className={styles.metricCard}>
              <div className={styles.metricAccent} aria-hidden="true" />
              <span className={styles.metricLabel}>{m.label}</span>
              <div className={styles.metricValue}>
                {visible
                  ? (i === 0 ? <><span className={styles.metricPrefix}>$</span><CountUp to={700} suffix="M" /></>
                    : i === 1 ? <CountUp to={56} />
                    : i === 2 ? <CountUp to={161776} format="comma" />
                    : <><CountUp to={2} /><span className={styles.metricSuffix}> / 2</span></>)
                  : (i === 0 ? '$0M' : i === 1 ? '0' : i === 2 ? '0' : '0 / 2')}
              </div>
              <div className={styles.metricCaption}>{m.caption}</div>
            </div>
          ))}
        </div>

        {/* CTA band */}
        <div className={styles.ctaBand}>
          <div className={styles.ctaDivider} aria-hidden="true">
            <span>Ready to integrate?</span>
          </div>
          <button type="button" className={styles.agentCta} onClick={onContact}>
            <span>Get yield agent</span>
            <span className={styles.agentCtaArrow}>
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
