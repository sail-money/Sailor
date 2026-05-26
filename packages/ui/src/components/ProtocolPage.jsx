import styles from './ProductPage.module.css'

const SPECS = [
  {
    title: 'Self-custodial accounts',
    desc: 'Every Sail account is a non-custodial smart wallet (SMA). Capital never leaves user-owned addresses.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="10" width="16" height="10" rx="2.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    ),
  },
  {
    title: 'Policy-enforced execution',
    desc: 'Allowlists, risk caps, and exposure rules enforced onchain — agents can only act within the policy you configure.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'Composable API',
    desc: 'Single SDK for SMA provisioning, intent routing, settlement, and reporting — drop into any stack in days.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 8l-4 4 4 4" />
        <path d="M17 8l4 4-4 4" />
        <path d="M14 4l-4 16" />
      </svg>
    ),
  },
  {
    title: 'Multi-chain settlement',
    desc: 'Native execution across Base, Arbitrum, and Ethereum — with unified accounting and instant rebalances.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a13 13 0 0 1 0 18" />
        <path d="M12 3a13 13 0 0 0 0 18" />
      </svg>
    ),
  },
  {
    title: 'Institutional reporting',
    desc: 'Real-time NAV, attribution, and audit-ready records — exposed via API and configurable webhooks.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 8h10M7 12h6M7 16h8" />
      </svg>
    ),
  },
  {
    title: 'Onchain transparency',
    desc: 'Every position, action, and policy decision is verifiable onchain — no opaque off-chain custody.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M2 12C4 7 8 4 12 4s8 3 10 8c-2 5-6 8-10 8S4 17 2 12z" />
      </svg>
    ),
  },
]

export default function ProtocolPage({ onBack }) {
  return (
    <div className={styles.page}>
      <div className={styles.bg} />
      <div className={styles.content}>

        {/* Top bar */}
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
            Sail Protocol
          </div>
          <h1 className={styles.title}>Onchain rails for autonomous capital</h1>
          <p className={styles.subtitle}>
            Sail Protocol is the institutional-grade settlement layer powering every
            agent on Sail. Self-custodial accounts, policy-enforced execution, and
            verifiable onchain accounting — exposed through one composable API.
          </p>
          <div className={styles.ctaRow}>
            <button className={styles.ctaPrimary}>
              Request access
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <a className={styles.ctaGhost} href="https://docs.sail.money" target="_blank" rel="noopener noreferrer">
              Read documentation
            </a>
          </div>
        </section>

        <div className={styles.sectionDivider}>
          <div className={styles.line} />
          <span className={styles.text}>What you get</span>
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

        {/* Footer CTA */}
        <section className={styles.footerCta}>
          <h2 className={styles.footerTitle}>Built for institutions</h2>
          <p className={styles.footerText}>
            Curators, treasuries, and neobanks deploy Sail Protocol to launch
            yield products in days — not quarters.
          </p>
          <div className={styles.ctaRow}>
            <button className={styles.ctaPrimary}>Talk to sales</button>
            <button className={styles.ctaGhost} onClick={onBack}>Back to home</button>
          </div>
        </section>

      </div>
    </div>
  )
}
