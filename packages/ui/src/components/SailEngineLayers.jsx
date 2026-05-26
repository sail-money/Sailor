import { useEffect, useRef, useState } from 'react'
import styles from './SailEngineLayers.module.css'

/* ── Isometric projection helpers ──────────────────────────────────────── */
const COS30 = Math.cos(Math.PI / 6)   // ≈ 0.866
const SIN30 = Math.sin(Math.PI / 6)   // = 0.5

function iso(x, y, z, cx = 0, cy = 0) {
  return [(x - y) * COS30 + cx, (x + y) * SIN30 - z + cy]
}

function pts(arr) {
  return arr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

/* ── Layer data ─────────────────────────────────────────────────────────── */
const W = 160, D = 100, H = 40

const LAYERS = [
  {
    id: 'intelligence',
    num: '01',
    label: 'Intelligence Layer',
    color: '#66c2ff',
    title: 'Programmable Compliance',
    desc: 'Define exactly what Sail can and cannot do. Whitelist protocols, set exposure limits, and enforce jurisdiction rules. Every action is gated by your permission set before execution.',
    bullets: ['Protocol whitelisting', 'Exposure limits & caps', 'Jurisdiction-aware rules'],
    zB: 100,   // top slab
  },
  {
    id: 'permission',
    num: '02',
    label: 'Permission Layer',
    color: '#2B80FF',
    title: 'Intelligent Yield Routing',
    desc: "Sail's Permission Layer continuously monitors 200+ protocols across networks, scoring each opportunity for risk-adjusted returns. Positions rebalance automatically — no manual intervention required.",
    bullets: ['Real-time protocol scoring', 'Cross-network rebalancing', 'Gas-optimized execution'],
    zB: 50,    // middle slab
  },
  {
    id: 'distribution',
    num: '03',
    label: 'Distribution Layer',
    color: '#32DC78',
    title: 'AI-Powered Smart Contract Security',
    desc: "Powered by Octane Security — an AI engine that monitors every smart contract 24/7, catching critical vulnerabilities before they become exploits. From reentrancy to oracle manipulation, threats are spotted and blocked before they're too late.",
    bullets: ['AI vulnerability detection, 24/7 offense intel', '103 critical bugs uncovered across $186B secured', 'Auto-generated fixes & CI/CD integration'],
    poweredBy: true,
    zB: 0,     // bottom slab
  },
]

/* ── Grid node offsets on the top face of a slab ───────────────────────── */
const GRID_NODES = []
for (let col = 0; col < 4; col++) {
  for (let row = 0; row < 3; row++) {
    GRID_NODES.push([28 + col * 36, 16 + row * 34])
  }
}

/* ── Single isometric slab ──────────────────────────────────────────────── */
function Slab({ layer, active, CX, CY }) {
  const { zB, color } = layer
  const zT = zB + H

  const topFace  = [iso(0,0,zT,CX,CY), iso(W,0,zT,CX,CY), iso(W,D,zT,CX,CY), iso(0,D,zT,CX,CY)]
  const frontFace = [iso(0,0,zT,CX,CY), iso(W,0,zT,CX,CY), iso(W,0,zB,CX,CY), iso(0,0,zB,CX,CY)]
  const rightFace = [iso(W,0,zT,CX,CY), iso(W,D,zT,CX,CY), iso(W,D,zB,CX,CY), iso(W,0,zB,CX,CY)]

  const nodePositions = GRID_NODES.map(([nx, ny]) => iso(nx, ny, zT, CX, CY))
  const labelPos = iso(W / 2, D / 2, zT + 4, CX, CY)

  const opacity = active ? 1 : 0.28

  return (
    <g style={{ opacity, transition: 'opacity 0.55s ease' }}>
      {/* Right face */}
      <polygon
        points={pts(rightFace)}
        fill={color} fillOpacity={active ? 0.12 : 0.04}
        stroke={color} strokeOpacity={active ? 0.5 : 0.18} strokeWidth="1"
        style={{ transition: 'all 0.55s ease' }}
      />
      {/* Front face */}
      <polygon
        points={pts(frontFace)}
        fill={color} fillOpacity={active ? 0.09 : 0.03}
        stroke={color} strokeOpacity={active ? 0.5 : 0.18} strokeWidth="1"
        style={{ transition: 'all 0.55s ease' }}
      />
      {/* Top face */}
      <polygon
        points={pts(topFace)}
        fill={color} fillOpacity={active ? 0.22 : 0.05}
        stroke={color} strokeOpacity={active ? 0.95 : 0.3} strokeWidth={active ? 1.5 : 0.8}
        style={{ transition: 'all 0.55s ease' }}
      />
      {/* Glow ring on active top face */}
      {active && (
        <polygon
          points={pts(topFace)}
          fill="none"
          stroke={color} strokeOpacity={0.35} strokeWidth="8"
          filter="url(#slabGlow)"
        />
      )}
      {/* Grid nodes on active top face */}
      {nodePositions.map(([nx, ny], i) => (
        <circle
          key={i}
          cx={nx} cy={ny} r={active ? 2.5 : 1.5}
          fill={color}
          fillOpacity={active ? 0.85 : 0.2}
          style={{ transition: 'all 0.55s ease', transitionDelay: `${i * 25}ms` }}
        />
      ))}
      {/* Floating label */}
      <text
        x={labelPos[0]} y={labelPos[1]}
        textAnchor="middle"
        fill={color} fillOpacity={active ? 0.95 : 0.35}
        fontSize={active ? '10' : '8.5'}
        fontFamily="'SF Mono', 'Fira Code', monospace"
        letterSpacing="0.5"
        style={{ transition: 'all 0.55s ease', userSelect: 'none' }}
      >
        {layer.label}
      </text>
    </g>
  )
}

/* ── Connector lines between slabs ──────────────────────────────────────── */
function Connectors({ CX, CY }) {
  // draw dashed vertical lines on left-back edge between each layer gap
  const gaps = [
    [LAYERS[2].zB + H, LAYERS[1].zB],  // Security top → Permission bottom
    [LAYERS[1].zB + H, LAYERS[0].zB],  // Permission top → Automation bottom
  ]
  return (
    <>
      {gaps.map(([z1, z2], i) => {
        const [x1, y1] = iso(0, 0, z1, CX, CY)
        const [x2, y2] = iso(0, 0, z2, CX, CY)
        const [rx1, ry1] = iso(W, D, z1, CX, CY)
        const [rx2, ry2] = iso(W, D, z2, CX, CY)
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(90,173,255,0.25)" strokeWidth="1" strokeDasharray="3,3" />
            <line x1={rx1} y1={ry1} x2={rx2} y2={ry2} stroke="rgba(90,173,255,0.25)" strokeWidth="1" strokeDasharray="3,3" />
          </g>
        )
      })}
    </>
  )
}

/* ── Main component ─────────────────────────────────────────────────────── */
export default function SailEngineLayers() {
  const sectionRef = useRef(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [prevIdx, setPrevIdx] = useState(null)

  // SVG center — tune as needed
  const CX = 240, CY = 250

  useEffect(() => {
    const onScroll = () => {
      const el = sectionRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const sectionH = el.offsetHeight
      const winH = window.innerHeight
      const scrollable = sectionH - winH
      if (scrollable <= 0) return
      const p = Math.max(0, Math.min(1, -rect.top / scrollable))
      const next = p < 0.34 ? 0 : p < 0.67 ? 1 : 2
      setActiveIdx(prev => {
        if (prev !== next) setPrevIdx(prev)
        return next
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const layer = LAYERS[activeIdx]

  return (
    <section ref={sectionRef} className={styles.section}>
      <div className={styles.sticky}>

        {/* ── Section label ── */}
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>The Sail Engine</h2>
          <p className={styles.sectionSub}>
            Three interlocking layers that handle every aspect of yield — from routing to compliance to security.
          </p>
        </div>

        <div className={styles.inner}>

          {/* ── Left: step nav + active content ── */}
          <div className={styles.panel}>
            {/* Step indicators */}
            <div className={styles.steps}>
              {LAYERS.map((l, i) => (
                <div
                  key={l.id}
                  className={`${styles.step} ${i === activeIdx ? styles.stepActive : ''}`}
                  style={{ '--c': l.color }}
                >
                  <div className={styles.stepLine}>
                    <span className={styles.stepNum}>{l.num}</span>
                    {i < LAYERS.length - 1 && <div className={styles.stepTrack} />}
                  </div>
                  <span className={styles.stepLbl}>{l.label}</span>
                </div>
              ))}
            </div>

            {/* Content card — re-mounts with key for fade animation */}
            <div className={styles.card} key={activeIdx}>
              <span
                className={styles.tag}
                style={{ color: layer.color, borderColor: `${layer.color}44`, background: `${layer.color}14` }}
              >
                {layer.label}
              </span>
              <h3 className={styles.cardTitle}>{layer.title}</h3>
              <p className={styles.cardDesc}>{layer.desc}</p>
              {layer.poweredBy && (
                <div className={styles.poweredBy}>
                  <span className={styles.poweredByLabel}>Powered by</span>
                  <div className={styles.octaneLogo}>
                    <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
                      <polygon
                        points="11,2 21,2 30,11 30,21 21,30 11,30 2,21 2,11"
                        stroke="#32DC78" strokeWidth="1.8" fill="rgba(50,220,120,0.08)"
                      />
                      <path d="M16 10a6 6 0 1 1 0 12 6 6 0 0 1 0-12z" stroke="#32DC78" strokeWidth="1.5" fill="none"/>
                      <circle cx="16" cy="16" r="2" fill="#32DC78"/>
                    </svg>
                    <span className={styles.octaneWordmark}>OCTANE</span>
                    <span className={styles.octaneSub}>Security</span>
                  </div>
                </div>
              )}
              <ul className={styles.bullets}>
                {layer.bullets.map((b, i) => (
                  <li key={b} className={styles.bullet} style={{ '--c': layer.color, '--i': i }}>
                    <svg className={styles.bulletIcon} viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="5" fill={`${layer.color}20`} stroke={`${layer.color}55`} strokeWidth="0.8" />
                      <path d="M3.5 6l2 2 3-3" stroke={layer.color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── Right: isometric SVG ── */}
          <div className={styles.visual}>
            <svg viewBox="0 0 480 400" className={styles.svg} aria-hidden="true">
              <defs>
                <filter id="slabGlow" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Connecting dashed lines between slabs */}
              <Connectors CX={CX} CY={CY} />

              {/* Render slabs back-to-front: Security → Permission → Automation */}
              {[2, 1, 0].map(i => (
                <Slab
                  key={LAYERS[i].id}
                  layer={LAYERS[i]}
                  active={i === activeIdx}
                  CX={CX}
                  CY={CY}
                />
              ))}
            </svg>

            {/* Progress dots */}
            <div className={styles.dots}>
              {LAYERS.map((l, i) => (
                <div
                  key={l.id}
                  className={`${styles.dot} ${i === activeIdx ? styles.dotActive : ''}`}
                  style={{ '--c': l.color }}
                />
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
