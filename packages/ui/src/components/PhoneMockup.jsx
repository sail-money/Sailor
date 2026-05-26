import { useEffect, useRef, useState } from 'react'
import styles from './PhoneMockup.module.css'
import Button from './Button'

function useCountUp(target, duration, started, key) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!started) return
    setValue(0)
    let start = null
    const step = (ts) => {
      if (!start) start = ts
      const progress = Math.min((ts - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.floor(eased * target))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [started, target, duration, key])
  return value
}

const POSITIONS = [
  { name: 'Aave USDC',      protocol: 'aave',     apy: 5.1, color: '#B6509E' },
  { name: 'Fluid USDC',     protocol: 'fluid',    apy: 4.8, color: '#66c2ff' },
  { name: 'Moonwell USDC',  protocol: 'moonwell', apy: 4.6, color: '#7B4EFF' },
  { name: 'Compound USDC',  protocol: 'compound', apy: 4.3, color: '#00D395' },
  { name: 'Morpho Moonwell', protocol: 'morpho',  apy: 5.2, color: '#2470FF' },
]

const HISTORY_ITEMS = [
  { id: 1, type: 'adjustment', time: '02:12 PM', message: "Made minor adjustments. Everything's running smoothly.", earnings: '$0.019' },
  { id: 2, type: 'rebalance',  time: '01:12 PM', message: "Funds are better distributed now.",                      earnings: '$0.020' },
  { id: 3, type: 'withdrawal', time: '12:13 PM', message: "Withdrew assets to optimize positions.",                  earnings: '$0.019' },
  { id: 4, type: 'deposit',    time: '11:45 AM', message: "Deposited across protocols for optimal yield.",            earnings: '€0.031' },
]

const HIST_META = {
  adjustment: { label: 'Adjustment', color: 'rgba(90,173,255,1)',  bg: 'rgba(0,85,255,0.18)'   },
  rebalance:  { label: 'Rebalance',  color: 'rgba(90,173,255,1)',  bg: 'rgba(0,85,255,0.18)'   },
  withdrawal: { label: 'Withdrawal', color: 'rgba(255,165,60,1)',  bg: 'rgba(255,140,0,0.18)'  },
  deposit:    { label: 'Deposit',    color: 'rgba(50,220,120,1)',  bg: 'rgba(50,200,100,0.18)' },
}

function HistoryWidget() {
  return (
    <div className={styles.histWidget}>
      {HISTORY_ITEMS.map(item => {
        const meta = HIST_META[item.type]
        return (
          <div key={item.id} className={styles.histItem}>
            <div className={styles.histItemTop}>
              <span className={styles.histBadge} style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>
              <span className={styles.histTime}>{item.time}</span>
            </div>
            <p className={styles.histMsg}>{item.message}</p>
            <span className={styles.histEarnings}>{item.earnings}</span>
          </div>
        )
      })}
    </div>
  )
}

function AgentStatusWidget({ started, hovered, animKey }) {
  const balance = useCountUp(42800, 1600, started || hovered, animKey)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 3200)
    return () => clearInterval(id)
  }, [])
  const gains = ['+$14.20', '+$8.87', '+$21.40']

  return (
    <div className={styles.agentWidget}>
      <div className={styles.agentWTop}>
        <div className={styles.agentWBrand}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.07 4.93A10 10 0 0 1 21 12a10 10 0 0 1-1.93 5.07M4.93 19.07A10 10 0 0 1 3 12a10 10 0 0 1 1.93-5.07"/>
          </svg>
          Sail Agent
        </div>
        <span className={styles.agentWLive}><span className={styles.dot}/>Live</span>
      </div>

      <div className={styles.agentWPortfolio}>
        <span className={styles.agentWPortLabel}>Portfolio</span>
        <span className={styles.agentWPortVal}>${balance.toLocaleString()}.00</span>
        <div className={styles.agentWPortMeta}>
          <span className={styles.agentWApy}>▲ 4.8% APY</span>
          <span className={styles.agentWGain} key={tick}>{gains[tick % 3]} today</span>
        </div>
      </div>

      <div className={styles.agentWSection}>
        <span className={styles.agentWSectionLabel}>
          Positions ({POSITIONS.length}){' '}
          <span style={{ fontWeight: 400, opacity: 0.55 }}>· Base · Arbitrum</span>
        </span>
        {POSITIONS.map((pos, i) => (
          <div key={i} className={styles.agentWPos}>
            <span className={styles.agentWPosDot} style={{ background: pos.color }}/>
            <span className={styles.agentWPosName}>{pos.name}</span>
            <div className={styles.agentWPosBar}>
              <div className={styles.agentWPosBarFill} style={{ width: `${Math.min((pos.apy / 8) * 100, 100)}%`, background: pos.color + 'AA' }}/>
            </div>
            <span className={styles.agentWPosApy}>{pos.apy}%</span>
          </div>
        ))}
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>USDC</span>
      </div>

      <div className={styles.agentWAction}>
        <span className={styles.agentWSectionLabel}>Last Rebalance · 3h ago</span>
        <div className={styles.agentWActionRow}>
          <span>Base → Arbitrum</span>
          <span className={styles.agentWActionGain}>+0.4% APY</span>
        </div>
      </div>

      <button className={styles.widgetBtn}>Configure Agent</button>
    </div>
  )
}

function PhoneMockup({ onOpenApi }) {
  const sectionRef = useRef(null)
  const [started, setStarted] = useState(false)
  const [hovered, setHovered]  = useState(false)
  const [animKey, setAnimKey]  = useState(0)
  const [tab, setTab]          = useState('portfolio')

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setStarted(true); obs.disconnect() } },
      { threshold: 0.3 }
    )
    if (sectionRef.current) obs.observe(sectionRef.current)
    return () => obs.disconnect()
  }, [])

  const handleMouseEnter = () => { setHovered(true); setAnimKey(k => k + 1) }
  const handleMouseLeave = () => setHovered(false)

  return (
    <section className={styles.section} ref={sectionRef}>
      <div className={`${styles.container} ${started ? styles.visible : ''}`}>

        {/* ── Left copy ── */}
        <div className={styles.copy}>
          <h2 className={styles.title}>Your brand.<br />Sail's engine.</h2>
          <p className={styles.subtitle}>
            Embed a fully functional yield and personalization layer directly in your app. Your users never leave your product.
          </p>

          <ul className={styles.bullets}>
            {[
              'No custom UI to design or maintain',
              'White-label — your colors, your logo',
              'Non-custodial, audited protocols only',
              'Live in your app in under a day',
            ].map((item, i) => (
              <li key={i} className={styles.bullet}>
                <span className={styles.bulletCheck}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5L8 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>

          <div className={styles.actions}>
            <Button variant="primary" magnetic>Book a Demo</Button>
            <button className={styles.link} onClick={onOpenApi}>Try the API →</button>
          </div>

          <p className={styles.disclaimer}>
            <span className={styles.liveDot} />
            This is a live product. Add it to your app in minutes.
          </p>
        </div>

        {/* ── Right: phone mockup ── */}
        <div
          className={styles.phoneWrap}
          onClick={onOpenApi}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: 'pointer' }}
        >
          <div className={styles.phoneGlow} />

          <div className={styles.appFrame}>
            {/* Status bar */}
            <div className={styles.statusBar}>
              <span className={styles.statusTime}>9:41</span>
              <div className={styles.statusIcons}>
                <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <rect x="0" y="6" width="2.5" height="5" rx="0.7" />
                  <rect x="4" y="4" width="2.5" height="7" rx="0.7" />
                  <rect x="8" y="1.5" width="2.5" height="9.5" rx="0.7" />
                  <rect x="12" y="0" width="2.5" height="11" rx="0.7" />
                </svg>
                <svg width="13" height="10" viewBox="0 0 20 14" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M1 4.5C5 1 8.5 0 10 0s5 1 9 4.5" />
                  <path d="M3.5 7.5C6 5.5 8 5 10 5s4 .5 6.5 2.5" />
                  <path d="M6.5 10.5C8 9.5 9 9 10 9s2 .5 3.5 1.5" />
                  <circle cx="10" cy="13.5" r="1.2" fill="rgba(255,255,255,0.7)" stroke="none" />
                </svg>
                <svg width="22" height="11" viewBox="0 0 25 12" fill="none">
                  <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />
                  <rect x="22" y="3.5" width="2.5" height="5" rx="1.5" fill="rgba(255,255,255,0.3)" />
                  <rect x="2" y="2" width="15" height="8" rx="2" fill="rgba(255,255,255,0.7)" />
                </svg>
              </div>
            </div>

            {/* Scrollable content + bottom nav */}
            <div className={styles.appContent}>
              <div className={styles.phoneScreen}>
                {tab === 'portfolio'
                  ? <AgentStatusWidget started={started} hovered={hovered} animKey={animKey} />
                  : <HistoryWidget />}
              </div>
              <div className={styles.bottomNavWrap}>
                <div className={styles.bottomNav}>
                  <button
                    className={`${styles.bottomNavItem} ${tab === 'portfolio' ? styles.bottomNavItemActive : ''}`}
                    onClick={e => { e.stopPropagation(); setTab('portfolio') }}
                  >Portfolio</button>
                  <button
                    className={`${styles.bottomNavItem} ${tab === 'history' ? styles.bottomNavItemActive : ''}`}
                    onClick={e => { e.stopPropagation(); setTab('history') }}
                  >History</button>
                </div>
                <div className={styles.homeIndicator} />
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  )
}

export default PhoneMockup
