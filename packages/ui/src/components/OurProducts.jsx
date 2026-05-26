import { useEffect, useRef, useState } from 'react'
import ShaderCanvas from './ShaderCanvas'
import styles from './OurProducts.module.css'

/* ── Liquid switcher canvas ──────────────────────────────────────────────── */
// Two separate canvases (one per button) — CSS border-radius clips them cleanly,
// no JS ctx.clip() = no dark artifact rings.
export function LiquidSwitcher({ active, onChange }) {
  const canvasLRef = useRef(null)
  const canvasRRef = useRef(null)
  const raf = useRef(null)
  const s = useRef({
    levelL: 1.0,
    levelR: 0.0,
    targetL: 1.0,
    targetR: 0.0,
    phase: 0,
    ctime: 0,    // slow caustic time
    amp: 2.5,
    targetAmp: 2.5,
  })

  useEffect(() => {
    s.current.targetL   = active === 0 ? 1.0 : 0.0
    s.current.targetR   = active === 0 ? 0.0 : 1.0
    s.current.targetAmp = 9  // slosh on switch
  }, [active])

  useEffect(() => {
    const canvases = [canvasLRef.current, canvasRRef.current]
    const ctxs = canvases.map(c => c.getContext('2d'))
    const dpr = window.devicePixelRatio || 1

    function resize() {
      canvases.forEach(c => {
        c.width  = c.offsetWidth  * dpr
        c.height = c.offsetHeight * dpr
      })
    }
    resize()
    window.addEventListener('resize', resize)

    function lerp(a, b, k) { return a + (b - a) * k }

    function drawWater(ctx, w, h, level, ph, amp, t) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (level <= 0.005) return

      const topY = h * (1 - level)

      // 3-frequency wave surface
      function wy(x) {
        return topY
          + Math.sin(x * 0.045 + ph)       * amp
          + Math.sin(x * 0.11  + ph * 1.6) * amp * 0.38
          + Math.sin(x * 0.22  + ph * 2.8) * amp * 0.15
      }

      // Draw the water body path with a given fill style
      function fillWater(style, op) {
        ctx.save()
        if (op) ctx.globalCompositeOperation = op
        ctx.beginPath()
        ctx.moveTo(0, h)
        ctx.lineTo(w, h)
        ctx.lineTo(w, wy(w) + amp)
        for (let x = w; x >= 0; x -= 1) ctx.lineTo(x, wy(x))
        ctx.closePath()
        ctx.fillStyle = style
        ctx.fill()
        ctx.restore()
      }

      // ── Base: deep vivid pool blue ────────────────────────────────────
      const base = ctx.createLinearGradient(0, topY, 0, h)
      base.addColorStop(0,   `rgba(0,  60, 180, ${0.92 * level})`)
      base.addColorStop(0.4, `rgba(0,  35, 130, ${0.97 * level})`)
      base.addColorStop(1,   `rgba(0,  15,  70, ${1.00 * level})`)
      fillWater(base)

      // ── Broad caustic light patches (soft blue-white ripple crests) ───
      for (let i = 0; i < 3; i++) {
        const bph = i * 2.094
        const cx  = w * (0.5 + Math.cos(t * 0.28 + bph) * 0.45)
        const cy  = topY + (h - topY) * (0.35 + Math.sin(t * 0.21 + bph) * 0.30)
        const r   = Math.max(w, h) * 0.90
        const rg  = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
        rg.addColorStop(0,    `rgba(120, 200, 255, ${0.50 * level})`)
        rg.addColorStop(0.25, `rgba( 60, 150, 240, ${0.28 * level})`)
        rg.addColorStop(0.6,  `rgba( 20,  80, 180, ${0.10 * level})`)
        rg.addColorStop(1,    'rgba(0, 40, 120, 0)')
        fillWater(rg, 'screen')
      }

      // ── Small sharp specular glints (tiny bright points drifting) ─────
      for (let i = 0; i < 4; i++) {
        const gph = i * 1.571  // 90° apart
        const gx  = w * (0.15 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.55 + gph)))
        const gy  = topY + (h - topY) * (0.2 + 0.5 * Math.abs(Math.sin(t * 0.38 + gph * 1.3)))
        const gr  = w * 0.18
        const gg  = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr)
        gg.addColorStop(0,    `rgba(255, 252, 240, ${0.70 * level})`)
        gg.addColorStop(0.3,  `rgba(180, 225, 255, ${0.35 * level})`)
        gg.addColorStop(1,    'rgba(80, 160, 255, 0)')
        fillWater(gg, 'screen')
      }

      // ── Surface shimmer band ──────────────────────────────────────────
      ctx.save()
      ctx.beginPath()
      for (let x = 0; x <= w; x += 0.5) {
        const y = wy(x)
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      for (let x = w; x >= 0; x -= 0.5) ctx.lineTo(x, wy(x) + 3)
      ctx.closePath()
      ctx.fillStyle = `rgba(180, 230, 255, ${0.85 * level})`
      ctx.fill()
      ctx.restore()
    }

    function draw() {
      s.current.levelL    = lerp(s.current.levelL,    s.current.targetL,   0.055)
      s.current.levelR    = lerp(s.current.levelR,    s.current.targetR,   0.055)
      s.current.amp       = lerp(s.current.amp,       s.current.targetAmp, 0.07)
      s.current.targetAmp = lerp(s.current.targetAmp, 2.5,                 0.04)
      s.current.phase += 0.038
      s.current.ctime += 0.009  // slow fluid drift

      const cL = canvasLRef.current
      const cR = canvasRRef.current
      drawWater(ctxs[0], cL.offsetWidth, cL.offsetHeight, s.current.levelL, s.current.phase,                s.current.amp, s.current.ctime)
      drawWater(ctxs[1], cR.offsetWidth, cR.offsetHeight, s.current.levelR, s.current.phase + Math.PI * 0.6, s.current.amp, s.current.ctime + 2.1)

      raf.current = requestAnimationFrame(draw)
    }

    draw()
    return () => { cancelAnimationFrame(raf.current); window.removeEventListener('resize', resize) }
  }, [])

  return (
    <div className={styles.switcherWrap}>
      <canvas ref={canvasLRef} className={`${styles.switcherCanvas} ${styles.switcherCanvasL}`} />
      <canvas ref={canvasRRef} className={`${styles.switcherCanvas} ${styles.switcherCanvasR}`} />
      <div className={styles.switcherTrack}>
        <button
          className={`${styles.switcherBtn} ${active === 0 ? styles.switcherBtnActive : ''}`}
          onClick={() => onChange(0)}
        >
          Web Agent
        </button>
        <button
          className={`${styles.switcherBtn} ${active === 1 ? styles.switcherBtnActive : ''}`}
          onClick={() => onChange(1)}
        >
          API / SDK
        </button>
      </div>
    </div>
  )
}

/* ── Code visual (API / SDK) ─────────────────────────────────────────────── */
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
          <span className={styles.ckw}>import</span>{' { Sail } '}
          <span className={styles.ckw}>from</span>{' '}
          <span className={styles.cstr}>'@sail/sdk'</span>{'\n\n'}
          <span className={styles.ckw}>const</span>{' client = '}
          <span className={styles.ckw}>new</span>{' '}
          <span className={styles.ccl}>Sail</span>{'({\n  apiKey: '}
          <span className={styles.cstr}>process.env.SAIL_KEY</span>
          {'\n})\n\n'}
          <span className={styles.ckw}>const</span>{' { apy, route } = '}
          <span className={styles.ckw}>await</span>
          {'\n  client.'}
          <span className={styles.cfn}>optimize</span>
          {'({\n    asset:  '}
          <span className={styles.cstr}>'USDC'</span>
          {',\n    amount: '}
          <span className={styles.cnum}>10_000</span>
          {'\n  })\n\n'}
          <span className={styles.ccm}>{'// → { apy: 6.4%, chain: \'Arbitrum\' }'}</span>
        </pre>
      </div>
      <div className={styles.codeGlow} />
    </div>
  )
}

/* ── Web Agent visual — ascending bar chart ──────────────────────────────── */
const BAR_DATA = [4,6,9,13,18,24,31,39,48,58,69,81,94,108,123,139,156,174,194,218]

function easeOutCubic(t) { return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3) }

function AgentVisual() {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const startRef  = useRef(null)
  const [balance, setBalance] = useState(11920)

  /* Balance count-up */
  useEffect(() => {
    const from = 11920, to = 14350, dur = 2600
    const t0 = performance.now()
    const tick = (now) => {
      const p = Math.min((now - t0) / dur, 1)
      setBalance(Math.floor(from + (to - from) * easeOutCubic(p)))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [])

  /* Chart animation — line draws left to right */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * dpr
      canvas.height = canvas.offsetHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const render = (ts) => {
      if (!startRef.current) startRef.current = ts
      const prog = Math.min((ts - startRef.current) / 1400, 1)

      const w = canvas.offsetWidth, h = canvas.offsetHeight
      ctx.clearRect(0, 0, w, h)

      const n    = BAR_DATA.length
      const maxV = Math.max(...BAR_DATA)
      const px = 12, py = 10
      const chartW = w - px * 2
      const chartH = h - py * 2
      const slotW  = chartW / n
      const barW   = slotW * 0.58

      BAR_DATA.forEach((val, i) => {
        /* Stagger each bar's entrance */
        const bp = easeOutCubic(Math.min((prog - (i / n) * 0.4) / 0.6, 1))
        if (bp <= 0) return

        const barH = (val / maxV) * chartH * bp
        const x    = px + i * slotW + (slotW - barW) / 2
        const y    = py + chartH - barH
        const r    = Math.min(4, barW / 2)
        const isLast = i === n - 1

        /* Blue gradient per bar — brighter on last */
        const g = ctx.createLinearGradient(x, y, x, py + chartH)
        if (isLast) {
          g.addColorStop(0,   'rgba(25, 144, 255, 1)')
          g.addColorStop(1,   'rgba(37,  80, 200, 0.5)')
        } else {
          const t = i / (n - 1)
          const alpha = 0.28 + t * 0.45
          g.addColorStop(0, `rgba(25, 144, 255, ${alpha})`)
          g.addColorStop(1, `rgba(37,  80, 200, ${alpha * 0.4})`)
        }
        ctx.fillStyle = g

        ctx.beginPath()
        ctx.moveTo(x + r, y)
        ctx.lineTo(x + barW - r, y)
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r)
        ctx.lineTo(x + barW, py + chartH)
        ctx.lineTo(x, py + chartH)
        ctx.lineTo(x, y + r)
        ctx.quadraticCurveTo(x, y, x + r, y)
        ctx.closePath()
        ctx.fill()

        /* Glow cap on tallest bar */
        if (isLast && bp > 0.85) {
          const capX = x + barW / 2
          const glow = ctx.createRadialGradient(capX, y, 0, capX, y, barW)
          glow.addColorStop(0, 'rgba(25, 144, 255, 0.5)')
          glow.addColorStop(1, 'rgba(25, 144, 255, 0)')
          ctx.fillStyle = glow
          ctx.beginPath(); ctx.arc(capX, y, barW, 0, Math.PI * 2); ctx.fill()
        }
      })

      if (prog < 1) rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className={styles.agentWrap}>
      <div className={styles.agentHeader}>
        <span className={styles.agentLabel}>Total balance</span>
        <div className={styles.agentBalance}>
          ${balance.toLocaleString()}
          <span className={styles.agentPct}>↑ 14.2%</span>
        </div>
      </div>
      <canvas ref={canvasRef} className={styles.agentCanvas} />
    </div>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 8h10M9 4.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

/* ── Section ─────────────────────────────────────────────────────────────── */
export default function OurProducts({ onOpenProtocol, onOpenIntelligence, onContact }) {
  const handleContact = onContact || onOpenProtocol || onOpenIntelligence
  const sectionRef = useRef(null)
  const [vis, setVis] = useState(false)

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVis(true) },
      { threshold: 0.1 }
    )
    if (sectionRef.current) obs.observe(sectionRef.current)
    return () => obs.disconnect()
  }, [])

  return (
    <section ref={sectionRef} className={styles.section}>
      <div className={styles.container}>

        <div className={`${styles.header} ${vis ? styles.headerVisible : ''}`}>

          {/* ── Two ways to use Sail ── */}
          <div className={styles.intro}>
            <p className={styles.eyebrow}>The Sail Stack</p>
            <h2 className={styles.title}>
              Unlocking Personalized finance for all.
            </h2>
            <p className={styles.subtitle}>
              Sail is the standard for on-chain Separately Managed Accounts —
              non-custodial by design, where allocators keep full self-custody and
              managers operate under cryptographically bounded delegation to deliver
              agent-managed, personalized finance for everyone.
            </p>
          </div>

          <div className={styles.dividerRow}>
            <div className={styles.dividerLine} />
            <span className={styles.dividerText}>Two ways to use Sail</span>
            <div className={styles.dividerLine} />
          </div>

        </div>

        <div className={`${styles.grid} ${vis ? styles.gridVisible : ''}`}>

          {/* Sail Protocol — immersive ripple-wave card with hover reveal */}
          <div className={`${styles.card} ${styles.cardImmersive}`} style={{ '--delay': '0ms' }}>
            <div className={styles.cardImmersiveBg}>
              <ShaderCanvas seed={0.7} tilt={0} mode={2} />
            </div>
            <div className={styles.cardImmersiveScrim} aria-hidden="true" />
            <div className={styles.cardImmersiveContent}>
              <div className={styles.cardImmersiveTextBg} aria-hidden="true" />
              <div className={styles.cardImmersiveBottom}>
                <h3 className={styles.cardImmersiveTitle}>Sail Protocol</h3>
                <div className={styles.cardImmersiveReveal}>
                  <div className={styles.cardImmersiveRevealInner}>
                    <p className={styles.cardImmersiveDesc}>
                      The open, non-custodial standard for onchain SMAs. Allocators keep
                      self-custody and onchain revocation; managers operate under
                      cryptographically bounded delegation — atomic fee settlement and
                      policy enforced at the calldata level.
                    </p>
                    <button
                      className={`${styles.arrowBtn} ${styles.arrowBtnWide} ${styles.cardImmersiveBtn}`}
                      onClick={handleContact}
                    >
                      Contact team <ArrowIcon />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sail Intelligence — immersive wave card with hover reveal */}
          <div className={`${styles.card} ${styles.cardImmersive}`} style={{ '--delay': '120ms' }}>
            <div className={styles.cardImmersiveBg}>
              <ShaderCanvas seed={2.3} tilt={1.4} mode={1} />
            </div>
            <div className={styles.cardImmersiveScrim} aria-hidden="true" />
            <div className={styles.cardImmersiveContent}>
              <div className={styles.cardImmersiveTextBg} aria-hidden="true" />
              <div className={styles.cardImmersiveBottom}>
                <h3 className={styles.cardImmersiveTitle}>Sail Intelligence</h3>
                <div className={styles.cardImmersiveReveal}>
                  <div className={styles.cardImmersiveRevealInner}>
                    <p className={styles.cardImmersiveDesc}>
                      A catalog of execution &amp; risk agents. Each agent is a modular,
                      subscription-based solution — integrate via a single API.
                    </p>
                    <button
                      className={`${styles.arrowBtn} ${styles.arrowBtnWide} ${styles.cardImmersiveBtn}`}
                      onClick={handleContact}
                    >
                      Contact team <ArrowIcon />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  )
}
