import { useEffect, useRef, useState } from 'react'
import styles from './TechScales.module.css'

/* ── Check icon ────────────────────────────────────────────────── */
function CheckIcon() {
  return (
    <svg className={styles.checkSvg} viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9.25" stroke="rgba(50,220,120,0.5)" strokeWidth="1.5" />
      <path d="M6.5 10.5l2.5 2.5 4.5-5" stroke="rgba(50,220,120,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ── Code terminal visual (Developers) ─────────────────────────── */
function CodeVisual() {
  return (
    <div className={styles.codeWrap}>
      <div className={styles.codeBar}>
        <div className={styles.codeDots}>
          <span style={{ background: '#FF5F57' }} />
          <span style={{ background: '#FEBC2E' }} />
          <span style={{ background: '#28C840' }} />
        </div>
        <span className={styles.codeFile}>sail-api.ts</span>
      </div>
      <div className={styles.codeBody}>
        <div className={styles.lineNum}>
          {[1,2,3,4,5,6,7,8,9,10].map(n => <span key={n}>{n}</span>)}
        </div>
        <pre className={styles.codeText}>
          <span className={styles.ckw}>import</span>{' { Sail } '}<span className={styles.ckw}>from</span>{' '}<span className={styles.cstr}>'@sail/sdk'</span>{'\n\n'}<span className={styles.ckw}>const</span>{' client = '}<span className={styles.ckw}>new</span>{' '}<span className={styles.ccl}>Sail</span>{'({\n  apiKey: '}<span className={styles.cstr}>process.env.SAIL_KEY</span>{'\n})\n\n'}<span className={styles.ckw}>const</span>{' { apy, route } = '}<span className={styles.ckw}>await</span>{'\n  client.'}<span className={styles.cfn}>optimize</span>{'({\n    asset:  '}<span className={styles.cstr}>'USDC'</span>{',\n    amount: '}<span className={styles.cnum}>10_000</span>{'\n  })\n\n'}<span className={styles.ccm}>{'// → { apy: 6.4%, chain: \'Arbitrum\' }'}</span>
        </pre>
      </div>
      <div className={styles.codeGlow} />
    </div>
  )
}

/* ── Browser embed visual (Fintechs) ───────────────────────────── */
function WebVisual() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 2200)
    return () => clearInterval(id)
  }, [])
  const gain = (tick % 3 === 0) ? '+$14.23' : (tick % 3 === 1) ? '+$8.87' : '+$21.40'
  return (
    <div className={styles.webWrap}>
      <div className={styles.browserBar}>
        <div className={styles.browserDots}><span /><span /><span /></div>
        <div className={styles.browserUrl}><span className={styles.urlLock}>🔒</span>app.yourdomain.com/earn</div>
      </div>
      <div className={styles.dashInner}>
        <div className={styles.dashHeader}>
          <span className={styles.dashTitle}>Earn</span>
          <span className={styles.liveBadge}><span className={styles.liveDot} />Live</span>
        </div>
        <div className={styles.dashBalance}>$12,450.00</div>
        <div className={styles.dashApy}>
          <span className={styles.apyNum}>+6.4% APY</span>
          <span className={styles.dashGain} key={tick}>{gain}</span>
        </div>
        <div className={styles.dashBarWrap}><div className={styles.dashBarFill} style={{ width: '64%' }} /></div>
        <div className={styles.dashButtons}>
          <button className={styles.dashBtn}>Deposit</button>
          <button className={`${styles.dashBtn} ${styles.dashBtnSecondary}`}>Withdraw</button>
        </div>
      </div>
    </div>
  )
}

/* ── Portfolio chart visual (Individuals) ──────────────────────── */
function EngineVisual() {
  return (
    <div className={styles.engWrap}>
      <div className={styles.engHeader}>
        <span className={styles.engLabel}>Portfolio Performance</span>
        <span className={styles.engApyBadge}>6.4% APY</span>
      </div>
      <svg className={styles.engChart} viewBox="0 0 340 160" preserveAspectRatio="none">
        <defs>
          <linearGradient id="engFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1990FF" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#1990FF" stopOpacity="0.00" />
          </linearGradient>
          <filter id="engGlow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {[40, 80, 120].map(y => (
          <line key={y} x1="0" y1={y} x2="340" y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        ))}
        <path d="M 0 140 C 60 130, 130 110, 200 82 C 260 58, 300 36, 340 16 L 340 160 L 0 160 Z" fill="url(#engFill)" />
        <path d="M 0 140 C 100 136, 200 130, 340 122" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeDasharray="5 4" />
        <path d="M 0 140 C 60 130, 130 110, 200 82 C 260 58, 300 36, 340 16" fill="none" stroke="#66c2ff" strokeWidth="2.5" strokeLinecap="round" filter="url(#engGlow)" />
        <circle cx="340" cy="16" r="4" fill="#66c2ff" />
        <circle cx="340" cy="16" r="8" fill="#66c2ff" fillOpacity="0.18" />
      </svg>
      <div className={styles.engLegend}>
        <span className={styles.engLegItem}><span style={{ background: '#66c2ff' }} className={styles.engDot} /> Sail 6.4%</span>
        <span className={styles.engLegItem}><span style={{ background: 'rgba(255,255,255,0.3)' }} className={styles.engDot} /> Market 3.8%</span>
      </div>
    </div>
  )
}

/* ── Row data ───────────────────────────────────────────────────── */
const rows = [
  {
    label: 'For Developers',
    title: 'Build financial products without the overhead.',
    desc: 'Integrate institutional-grade yield optimization into any product with a single API call. Full TypeScript support, webhooks, and real-time events.',
    bullets: [
      { text: 'One API call to optimize yield', muted: false },
      { text: 'TypeScript SDK with full docs',   muted: false },
      { text: 'Webhooks & real-time events',     muted: true  },
    ],
    Visual: CodeVisual,
  },
  {
    label: 'For Fintechs',
    title: 'Embed a yield layer in minutes, not months.',
    desc: 'A fully configurable widget your users interact with directly. Deploy in minutes, customize to match your brand — your users never leave your product.',
    bullets: [
      { text: 'White-label embed',               muted: false },
      { text: 'Custom branding & theming',        muted: false },
      { text: 'Compliance handled for you',       muted: true  },
    ],
    Visual: WebVisual,
  },
  {
    label: 'For Individuals',
    title: 'Earn more without the complexity.',
    desc: 'Your AI agent continuously monitors and reallocates your stablecoin portfolio across 200+ yield protocols — automatically, securely, 24/7.',
    bullets: [
      { text: 'Up to 20% APY on stablecoins',    muted: false },
      { text: 'Auto-rebalancing around the clock', muted: false },
      { text: 'Non-custodial & fully secure',     muted: true  },
    ],
    Visual: EngineVisual,
  },
]

/* ── Single row ─────────────────────────────────────────────────── */
function AudienceRow({ row, index }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  const reversed = index % 2 === 1

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(true) },
      { threshold: 0.15 }
    )
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`${styles.row} ${reversed ? styles.rowReverse : ''} ${visible ? styles.rowVisible : ''}`}
      style={{ '--delay': `${index * 0.08}s` }}
    >
      {/* Text column */}
      <div className={styles.textCol}>
        <span className={styles.rowLabel}>{row.label}</span>
        <h3 className={styles.rowTitle}>{row.title}</h3>
        <p className={styles.rowDesc}>{row.desc}</p>
        <ul className={styles.bullets}>
          {row.bullets.map((b, i) => (
            <li key={i} className={`${styles.bullet} ${b.muted ? styles.bulletMuted : ''}`}>
              <CheckIcon />
              {b.text}
            </li>
          ))}
        </ul>
      </div>

      {/* Visual column */}
      <div className={styles.visualCol}>
        <row.Visual />
      </div>
    </div>
  )
}

/* ── Section ────────────────────────────────────────────────────── */
export default function TechScales() {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        {rows.map((row, i) => (
          <AudienceRow key={i} row={row} index={i} />
        ))}
      </div>
    </section>
  )
}
