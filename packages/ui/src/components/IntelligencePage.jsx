import styles from './ProductPage.module.css'

const SPECS = [
  {
    title: 'Yield Agent',
    desc: 'Continuously scans 56+ yield sources, scores opportunities in real time, and rebalances to maximize risk-adjusted net APY.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="15 7 21 7 21 13" />
      </svg>
    ),
  },
  {
    title: 'Security Agent (Sonar)',
    desc: '6 independent detection layers monitor depegs, liquidity drops, and protocol exploits — with sub-block exit latency.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'Adaptive learning',
    desc: 'Models retrain on live market data — every position outcome refines the agent\'s next decision.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a4 4 0 0 0-3.5 6 4 4 0 0 0 1.5 7v3h4v-3a4 4 0 0 0 1.5-7A4 4 0 0 0 12 3z" />
        <path d="M9 21h6" />
      </svg>
    ),
  },
  {
    title: 'Real-time analytics',
    desc: 'Per-position attribution, fee breakdown, and risk exposure — surfaced through a dashboard and pushed via webhook.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h4l3-9 4 18 3-9h4" />
      </svg>
    ),
  },
  {
    title: 'Configurable risk policy',
    desc: 'Define exposure caps, allowed venues, and slippage tolerances — agents stay strictly inside your guardrails.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    title: 'Battle-tested',
    desc: '$700M in volume across 161,776 autonomous transactions — and zero user losses to date.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12l3-3 4 4 7-7 4 4" />
      </svg>
    ),
  },
]

const KPIS = [
  { v: '$700M',   l: 'Total Volume' },
  { v: '56',      l: 'Yield Sources' },
  { v: '161,776', l: 'Autonomous Transactions' },
]

export default function IntelligencePage({ onBack }) {
  return (
    <div className={styles.page}>
      <div className={styles.bg} />
      <div className={styles.content}>

        <div className={styles.topBar}>
          <a href="/" className={styles.brand}>Sail</a>
          <button className={styles.backBtn} onClick={onBack}>
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
              <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
        </div>

        {/* Hero */}
        <section className={styles.hero}>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowDot} />
            Sail Intelligence
          </div>
          <h1 className={styles.title}>The decisioning layer for autonomous capital</h1>
          <p className={styles.subtitle}>
            Sail Intelligence is the AI brain on top of Sail Protocol. Yield Agent and
            Security Agent (Sonar) work in real time to allocate, rebalance, and protect
            capital across DeFi — outperforming the market with full onchain transparency.
          </p>
          <div className={styles.ctaRow}>
            <button className={styles.ctaPrimary}>
              Talk to sales
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <a className={styles.ctaGhost} href="https://api.sail.money/docs" target="_blank" rel="noopener noreferrer">
              API reference
            </a>
            <a className={styles.ctaGhost} href="https://docs.sail.money" target="_blank" rel="noopener noreferrer">
              View docs
            </a>
          </div>

          {/* KPIs */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            marginTop: 56,
            width: '100%',
            maxWidth: 760,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            {KPIS.map(({ v, l }) => (
              <div key={l} style={{
                padding: '20px 16px',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                textAlign: 'left',
              }}>
                <div style={{
                  fontFamily: "'Instrument Sans', Georgia, serif",
                  fontSize: 'clamp(24px, 3vw, 32px)',
                  letterSpacing: '-0.025em',
                  color: '#fff',
                  marginBottom: 4,
                  lineHeight: 1,
                }}>{v}</div>
                <div style={{
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.5)',
                  fontWeight: 600,
                }}>{l}</div>
              </div>
            ))}
          </div>
        </section>

        <div className={styles.sectionDivider}>
          <div className={styles.line} />
          <span className={styles.text}>How it works</span>
          <div className={styles.line} />
        </div>

        {/* Spec grid */}
        <section className={styles.specSection}>
          <div className={styles.specGrid}>
            {SPECS.map(({ title, desc, icon }) => (
              <div key={title} className={styles.specCard}>
                <div className={styles.specIcon}>{icon}</div>
                <h3 className={styles.specTitle}>{title}</h3>
                <p className={styles.specDesc}>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.footerCta}>
          <h2 className={styles.footerTitle}>Outperform the market — autonomously</h2>
          <p className={styles.footerText}>
            Connect Sail Intelligence to your treasury, vault, or product. We'll run a
            sandbox in days and a production deployment in weeks.
          </p>
          <div className={styles.ctaRow}>
            <button className={styles.ctaPrimary}>Book a demo</button>
            <button className={styles.ctaGhost} onClick={onBack}>Back to home</button>
          </div>
        </section>

      </div>
    </div>
  )
}
