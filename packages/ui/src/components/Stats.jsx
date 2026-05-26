import { useState, useEffect, useRef } from 'react'
import ParticleSphere from './ParticleSphere'
import styles from './Stats.module.css'

/* ─── Data ──────────────────────────────────────────────────────────────── */
const stats = [
  // ── Row 0: starts with the sphere ──
  { value: '43+',    label: 'Yield Sources',      sublabel: 'accessed via single API',       anim: 'sphere'       },
  { value: '$605K',  label: 'AUM',              sublabel: 'assets under management',       anim: 'bars'         },
  { value: '$574M',  label: 'Total Volume',      sublabel: 'cumulative processed volume',   anim: 'volume'       },
  { value: '$2.52M', label: 'Daily Volume',      sublabel: 'average daily throughput',      anim: 'dailyvol'     },
  // ── Row 1: capability stats ──
  { value: '117.3K', label: 'Transactions',      sublabel: 'on-chain operations executed',  anim: 'transactions' },
  { value: '1 Day',  label: 'Time to Integrate', sublabel: 'from API key to production',    anim: 'loadbar'      },
  { value: '3',      label: 'Assets',            sublabel: 'USDC · USDT · EURC',           anim: 'assets'       },
  { value: '24/7',   label: 'Team Support',       sublabel: 'always-on dedicated support',   anim: 'helix'        },
]

const ASSET_ICON_URLS = [
  '/protocol_logos/usdc.png',
  '/protocol_logos/usdt.png',
  '/protocol_logos/EURC.svg',
]

const C  = 'rgba(90,173,255,'
const CG = 'rgba(50,220,120,'

/* ─── Path helpers ───────────────────────────────────────────────────────── */
function barPath(ctx, x, y, w, h, r) {
  const cr = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + cr, y)
  ctx.lineTo(x + w - cr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + cr)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + cr)
  ctx.quadraticCurveTo(x, y, x + cr, y)
  ctx.closePath()
}

function pillPath(ctx, x, y, w, h) {
  const r = h / 2
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/* ─── Animations ─────────────────────────────────────────────────────────── */

/* LOADBAR — 1 day */
function animLoadBar(ctx, w, h, t) {
  ctx.clearRect(0, 0, w, h)
  const CYCLE = 1800
  const p     = (t % CYCLE) / CYCLE
  const fill  = p < 0.65 ? p / 0.65 : p < 0.84 ? 1 : 1 - (p - 0.84) / 0.16
  const eased = 1 - Math.pow(1 - Math.min(1, fill), 3)
  const pct   = Math.round(Math.min(100, eased * 100))
  const barW  = w * 0.62
  const barH  = 5
  const bx    = (w - barW) / 2
  const by    = h * 0.60
  ctx.beginPath(); pillPath(ctx, bx, by, barW, barH)
  ctx.fillStyle = `${C}0.08)`; ctx.fill()
  if (eased > 0.005) {
    ctx.beginPath(); pillPath(ctx, bx, by, barW * eased, barH)
    ctx.fillStyle = `${C}0.80)`; ctx.fill()
  }
  const fs = Math.max(28, Math.round(h * 0.13))
  ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
  ctx.fillStyle = `${C}${(0.20 + eased * 0.70).toFixed(2)})`
  ctx.fillText(`${pct}%`, w / 2, by - h * 0.08)
}

/* SPHERE — 200+ protocols */
function animSphere(ctx, w, h, t, dataRef, imagesRef) {
  ctx.clearRect(0, 0, w, h)
  const cx = w * 0.5, cy = h * 0.5
  const R  = Math.min(w, h) * 0.32
  if (!dataRef.current) {
    const N = 280, ICON_N = SPHERE_ICON_URLS.length
    const golden = (1 + Math.sqrt(5)) / 2
    dataRef.current = {
      particles: Array.from({ length: N }, () => ({
        phi: Math.acos((Math.random() * 2) - 1),
        baseTheta: Math.random() * Math.PI * 2,
        size: 0.5 + Math.random() * 0.5,
      })),
      icons: Array.from({ length: ICON_N }, (_, i) => ({
        phi: Math.acos(1 - 2 * (i + 0.5) / ICON_N),
        baseTheta: 2 * Math.PI * i / golden,
        imgIdx: i,
      })),
    }
  }
  const { particles, icons } = dataRef.current
  const rot = t * 0.00016
  particles.forEach(p => {
    const theta = p.baseTheta + rot
    const sinPhi = Math.sin(p.phi)
    const x = R * sinPhi * Math.cos(theta)
    const y = R * Math.cos(p.phi)
    const z = R * sinPhi * Math.sin(theta)
    const sc = 1.8 / (1.8 + (z / R) * 0.3)
    const depth = (z + R) / (R * 2)
    ctx.fillStyle = `${C}${Math.max(0.08, depth * 0.50 + 0.08).toFixed(2)})`
    ctx.beginPath(); ctx.arc(cx + x * sc, cy - y * sc, Math.max(0.5, p.size * sc), 0, Math.PI * 2); ctx.fill()
  })
  const imgs = imagesRef.current
  icons.map(ic => {
    const theta = ic.baseTheta + rot
    const sinPhi = Math.sin(ic.phi)
    return { x: R * sinPhi * Math.cos(theta), y: R * Math.cos(ic.phi), z: R * sinPhi * Math.sin(theta), imgIdx: ic.imgIdx }
  }).sort((a, b) => a.z - b.z).forEach(({ x, y, z, imgIdx }) => {
    if (z < 0) return
    const img = imgs[imgIdx]
    if (!img || !img.complete || !img.naturalWidth) return
    const sc = 1.8 / (1.8 + (z / R) * 0.3)
    const iconSz = Math.min(26, R * 0.17) * sc
    const depth = (z + R) / (R * 2)
    ctx.save()
    ctx.globalAlpha = Math.max(0.4, depth * 0.6 + 0.35)
    ctx.shadowColor = 'rgba(0,100,255,0.5)'; ctx.shadowBlur = 10
    ctx.drawImage(img, cx + x * sc - iconSz / 2, cy - y * sc - iconSz / 2, iconSz, iconSz)
    ctx.restore()
  })
}

/* BARS — AUM (repurposed from old Average APY) */
function animBars(ctx, w, h, t) {
  ctx.clearRect(0, 0, w, h)
  const heights = [0.34, 0.48, 0.41, 0.62, 0.53, 0.76, 0.58, 0.81, 0.70, 0.86, 0.75, 0.91]
  const N = heights.length
  const totalW = w * 0.80, startX = (w - totalW) / 2
  const slot = totalW / N, barW = Math.max(12, slot * 0.58)
  const maxH = h * 0.62, baseY = h * 0.82
  const p = (t % 3600) / 3600
  heights.forEach((hf, i) => {
    const delay = (i / N) * 0.42
    const fill = p < delay ? 0 : p < delay + 0.36 ? (p - delay) / 0.36 : p < 0.86 ? 1 : Math.max(0, 1 - (p - 0.86) / 0.14)
    const eased = 1 - Math.pow(1 - fill, 3)
    const bh = maxH * hf * eased
    if (bh < 1) return
    const bx = startX + i * slot + (slot - barW) / 2
    const by = baseY - bh
    const grad = ctx.createLinearGradient(0, by, 0, baseY)
    grad.addColorStop(0, 'rgba(160,205,255,0.90)')
    grad.addColorStop(1, 'rgba(55,110,225,0.75)')
    ctx.beginPath(); barPath(ctx, bx, by, barW, bh, 5)
    ctx.fillStyle = grad; ctx.fill()
  })
  ctx.beginPath()
  ctx.moveTo(startX, baseY); ctx.lineTo(startX + totalW, baseY)
  ctx.strokeStyle = `${C}0.12)`; ctx.lineWidth = 1; ctx.stroke()
}

/* HELIX — 99.99% uptime */
function animHelix(ctx, w, h, t) {
  ctx.clearRect(0, 0, w, h)
  const cx = w * 0.5, rx = w * 0.28, ry = h * 0.042
  const numCoils = 3, pitch = h * 0.24, baseY = h * 0.14
  const pinH = pitch * 0.52, N = 90, rot = t * 0.00025
  for (let coil = 0; coil < numCoils; coil++) {
    const coilCY = baseY + coil * pitch
    const pts = []
    for (let i = 0; i <= N; i++) {
      const angle = (i / N) * Math.PI * 2 + rot
      pts.push({ x: cx + rx * Math.cos(angle), y: coilCY + ry * Math.sin(angle), d: Math.sin(angle) })
    }
    ctx.beginPath(); let started = false
    for (const p of pts) { if (p.d > 0) continue; if (!started) { ctx.moveTo(p.x, p.y); started = true } else ctx.lineTo(p.x, p.y) }
    ctx.strokeStyle = `${C}0.08)`; ctx.lineWidth = 0.8; ctx.stroke()
    ctx.beginPath(); started = false
    for (const p of pts) { if (p.d < 0) continue; if (!started) { ctx.moveTo(p.x, p.y); started = true } else ctx.lineTo(p.x, p.y) }
    ctx.strokeStyle = `${C}0.32)`; ctx.lineWidth = 1.2; ctx.stroke()
    for (let i = 0; i < pts.length; i += 2) {
      const p = pts[i]; const d01 = (p.d + 1) / 2
      const al = (0.06 + d01 * 0.42).toFixed(2)
      const pLen = pinH * (0.72 + d01 * 0.28)
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + pLen)
      ctx.strokeStyle = `${C}${al})`; ctx.lineWidth = d01 > 0.5 ? 0.75 : 0.50; ctx.stroke()
      ctx.beginPath(); ctx.arc(p.x, p.y + pLen, d01 > 0.5 ? 1.9 : 1.2, 0, Math.PI * 2)
      ctx.fillStyle = `${C}${Math.min(0.75, d01 * 0.6 + 0.08).toFixed(2)})`; ctx.fill()
    }
  }
}

/* VOLUME — Total Volume: growing area curve */
function animVolume(ctx, w, h, t) {
  ctx.clearRect(0, 0, w, h)
  const p     = (t % 3200) / 3200
  const fill  = p < 0.70 ? p / 0.70 : p < 0.88 ? 1 : 1 - (p - 0.88) / 0.12
  const eased = 1 - Math.pow(1 - fill, 3)
  const bx = w * 0.06, ex = w * 0.94
  const by = h * 0.82, ty = h * 0.12
  const dx   = (ex - bx) * eased
  const endX = bx + dx
  const endY = by - (by - ty) * Math.pow(eased, 1.1)
  const cp1x = bx + dx * 0.35, cp1y = by - (by - ty) * 0.04
  const cp2x = bx + dx * 0.65, cp2y = by - (by - ty) * 0.58
  if (eased < 0.02) return
  const grad = ctx.createLinearGradient(0, ty, 0, by)
  grad.addColorStop(0, `${C}0.22)`); grad.addColorStop(1, `${C}0.01)`)
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY)
  ctx.lineTo(endX, by); ctx.closePath()
  ctx.fillStyle = grad; ctx.fill()
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY)
  ctx.strokeStyle = `${C}0.80)`; ctx.lineWidth = 2.5
  ctx.strokeLinecap = 'round'; ctx.stroke()
  if (eased > 0.05) {
    ctx.beginPath(); ctx.arc(endX, endY, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = `${C}0.90)`; ctx.fill()
    ctx.beginPath(); ctx.arc(endX, endY, 9, 0, Math.PI * 2)
    ctx.fillStyle = `${C}0.15)`; ctx.fill()
  }
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(w * 0.94, by)
  ctx.strokeStyle = `${C}0.10)`; ctx.lineWidth = 1; ctx.stroke()
}

/* DAILYVOL — Daily Volume: green/red candlestick bars */
function animDailyVol(ctx, w, h, t) {
  ctx.clearRect(0, 0, w, h)
  const bars = [
    { hf: 0.38, up: true  }, { hf: 0.52, up: false }, { hf: 0.34, up: true  },
    { hf: 0.68, up: true  }, { hf: 0.46, up: false }, { hf: 0.60, up: true  },
    { hf: 0.78, up: true  }, { hf: 0.55, up: false },
  ]
  const N = bars.length, totalW = w * 0.82, startX = (w - totalW) / 2
  const slot = totalW / N, barW = Math.max(10, slot * 0.55)
  const maxH = h * 0.64, baseY = h * 0.82
  const p = (t % 3600) / 3600
  bars.forEach((bar, i) => {
    const delay = (i / N) * 0.44
    const fill  = p < delay ? 0 : p < delay + 0.32 ? (p - delay) / 0.32 : p < 0.88 ? 1 : Math.max(0, 1 - (p - 0.88) / 0.12)
    const eased = 1 - Math.pow(1 - fill, 3)
    const bh = maxH * bar.hf * eased
    if (bh < 1) return
    const bx = startX + i * slot + (slot - barW) / 2
    const by = baseY - bh
    const cc = bar.up ? 'rgba(50,220,120,' : 'rgba(255,90,90,'
    const grad = ctx.createLinearGradient(0, by, 0, baseY)
    grad.addColorStop(0, `${cc}0.85)`); grad.addColorStop(1, `${cc}0.28)`)
    ctx.beginPath(); barPath(ctx, bx, by, barW, bh, 4)
    ctx.fillStyle = grad; ctx.fill()
  })
  ctx.beginPath(); ctx.moveTo(startX, baseY); ctx.lineTo(startX + totalW, baseY)
  ctx.strokeStyle = `${C}0.12)`; ctx.lineWidth = 1; ctx.stroke()
}

/* TRANSACTIONS — cascading dot grid */
function animTransactions(ctx, w, h, t) {
  ctx.clearRect(0, 0, w, h)
  const cols = 12, rows = 5
  const N = cols * rows
  const dotR  = Math.min(w, h) * 0.022
  const gridW = w * 0.80, gridH = h * 0.58
  const startX = (w - gridW) / 2, startY = h * 0.20
  const p = (t % 2800) / 2800
  for (let i = 0; i < N; i++) {
    const col = i % cols, row = Math.floor(i / cols)
    const dx = startX + col * (gridW / (cols - 1))
    const dy = startY + row * (gridH / (rows - 1))
    const threshold = i / N
    const lit = p > threshold
    const isActive = Math.abs(p - threshold) < 0.055
    const alpha = lit ? (isActive ? 0.88 : 0.32 + (i / N) * 0.22) : 0.06
    ctx.beginPath()
    ctx.arc(dx, dy, dotR * (isActive ? 1.6 : 1), 0, Math.PI * 2)
    ctx.fillStyle = isActive ? `${CG}${alpha.toFixed(2)})` : `${C}${alpha.toFixed(2)})`
    ctx.fill()
  }
}

/* ASSETS — 3 token logos orbiting in a mini particle sphere */
function animAssets(ctx, w, h, t, dataRef, imagesRef) {
  ctx.clearRect(0, 0, w, h)
  const cx = w * 0.5, cy = h * 0.5
  const R  = Math.min(w, h) * 0.27
  const rot = t * 0.00018

  // Init sphere particles (stored separately from sphere anim)
  if (!dataRef.current || dataRef.current.type !== 'assets') {
    dataRef.current = {
      type: 'assets',
      particles: Array.from({ length: 180 }, () => ({
        phi:       Math.acos((Math.random() * 2) - 1),
        baseTheta: Math.random() * Math.PI * 2,
        size:      0.4 + Math.random() * 0.55,
      })),
    }
  }

  // Draw background particle sphere
  dataRef.current.particles.forEach(p => {
    const theta  = p.baseTheta + rot
    const sinPhi = Math.sin(p.phi)
    const x = R * sinPhi * Math.cos(theta)
    const y = R * Math.cos(p.phi)
    const z = R * sinPhi * Math.sin(theta)
    const sc    = 1.8 / (1.8 + (z / R) * 0.3)
    const depth = (z + R) / (R * 2)
    ctx.fillStyle = `${C}${Math.max(0.04, depth * 0.32 + 0.04).toFixed(2)})`
    ctx.beginPath()
    ctx.arc(cx + x * sc, cy - y * sc, Math.max(0.4, p.size * sc), 0, Math.PI * 2)
    ctx.fill()
  })

  // 3 icons evenly spaced (120° apart), slightly varied phi for natural look
  const iconConfigs = [
    { baseTheta: 0,                      phi: Math.PI * 0.38 },
    { baseTheta: (Math.PI * 2) / 3,      phi: Math.PI * 0.62 },
    { baseTheta: (Math.PI * 4) / 3,      phi: Math.PI * 0.50 },
  ]

  iconConfigs
    .map(({ baseTheta, phi }, idx) => {
      const theta  = baseTheta + rot
      const sinPhi = Math.sin(phi)
      return {
        x: R * sinPhi * Math.cos(theta),
        y: R * Math.cos(phi),
        z: R * sinPhi * Math.sin(theta),
        idx,
      }
    })
    .sort((a, b) => a.z - b.z)
    .forEach(({ x, y, z, idx }) => {
      const img = imagesRef.current[idx]
      if (!img || !img.complete || !img.naturalWidth) return
      const sc     = 1.8 / (1.8 + (z / R) * 0.3)
      const iconSz = Math.min(44, R * 0.30) * sc
      const depth  = (z + R) / (R * 2)
      ctx.save()
      ctx.globalAlpha = Math.max(0.5, depth * 0.5 + 0.45)
      ctx.shadowColor = 'rgba(0,100,255,0.5)'
      ctx.shadowBlur  = 14
      ctx.drawImage(img, cx + x * sc - iconSz / 2, cy - y * sc - iconSz / 2, iconSz, iconSz)
      ctx.restore()
    })
}

/* ─── Component ──────────────────────────────────────────────────────────── */
export default function Stats() {
  const [active, setActive]     = useState(0)
  const [revealed, setRevealed] = useState(false)
  const sectionRef   = useRef(null)
  const canvasRef    = useRef(null)
  const dataRef      = useRef(null)
  const imagesRef    = useRef([])
  const rafRef       = useRef(null)
  const activeRef    = useRef(0)
  const lastClickRef = useRef(0)

  // Preload asset token images (USDC, USDT, EURC)
  useEffect(() => {
    ASSET_ICON_URLS.forEach((url, i) => {
      const img = new Image(); img.src = url
      imagesRef.current[i] = img
    })
  }, [])

  // Scroll reveal
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setRevealed(true) },
      { threshold: 0.10 }
    )
    if (sectionRef.current) obs.observe(sectionRef.current)
    return () => obs.disconnect()
  }, [])

  // Auto-cycle all 8 stats every 5 s
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastClickRef.current < 7000) return
      setActive(prev => {
        const n = (prev + 1) % stats.length
        activeRef.current = n
        dataRef.current   = null
        return n
      })
    }, 5000)
    return () => clearInterval(id)
  }, [])

  // Canvas RAF loop — pauses when section is off-screen
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const cw = canvas.offsetWidth || 800, ch = canvas.offsetHeight || 440
      canvas.width = cw * dpr; canvas.height = ch * dpr
      ctx.scale(dpr, dpr)
    }
    fit()
    const ro = new ResizeObserver(fit); ro.observe(canvas)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { ro.disconnect(); return }
    let st = null
    let visible = true
    const loop = (ts) => {
      if (!visible) return
      if (!st) st = ts
      const t   = ts - st
      const dpr = window.devicePixelRatio || 1
      const w   = canvas.width / dpr, h = canvas.height / dpr
      const anim = stats[activeRef.current].anim
      if (anim === 'sphere') { ctx.clearRect(0, 0, w, h); rafRef.current = requestAnimationFrame(loop); return }
      if (anim === 'loadbar')      animLoadBar(ctx, w, h, t)
      if (anim === 'bars')         animBars(ctx, w, h, t)
      if (anim === 'helix')        animHelix(ctx, w, h, t)
      if (anim === 'volume')       animVolume(ctx, w, h, t)
      if (anim === 'dailyvol')     animDailyVol(ctx, w, h, t)
      if (anim === 'transactions') animTransactions(ctx, w, h, t)
      if (anim === 'assets')       animAssets(ctx, w, h, t, dataRef, imagesRef)
      rafRef.current = requestAnimationFrame(loop)
    }
    const visObs = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible) { st = null; rafRef.current = requestAnimationFrame(loop) }
    }, { threshold: 0.05 })
    if (sectionRef.current) visObs.observe(sectionRef.current)
    rafRef.current = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); visObs.disconnect() }
  }, [])

  const handleClick = (i) => {
    lastClickRef.current = Date.now()
    setActive(i); activeRef.current = i; dataRef.current = null
  }

  const topRow    = stats.slice(0, 4)
  const bottomRow = stats.slice(4)

  return (
    <section
      className={`${styles.stats} ${revealed ? styles.revealed : ''}`}
      ref={sectionRef}
    >
      <div className={styles.container}>

        {/* ── Section header ── */}
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>In numbers</h2>
          <p className={styles.headerSub}>
            Real-time infrastructure metrics and capability benchmarks powering Sail.
          </p>
        </div>

        {/* ── Top row: live metrics ── */}
        <div className={styles.statsRow}>
          {topRow.map((stat, i) => (
            <button
              key={i}
              className={`${styles.statItem} ${active === i ? styles.statActive : ''}`}
              onClick={() => handleClick(i)}
            >
              <span className={styles.statValue}>{stat.value}</span>
              <span className={styles.statLabel}>{stat.label}</span>
              <span className={styles.statSub}>{stat.sublabel}</span>
            </button>
          ))}
        </div>

        <div className={styles.separator} />

        {/* ── Bottom row: capability stats ── */}
        <div className={styles.statsRow}>
          {bottomRow.map((stat, i) => (
            <button
              key={i + 4}
              className={`${styles.statItem} ${active === i + 4 ? styles.statActive : ''}`}
              onClick={() => handleClick(i + 4)}
            >
              <span className={styles.statValue}>{stat.value}</span>
              <span className={styles.statLabel}>{stat.label}</span>
              <span className={styles.statSub}>{stat.sublabel}</span>
            </button>
          ))}
        </div>

        <div className={styles.separator} />

        {/* ── Canvas animation ── */}
        <div className={styles.canvasWrap}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            style={{ opacity: active === 0 ? 0 : 1, transition: 'opacity 0.4s ease' }}
          />
          <div
            className={styles.sphereWrap}
            style={{ opacity: active === 0 ? 1 : 0, transition: 'opacity 0.4s ease' }}
          >
            <ParticleSphere showFlowParticles={false} showOverlay={false} scale={0.80} />
          </div>
        </div>

      </div>
    </section>
  )
}
