import { useEffect, useState, useRef } from 'react'
import { useInView } from '../hooks/useInView'
import styles from './WebAgentSection.module.css'

const REFERRAL_CODES = ['0XSAIL', '3KWAVE', '7FNOVA', '2BDRIFT', '9XVAULT', '4MTIDE', '1ZORBIT', '6CFLUX', '8WBLAZE', '5YNEXUS']

function useCodeTypewriter(codes, typingSpeed = 90, deletingSpeed = 55, pauseMs = 1600) {
  const [display, setDisplay] = useState(codes[0])
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState('pausing')

  useEffect(() => {
    const word = codes[idx]
    if (phase === 'pausing') {
      const t = setTimeout(() => setPhase('deleting'), pauseMs)
      return () => clearTimeout(t)
    }
    if (phase === 'deleting') {
      if (display.length > 0) {
        const t = setTimeout(() => setDisplay(d => d.slice(0, -1)), deletingSpeed)
        return () => clearTimeout(t)
      } else {
        setIdx(i => (i + 1) % codes.length)
        setPhase('typing')
      }
    }
    if (phase === 'typing') {
      if (display.length < word.length) {
        const t = setTimeout(() => setDisplay(word.slice(0, display.length + 1)), typingSpeed)
        return () => clearTimeout(t)
      } else {
        setPhase('pausing')
      }
    }
  }, [display, phase, idx, codes, typingSpeed, deletingSpeed, pauseMs])

  return display
}

/* ── Animated activity feed ── */
const MESSAGES = [
  { id: 1, text: 'Hey, allocated capital through deposits and closed a few positions. Funds are better distributed now.', time: '11:51 AM', hasTx: true },
  { id: 2, text: "Hey, made minor adjustments. Everything's running smoothly.", time: '09:51 AM', hasTx: false },
  { id: 3, text: 'Hello, freed up capital from positions as part of rebalancing and placed some assets into deposit positions. Portfolio positions are adjusted efficiently.', time: '07:51 AM', hasTx: true },
  { id: 4, text: "Hello, made minor adjustments. Everything's running smoothly.", time: '05:50 AM', hasTx: false },
  { id: 5, text: 'Hey there, shifted a few funds into deposits and pulled back some allocations to improve allocation efficiency. Looks good overall.', time: '03:51 AM', hasTx: true },
]

function AgentMockup() {
  const [ref, started] = useInView(0.2)
  const [visible, setVisible] = useState([])

  useEffect(() => {
    if (!started) return
    const timers = MESSAGES.map((msg, i) =>
      setTimeout(() => setVisible(v => [...v, msg.id]), i * 420)
    )
    return () => timers.forEach(clearTimeout)
  }, [started])

  return (
    <div className={styles.appFrame} ref={ref}>
      {/* Status bar */}
      <div className={styles.statusBar}>
        <span className={styles.statusTime}>9:41</span>
        <div className={styles.statusIcons}>
          <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor" style={{ color: 'rgba(255,255,255,0.7)' }}>
            <rect x="0" y="6" width="2.5" height="5" rx="0.7"/>
            <rect x="4" y="4" width="2.5" height="7" rx="0.7"/>
            <rect x="8" y="1.5" width="2.5" height="9.5" rx="0.7"/>
            <rect x="12" y="0" width="2.5" height="11" rx="0.7"/>
          </svg>
          <svg width="13" height="10" viewBox="0 0 20 14" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M1 4.5C5 1 8.5 0 10 0s5 1 9 4.5"/>
            <path d="M3.5 7.5C6 5.5 8 5 10 5s4 .5 6.5 2.5"/>
            <path d="M6.5 10.5C8 9.5 9 9 10 9s2 .5 3.5 1.5"/>
            <circle cx="10" cy="13.5" r="1.2" fill="rgba(255,255,255,0.7)" stroke="none"/>
          </svg>
          <svg width="22" height="11" viewBox="0 0 25 12" fill="none">
            <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="rgba(255,255,255,0.45)" strokeWidth="1"/>
            <rect x="22" y="3.5" width="2.5" height="5" rx="1.5" fill="rgba(255,255,255,0.3)"/>
            <rect x="2" y="2" width="15" height="8" rx="2" fill="rgba(255,255,255,0.7)"/>
          </svg>
        </div>
      </div>

      {/* App header */}
      <div className={styles.mockupAppHeader}>
        <div className={styles.mockupAppTitle}>
          <span className={styles.mockupAppName}>Sail Agent</span>
          <span className={styles.mockupLiveChip}><span className={styles.liveDot} />Live</span>
        </div>
        <div className={styles.mockupAvatar}>S</div>
      </div>

      {/* Tabs */}
      <div className={styles.mockupTabs}>
        <button className={`${styles.mockupTab} ${styles.mockupTabActive}`}>Executions</button>
        <button className={styles.mockupTab}>Deposits</button>
      </div>

      {/* Date chip */}
      <div className={styles.mockupDateRow}>
        <span className={styles.mockupDate}>Today</span>
      </div>

      {/* Feed */}
      <div className={styles.mockupFeed}>
        {MESSAGES.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.mockupMsg} ${visible.includes(msg.id) ? styles.mockupMsgVisible : ''}`}
          >
            <div className={styles.mockupMsgRow}>
              <p className={styles.mockupMsgText}>{msg.text}</p>
              <span className={styles.mockupMsgTime}>{msg.time}</span>
            </div>
            {msg.hasTx && (
              <div className={styles.mockupTxBadge}>
                Transaction List
                <svg viewBox="0 0 12 12" fill="none" width="9" height="9">
                  <rect x="1" y="1" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1"/>
                  <rect x="7" y="1" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1"/>
                  <rect x="1" y="7" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1"/>
                  <rect x="7" y="7" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1"/>
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Home indicator */}
      <div className={styles.homeIndicator} />
    </div>
  )
}

/* ── Tier data ── */
const TIERS = [
  {
    id: 'silver',
    name: 'Silver',
    range: '$100 – $10,000',
    color: '#B8C9D4',
    cta: 'Get Silver',
    features: [
      { label: 'Executions', value: '4× / day' },
      { label: 'Networks', value: 'Base · Arbitrum' },
      { label: 'Stablecoins', value: 'USDC · USDT' },
      { label: 'Positions', value: '1 per stablecoin / network' },
      { label: 'Security', value: 'Sonar Agent Active' },
      { label: 'Swaps & Bridges', value: 'Enabled for $1k+' },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    range: '$10,000 – $100,000',
    color: '#F5C842',
    cta: 'Get Gold',
    features: [
      { label: 'Executions', value: '12× / day' },
      { label: 'Networks', value: 'Base · Arbitrum' },
      { label: 'Stablecoins', value: 'USDC · USDT' },
      { label: 'Positions', value: 'Up to 4 per stablecoin / network' },
      { label: 'Security', value: 'Sonar Agent Active' },
      { label: 'Diversification', value: 'Enabled' },
      { label: 'Swaps & Bridges', value: 'Enabled' },
    ],
  },
  {
    id: 'platinum',
    name: 'Platinum',
    range: '$100,000+',
    color: '#8BB8FF',
    cta: 'Get Platinum',
    features: [
      { label: 'Executions', value: '24× / day' },
      { label: 'Networks', value: 'Base · Arbitrum' },
      { label: 'Stablecoins', value: 'USDC · USDT' },
      { label: 'Positions', value: 'Up to 5 per stablecoin / network' },
      { label: 'Security', value: 'Sonar Agent Active' },
      { label: 'Diversification', value: 'Enabled' },
      { label: 'Swaps & Bridges', value: 'Enabled' },
      { label: 'Coming soon', value: 'More features' },
    ],
  },
]

/* ── Tier card ── */
function TierCard({ tier, index }) {
  const [ref, vis] = useInView(0.1)
  return (
    <div
      ref={ref}
      className={`${styles.tierCard} ${styles[`tier_${tier.id}`]} ${vis ? styles.tierCardVisible : ''}`}
      style={{ '--c': tier.color, '--delay': `${index * 140}ms` }}
    >
      {tier.popular && <div className={styles.tierPopular}>Most Popular</div>}

      <div className={styles.tierTop}>
        <span className={styles.tierName}>{tier.name}</span>
        <span className={styles.tierRange}>{tier.range}</span>
      </div>

      <p className={styles.tierWhatYouGet}>What you get</p>

      <ul className={styles.tierFeatures}>
        {tier.features.map((f) => (
          <li key={f.label + f.value} className={`${styles.tierFeature} ${!f.label ? styles.tierFeatureComingSoon : ''}`}>
            <svg className={styles.tierFeatureCheck} viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" opacity="0.35"/>
              <path d="M5 8.5l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {f.label
              ? <><span className={styles.tierFeatureLabel}>{f.label}</span><span className={styles.tierFeatureValue}>{f.value}</span></>
              : <span className={styles.tierFeatureValue} style={{ color: `var(--c)`, opacity: 0.6, fontStyle: 'italic' }}>{f.value}</span>
            }
          </li>
        ))}
      </ul>

      <button className={styles.tierCta}>{tier.cta}</button>
    </div>
  )
}

/* ── Personalization section ── */
const PROTOCOLS = [
  { name: 'ExtraFi',  apy: '6.1', color: '#3b82f6', tags: 'morpho · gauntlet · USDC · Base',  on: true  },
  { name: 'Prime',    apy: '5.6', color: '#8b5cf6', tags: 'morpho · gauntlet · USDC · Base',  on: true  },
  { name: 'Frontier', apy: '5.6', color: '#06b6d4', tags: 'morpho · gauntlet · USDC · Base',  on: true  },
  { name: 'Seamless', apy: '5.4', color: '#10b981', tags: 'morpho · gauntlet · USDC · Base',  on: false },
  { name: 'Core',     apy: '5.4', color: '#f59e0b', tags: 'morpho · gauntlet · USDC · Base',  on: true  },
  { name: 'Core',     apy: '5.3', color: '#f59e0b', tags: 'morpho · gauntlet · USDC · Arbit', on: true  },
  { name: 'Prime',    apy: '4.6', color: '#8b5cf6', tags: 'morpho · gauntlet · USDC · Arbit', on: false },
  { name: 'Aave',     apy: '3.6', color: '#9333ea', tags: 'aave · USDC · Base',               on: false },
]

function CfgToggle({ on, onChange }) {
  return (
    <button
      className={`${styles.cfgToggle} ${on ? styles.cfgToggleOn : ''}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    >
      <div className={styles.cfgThumb} />
    </button>
  )
}

function PermissionsView() {
  const [protocols, setProtocols] = useState(PROTOCOLS.map(p => ({ ...p })))
  const toggle = i => setProtocols(ps => ps.map((p, idx) => idx === i ? { ...p, on: !p.on } : p))
  const enabledCount = protocols.filter(p => p.on).length
  return (
    <div className={styles.cfgPanel}>
      <div className={styles.cfgCard}>
        <div className={styles.cfgCardHead}>
          <div style={{ flex: 1 }}>
            <h4 className={styles.cfgTitle}>Yield Sources</h4>
            <p className={styles.cfgDesc}>Choose which protocols your agent can allocate to</p>
          </div>
          <span className={styles.cfgActiveBadge}>{enabledCount} active</span>
        </div>
        <div className={styles.cfgYieldFilters}>
          {['Curators', 'Protocols'].map(f => (
            <button key={f} className={styles.cfgFilterBtn}>
              {f}
              <svg viewBox="0 0 10 6" fill="none" width="9" height="9"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </button>
          ))}
          <div className={styles.cfgSelectBtns}>
            <button className={styles.cfgSelectBtn} onClick={() => setProtocols(ps => ps.map(p => ({ ...p, on: true })))}>Select All</button>
            <button className={styles.cfgSelectBtn} onClick={() => setProtocols(ps => ps.map(p => ({ ...p, on: false })))}>Unselect All</button>
          </div>
        </div>
        <div className={styles.cfgYieldGrid}>
          {protocols.map((p, i) => (
            <div key={i} className={`${styles.ysCard} ${p.on ? styles.ysCardOn : ''}`} onClick={() => toggle(i)}>
              <div className={styles.ysLogoStack}>
                <div className={styles.ysAssetCircle} style={{ background: p.color }}>{p.name[0]}</div>
                <div className={styles.ysChainBadge} style={{ background: p.tags.includes('Arbit') ? '#28A0F0' : '#7C3AED' }}>
                  {p.tags.includes('Arbit') ? 'A' : 'B'}
                </div>
              </div>
              <div className={styles.ysBody}>
                <span className={styles.ysAPY}>{p.apy}% APY</span>
                <span className={styles.ysName}>{p.name}</span>
                <div className={styles.ysTags}>
                  {p.tags.split(' · ').map((t, j) => <span key={j} className={styles.ysTag}>{t}</span>)}
                </div>
              </div>
              <CfgToggle on={p.on} onChange={() => toggle(i)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const STRATEGY_RISKS = [
  { label: 'Conservative', sub: 'Audited only' },
  { label: 'Balanced',     sub: 'Mixed yield/risk' },
  { label: 'Aggressive',   sub: 'Higher yield' },
]
const STRATEGY_FREQS = [
  { label: '4× / day',  sub: 'Low gas cost' },
  { label: '12× / day', sub: 'Balanced' },
  { label: '24× / day', sub: 'Max responsive' },
]

function StrategyView() {
  const [risk, setRisk] = useState(1)
  const [freq, setFreq] = useState(1)
  const [threshold, setThreshold] = useState(30)
  const [autoRebal, setAutoRebal] = useState(true)
  const [slippage, setSlippage] = useState(true)
  return (
    <div className={styles.cfgPanel}>
      <div className={styles.comingSoonBanner}>
        <span className={styles.comingSoonBadge}>Coming Soon</span>
        <p className={styles.comingSoonText}>Full strategy customization is on the way. Soon you'll be able to configure risk tolerance, execution frequency, and rebalancing rules directly from the app.</p>
      </div>
      <div className={styles.cfgCard}>
        <div className={styles.cfgCardHead}>
          <div>
            <h4 className={styles.cfgTitle}>Risk Tolerance</h4>
            <p className={styles.cfgDesc}>How your agent weighs yield against protocol risk</p>
          </div>
        </div>
        <div className={styles.cfgDivModes}>
          {STRATEGY_RISKS.map(({ label, sub }, i) => (
            <button key={label} className={`${styles.cfgDivCard} ${risk === i ? styles.cfgDivCardOn : ''}`} onClick={() => setRisk(i)}>
              <span className={styles.cfgDivLabel}>{label}</span>
              <span className={styles.cfgDivSub}>{sub}</span>
            </button>
          ))}
        </div>
        <p className={styles.cfgHint}>
          {risk === 0 && 'Only top-tier audited protocols with 90-day+ track records.'}
          {risk === 1 && 'Mix of established and emerging protocols. Balanced yield/risk.'}
          {risk === 2 && 'Includes higher-yield protocols with shorter track records.'}
        </p>
      </div>

      <div className={styles.cfgCard}>
        <div className={styles.cfgCardHead}>
          <div>
            <h4 className={styles.cfgTitle}>Rebalancing Rules</h4>
            <p className={styles.cfgDesc}>Control when and how your agent rebalances positions</p>
          </div>
        </div>

        <div className={styles.cfgRuleBlock}>
          <p className={styles.cfgRuleLabel}>Execution frequency</p>
          <div className={styles.cfgDivModes}>
            {STRATEGY_FREQS.map(({ label, sub }, i) => (
              <button key={label} className={`${styles.cfgDivCard} ${freq === i ? styles.cfgDivCardOn : ''}`} onClick={() => setFreq(i)}>
                <span className={styles.cfgDivLabel}>{label}</span>
                <span className={styles.cfgDivSub}>{sub}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.cfgRuleBlock}>
          <div className={styles.cfgRuleTop}>
            <span className={styles.cfgRuleLabel}>Min profit threshold</span>
            <span className={styles.cfgRuleVal}>{threshold}%</span>
          </div>
          <input type="range" min="0" max="100" value={threshold} onChange={e => setThreshold(Number(e.target.value))} className={styles.cfgSlider} />
        </div>

        <div className={styles.cfgLockCards}>
          {[
            { label: 'Auto-rebalancing',   desc: 'Agent reallocates when better yield is found',          val: autoRebal, set: setAutoRebal },
            { label: 'Slippage protection', desc: 'Skip swaps when estimated slippage exceeds 0.3%',      val: slippage,  set: setSlippage  },
          ].map(({ label, desc, val, set }) => (
            <div key={label} className={`${styles.cfgLockCard} ${val ? styles.cfgLockCardOn : ''}`}>
              <div className={styles.cfgLockLeft}>
                <div>
                  <p className={styles.cfgLockName}>{label}</p>
                  <p className={styles.cfgLockSub}>{desc}</p>
                </div>
              </div>
              <CfgToggle on={val} onChange={set} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const NOTIF_ITEMS = [
  { label: 'Execution completed',   desc: 'Notify when your agent completes a rebalancing cycle',  key: 'exec'  },
  { label: 'APY change alert',      desc: 'Alert when your average APY shifts by more than 0.5%',  key: 'apy'   },
  { label: 'Rebalancing triggered', desc: 'Alert when capital is moved between protocols',          key: 'rebal' },
  { label: 'Security event',        desc: 'Immediate alert on any depeg or TVL anomaly detected',  key: 'sec'   },
  { label: 'Low balance warning',   desc: 'Notify when your balance drops below a set threshold',  key: 'bal'   },
]
const NOTIF_CHANNEL_DEFS = [
  {
    id: 'whatsapp', label: 'WhatsApp',
    icon: <svg viewBox="0 0 24 24" fill="#25D366" width="20" height="20"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>,
  },
  {
    id: 'telegram', label: 'Telegram',
    icon: <svg viewBox="0 0 24 24" fill="#29B6F6" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.7 8.01c-.12.56-.46.7-.93.43l-2.58-1.9-1.24 1.2c-.14.14-.25.25-.51.25l.18-2.62 4.73-4.27c.2-.18-.05-.28-.32-.1L7.53 15.26l-2.54-.79c-.55-.17-.56-.55.12-.82l9.96-3.84c.46-.17.86.11.57.99z"/></svg>,
  },
  {
    id: 'email', label: 'Email',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="20" height="20"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  },
]

function NotificationsView() {
  const [notifs, setNotifs] = useState({ exec: true, apy: true, rebal: false, sec: true, bal: false })
  const [channels, setChannels] = useState({
    whatsapp: { connected: true,  enabled: true,  open: true  },
    telegram: { connected: false, enabled: false, open: false },
    email:    { connected: false, enabled: false, open: false },
  })
  const toggleNotif  = key => setNotifs(n => ({ ...n, [key]: !n[key] }))
  const toggleOpen   = id  => setChannels(cs => ({ ...cs, [id]: { ...cs[id], open: !cs[id].open } }))
  const toggleEnabled = id => setChannels(cs => ({ ...cs, [id]: { ...cs[id], enabled: !cs[id].enabled } }))

  return (
    <div className={styles.cfgPanel}>
      <div className={styles.pNotifChannelList}>
        {NOTIF_CHANNEL_DEFS.map(ch => {
          const state = channels[ch.id]
          return (
            <div key={ch.id} className={styles.pNotifChannel}>
              <div className={styles.pNotifChannelRow}>
                <div className={styles.pNotifChannelInfo}>
                  <span className={styles.pNotifChannelIcon}>{ch.icon}</span>
                  <span className={styles.pNotifChannelName}>{ch.label}</span>
                </div>
                <div className={styles.pNotifChannelActions}>
                  <button className={`${styles.pNotifConnectBtn} ${state.connected ? styles.pNotifConnectedBtn : ''}`}>
                    {state.connected ? 'Connected' : 'Connect'}
                  </button>
                  {state.connected && <CfgToggle on={state.enabled} onChange={() => toggleEnabled(ch.id)} />}
                  <button className={styles.pNotifChevBtn} onClick={() => toggleOpen(ch.id)}>
                    <svg viewBox="0 0 24 24" fill="none" width="13" height="13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={`${styles.pNotifChev} ${state.open ? styles.pNotifChevOpen : ''}`}>
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                  </button>
                </div>
              </div>
              {state.open && (
                <div className={styles.pNotifExpanded}>
                  <p className={styles.pNotifTypesTitle}>Which notifications would you like to receive?</p>
                  {NOTIF_ITEMS.map(({ label, desc, key }) => (
                    <div key={key} className={styles.pNotifTypeRow}>
                      <div className={styles.pNotifTypeInfo}>
                        <span className={styles.pNotifTypeLabel}>{label}</span>
                        <span className={styles.pNotifTypeDesc}>{desc}</span>
                      </div>
                      <CfgToggle on={notifs[key]} onChange={() => toggleNotif(key)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const PERSONAL_TABS = [
  { id: 'permissions',   label: 'Permissions',   desc: 'Set which networks, stablecoins, and protocols your agent can interact with.' },
  { id: 'notifications', label: 'Notifications', desc: 'Choose which events trigger alerts and how you want to be notified.' },
  { id: 'strategy',      label: 'Strategy',      desc: 'Configure risk tolerance, execution frequency, and rebalancing behaviour.' },
]

function PersonalizationSection() {
  const [ref, vis] = useInView(0.08)
  const [tab, setTab] = useState('permissions')
  const active = PERSONAL_TABS.find(t => t.id === tab)
  return (
    <div ref={ref} className={styles.personalSection}>
      <div className={`${styles.personalHeader} ${vis ? styles.personalHeaderVisible : ''}`}>

        <h2 className={styles.tiersTitle}>Finance, now personalized.</h2>
      </div>

      <div className={`${styles.personalSwitcher} ${vis ? styles.personalSwitcherVisible : ''}`}>
        {PERSONAL_TABS.map(t => (
          <button
            key={t.id}
            className={`${styles.personalTab} ${tab === t.id ? styles.personalTabActive : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className={`${styles.personalDesc} ${vis ? styles.personalDescVisible : ''}`}>{active.desc}</p>

      <div className={`${styles.personalMockup} ${vis ? styles.personalMockupVisible : ''}`}>
        {tab === 'permissions'   && <PermissionsView />}
        {tab === 'strategy'      && <StrategyView />}
        {tab === 'notifications' && <NotificationsView />}
      </div>
    </div>
  )
}

/* ── Tiers section ── */
function TiersSection() {
  const [ref, vis] = useInView(0.08)
  const [activeIdx, setActiveIdx] = useState(0)
  const carouselRef = useRef(null)
  const TIERS_MOBILE = [...TIERS].reverse() // Platinum, Gold, Silver

  const handleScroll = () => {
    const el = carouselRef.current
    if (!el) return
    const idx = Math.round(el.scrollLeft / el.offsetWidth)
    setActiveIdx(idx)
  }

  return (
    <div ref={ref} className={styles.tiersSection}>
      <div className={`${styles.tiersHeader} ${vis ? styles.tiersHeaderVisible : ''}`}>
        <h2 className={styles.tiersTitle}>Sail Tiers</h2>
        <p className={styles.tiersSubtitle}>
          Each tier is determined by your total balance as a user, with higher balances unlocking greater agentic power and advanced functionality.
        </p>
      </div>
      {/* Desktop grid */}
      <div className={styles.tiersGrid}>
        {TIERS.map((tier, i) => (
          <TierCard key={tier.id} tier={tier} index={i} />
        ))}
      </div>
      {/* Mobile carousel */}
      <div className={styles.tiersCarouselWrap}>
        <div className={styles.tiersCarousel} ref={carouselRef} onScroll={handleScroll}>
          {TIERS_MOBILE.map((tier, i) => (
            <div key={tier.id} className={styles.tiersCarouselSlide}>
              <TierCard tier={tier} index={i} />
            </div>
          ))}
        </div>
        <div className={styles.tiersDots}>
          {TIERS_MOBILE.map((_, i) => (
            <span key={i} className={`${styles.tiersDot} ${i === activeIdx ? styles.tiersDotActive : ''}`} />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Referral section ── */
const LOGIN_PROVIDERS = [
  { label: 'Google', color: '#fff', bg: 'rgba(255,255,255,0.06)', svg: <svg viewBox="0 0 24 24" fill="none" width="22" height="22"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> },
  { label: 'X', color: '#fff', bg: 'rgba(255,255,255,0.06)', svg: <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)" width="20" height="20"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> },
  { label: 'Telegram', color: '#29B6F6', bg: 'rgba(41,182,246,0.10)', svg: <svg viewBox="0 0 24 24" fill="#29B6F6" width="22" height="22"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.7 8.01c-.12.56-.46.7-.93.43l-2.58-1.9-1.24 1.2c-.14.14-.25.25-.51.25l.18-2.62 4.73-4.27c.2-.18-.05-.28-.32-.1L7.53 15.26l-2.54-.79c-.55-.17-.56-.55.12-.82l9.96-3.84c.46-.17.86.11.57.99z"/></svg> },
  { label: 'Rabby', color: '#8B5CF6', bg: 'rgba(139,92,246,0.10)', svg: <svg viewBox="0 0 32 32" fill="none" width="22" height="22"><ellipse cx="16" cy="18" rx="11" ry="8" fill="#7C3AED"/><ellipse cx="10" cy="11" rx="4.5" ry="4" fill="#6D28D9"/><ellipse cx="22" cy="11" rx="4.5" ry="4" fill="#6D28D9"/><circle cx="10" cy="11" r="1.8" fill="#fff"/><circle cx="22" cy="11" r="1.8" fill="#fff"/><circle cx="10.6" cy="10.4" r="0.7" fill="#1e1b4b"/><circle cx="22.6" cy="10.4" r="0.7" fill="#1e1b4b"/></svg> },
  { label: 'MetaMask', color: '#F6851B', bg: 'rgba(246,133,27,0.10)', svg: <svg viewBox="0 0 24 24" fill="none" width="22" height="22"><path d="M21.315 2L13.26 8.025l1.522-3.596L21.315 2z" fill="#E2761B"/><path d="M2.685 2l7.994 6.08-1.45-3.655L2.685 2z" fill="#E4761B"/><path d="M18.44 16.52l-2.147 3.288 4.594 1.264 1.322-4.48-3.769-.072z" fill="#E4761B"/><path d="M2.8 16.592l1.31 4.48 4.594-1.264-2.147-3.288-3.757.072z" fill="#E4761B"/><path d="M8.478 10.773l-1.275 1.927 4.546.201-.155-4.884-3.116 2.756z" fill="#E4761B"/><path d="M15.522 10.773l-3.165-2.81-.108 4.938 4.546-.201-1.273-1.927z" fill="#E4761B"/><path d="M8.704 19.808l2.74-1.323-2.363-1.846-.377 3.169z" fill="#E4761B"/><path d="M12.556 18.485l2.74 1.323-.377-3.169-2.363 1.846z" fill="#E4761B"/></svg> },
  { label: 'Phantom', color: '#9945FF', bg: 'rgba(153,69,255,0.10)', svg: <svg viewBox="0 0 24 24" fill="none" width="22" height="22"><rect width="24" height="24" rx="7" fill="#9945FF" fillOpacity="0.15"/><path d="M5.5 12c0-3.59 2.91-6.5 6.5-6.5h1.5c3.59 0 6.5 2.91 6.5 6.5 0 1.2-.32 2.32-.89 3.28h-1.11c.63-.94 1-2.07 1-3.28C19 9.47 16.76 7 14 7h-1.5C9.96 7 7.5 9.24 7.5 12c0 1.21.37 2.34 1 3.28H7.39C6.82 14.32 5.5 13.2 5.5 12z" fill="#9945FF"/><circle cx="10.5" cy="13" r="1.5" fill="white"/><circle cx="13.5" cy="13" r="1.5" fill="white"/></svg> },
]

function ReferralSection() {
  const [ref, vis] = useInView(0.08)
  const referralCode = useCodeTypewriter(REFERRAL_CODES)
  return (
    <div ref={ref} className={styles.referralSection}>

      <div className={`${styles.referralHeader} ${vis ? styles.referralHeaderVisible : ''}`}>
        <h2 className={styles.referralTitle}>Join us in Expanding<br />Money Intelligence</h2>
        <p className={styles.referralSubtitle}>
          Get a referral code and earn 20% of all Sail Points generated from the AUM your
          friends bring to Sail.{' '}
          <a href="#" className={styles.referralLink}>More info in our docs.</a>
        </p>
      </div>

      <div className={`${styles.referralCards} ${vis ? styles.referralCardsVisible : ''}`}>

        {/* 01 — Create an Account */}
        <div className={`${styles.referralCard} ${styles.referralCardBlue}`} style={{ '--delay': '0ms' }}>
          <div className={styles.referralCardGlow} />
          <div className={styles.referralCardMeta}>
            <span className={`${styles.referralCardNum} ${styles.referralCardNumBlue}`}>01</span>
            <h3 className={styles.referralCardTitle}>Create an Account</h3>
            <p className={styles.referralCardDesc}>Connect any wallet or preferred social login to create your non-custodial Sail smart account.</p>
          </div>
          <div className={styles.referralCardVisual}>
            <div className={styles.loginGrid}>
              {LOGIN_PROVIDERS.map(({ label, svg, bg }) => (
                <div key={label} className={styles.loginIcon} style={{ '--bg': bg }} title={label}>
                  {svg}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 02 — Copy your Code */}
        <div className={`${styles.referralCard} ${styles.referralCardPurple}`} style={{ '--delay': '130ms' }}>
          <div className={styles.referralCardGlow} />
          <div className={styles.referralCardMeta}>
            <span className={`${styles.referralCardNum} ${styles.referralCardNumPurple}`}>02</span>
            <h3 className={styles.referralCardTitle}>Copy your Code</h3>
            <p className={styles.referralCardDesc}>Go to your profile section and copy your unique referral code.</p>
          </div>
          <div className={styles.referralCardVisual}>
            <div className={styles.codeDisplay}>
              <div className={styles.codePill}>
                <span className={styles.codeText}>{referralCode}<span className={styles.codeCursor} /></span>
                <button className={styles.codeCopy} title="Copy">
                  <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                    <rect x="5" y="5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M3 11V3a2 2 0 012-2h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
              <div className={styles.shareRow}>
                <button className={styles.shareBtn} title="Share on X">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </button>
                <button className={styles.shareBtn} title="Share on Telegram">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.7 8.01c-.12.56-.46.7-.93.43l-2.58-1.9-1.24 1.2c-.14.14-.25.25-.51.25l.18-2.62 4.73-4.27c.2-.18-.05-.28-.32-.1L7.53 15.26l-2.54-.79c-.55-.17-.56-.55.12-.82l9.96-3.84c.46-.17.86.11.57.99z"/></svg>
                </button>
                <button className={styles.shareBtn} title="Share link">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 03 — Share with friends */}
        <div className={`${styles.referralCard} ${styles.referralCardGreen}`} style={{ '--delay': '260ms' }}>
          <div className={styles.referralCardGlow} />
          <div className={styles.referralCardMeta}>
            <span className={`${styles.referralCardNum} ${styles.referralCardNumGreen}`}>03</span>
            <h3 className={styles.referralCardTitle}>Share with friends</h3>
            <p className={styles.referralCardDesc}>Your referrals earn 10% extra Sail Points on their own balance — everyone earns more while keeping stablecoins in motion.</p>
          </div>
          <div className={styles.referralCardVisual}>
            <div className={styles.bonusDisplay}>
              <div className={styles.bonusPulseRing} />
              <span className={styles.bonusNum}>+10%</span>
              <span className={styles.bonusLabel}>Sail Points for your referrals</span>
            </div>
          </div>
        </div>

        {/* CTA card */}
        <a href="#" className={`${styles.referralCtaCard} ${vis ? styles.referralCtaCardVisible : ''}`}>
          <span className={styles.referralCtaText}>Get Started</span>
          <span className={styles.referralCtaArrow}>
            <svg viewBox="0 0 20 20" fill="none" width="20" height="20">
              <path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </a>

      </div>
    </div>
  )
}

/* ── Icons ── */
const ICONS = {
  autonomous: (
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="24" cy="24" r="13" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3"/>
      <path d="M24 16v9l5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  personalized: (
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M14 24h4M30 24h4M24 14v4M24 30v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="24" cy="24" r="5" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  secure: (
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M24 13l-9 4v7c0 5 4 9.5 9 11 5-1.5 9-6 9-11v-7l-9-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M20 24l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  selfCustodial: (
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="14" y="24" width="20" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M18 24v-5a6 6 0 0112 0v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="24" cy="31" r="2" fill="currentColor"/>
    </svg>
  ),
  multiChain: (
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="16" cy="24" r="4" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="32" cy="24" r="4" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M20 24h8" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M12 18c0-3 2-5 4-5M36 18c0-3-2-5-4-5M12 30c0 3 2 5 4 5M36 30c0 3-2 5-4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  multiAsset: (
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M15 19h18M15 24h18M15 29h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M28 15l4 4-4 4M20 25l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
}

/* ── Feature data ── */
const LEFT_FEATURES = [
  { icon: 'autonomous',   title: 'Autonomous',    desc: 'Your agent works 24/7 to analyze, allocate, and adapt your funds effortlessly.' },
  { icon: 'personalized', title: 'Personalized',  desc: 'Your agent optimizes stablecoin yields, tailoring operations to your balance, risk, and preferences.' },
  { icon: 'secure',       title: 'Secure',        desc: 'Internal security agent designed to suspend operations in response to stablecoin depegs or TVL shocks.' },
]
const RIGHT_FEATURES = [
  { icon: 'selfCustodial', title: 'Self-Custodial', desc: 'Your funds stay in your own smart account, and the agent can only act within strict limits you control.' },
  { icon: 'multiChain',    title: 'Multi-Network',    desc: 'Your agent optimizes yield across networks thanks to our in-house Cross-Network Optimization Engine.' },
  { icon: 'multiAsset',    title: 'Multi-Asset',    desc: 'Your agent can swap between vetted stablecoins to capture the max net yield across networks.' },
]

/* ── Feature card with expand ── */
function FeatureCard({ icon, title, desc, delay = 0, side = 'left' }) {
  const [ref, vis] = useInView()
  const [open, setOpen] = useState(false)

  return (
    <div
      ref={ref}
      className={`${styles.card} ${vis ? styles.cardVisible : ''} ${open ? styles.cardOpen : ''}`}
      style={{ '--delay': `${delay}ms`, '--slide': side === 'left' ? '-20px' : '20px' }}
    >
      <button className={styles.cardHeader} onClick={() => setOpen(o => !o)}>
        <div className={styles.cardLeft}>
          <span className={styles.cardIcon}>{ICONS[icon]}</span>
          <span className={styles.cardTitle}>{title}</span>
        </div>
        <span className={styles.cardToggle}>
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
            <path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </span>
      </button>
      <div className={styles.cardBody}>
        <p className={styles.cardDesc}>{desc}</p>
      </div>
    </div>
  )
}

/* ── Section ── */
export default function WebAgentSection() {
  const [sectionRef, headerVis] = useInView(0.06)

  return (
    <section ref={sectionRef} className={styles.section}>
      <div className={styles.container}>

        <div className={`${styles.header} ${headerVis ? styles.headerVisible : ''}`}>
          <h2 className={styles.title}>Why Sail Agents</h2>
          <p className={styles.subtitle}>
            Experience the power of AI-driven DeFi automation that adapts to market conditions in real-time.
          </p>
        </div>

        <div className={styles.body}>

          <div className={styles.col}>
            {LEFT_FEATURES.map((f, i) => (
              <FeatureCard key={f.title} {...f} delay={i * 100} side="left" />
            ))}
          </div>

          <div className={`${styles.mockupCol} ${headerVis ? styles.mockupColVisible : ''}`}>
            <AgentMockup />
          </div>

          <div className={styles.col}>
            {RIGHT_FEATURES.map((f, i) => (
              <FeatureCard key={f.title} {...f} delay={i * 100} side="right" />
            ))}
          </div>

        </div>
      </div>

      <PersonalizationSection />
      <TiersSection />
      <ReferralSection />

    </section>
  )
}
