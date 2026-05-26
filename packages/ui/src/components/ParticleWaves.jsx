import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import styles from './ParticleWaves.module.css'

const SPACING = 13   // dot grid pitch (px)
const RADIUS  = 4.2  // dot radius (px)

/* ── Wave kernels ───────────────────────────────────────────────────────────
   asymCrest : sin(θ) - 0.45·sin(2θ)  — long gentle rise, steep right drop
   stokesCrest: sin + harmonics        — sharper peaked crests, flat troughs
   domeCrest  : sin^0.30               — stays near peak much longer → wide
                                         rounded dome top (Fibonacci feel)
   All clamped to ≥ 0 so negatives become flat water.                       */
function asymCrest(phase) {
  return Math.max(0, Math.sin(phase) - 0.45 * Math.sin(2 * phase))
}
function stokesCrest(phase) {
  return Math.max(0,
    Math.sin(phase)
    + 0.50 * Math.sin(2 * phase)
    + 0.18 * Math.sin(3 * phase)
  )
}
function domeCrest(phase) {
  const s = Math.sin(phase)
  if (s <= 0) return 0
  return Math.pow(s, 0.30)   // sub-linear power: crest is wide & flat-topped
}

export default function ParticleWaves() {
  const canvasRef = useRef(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    let width = 0, height = 0, animId
    let t = 0, lastTs = null

    /* ── Resize ─────────────────────────────────────────────────────── */
    const resize = () => {
      const dpr  = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      width  = rect.width
      height = rect.height
      canvas.width  = width  * dpr
      canvas.height = height * dpr
      ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    /* ── Wave layers ────────────────────────────────────────────────────
       Frequencies chosen so their positive half-cycles produce 5–7
       distinct visible humps across a 1400 px viewport.
       Different speeds create interference → varied heights & spacing.  */
    const WAVE_DEFS = [
      // ── Dome swells — slow, long, rounded tops (not always visible) ──
      { k: 0.0062, speed: 0.088, A: 0.052, phase: 1.40, fn: domeCrest   },
      { k: 0.0091, speed: 0.148, A: 0.038, phase: 4.85, fn: domeCrest   },
      // ── Primary swells ───────────────────────────────────────────────
      { k: 0.0240, speed: 0.310, A: 0.082, phase: 0.00, fn: asymCrest   },
      { k: 0.0310, speed: 0.420, A: 0.055, phase: 2.10, fn: asymCrest   },
      { k: 0.0185, speed: 0.235, A: 0.046, phase: 4.40, fn: asymCrest   },
      // ── Stokes swells ────────────────────────────────────────────────
      { k: 0.0088, speed: 0.160, A: 0.036, phase: 1.10, fn: stokesCrest },
      { k: 0.0140, speed: 0.280, A: 0.030, phase: 3.30, fn: stokesCrest },
      // ── Extra layers for richer interference (less repetition) ──────
      { k: 0.0173, speed: 0.268, A: 0.038, phase: 5.50, fn: asymCrest   },
      { k: 0.0267, speed: 0.375, A: 0.032, phase: 1.85, fn: stokesCrest },
      { k: 0.0390, speed: 0.530, A: 0.026, phase: 3.10, fn: asymCrest   },
      // ── Chop & fine detail ──────────────────────────────────────────
      { k: 0.0420, speed: 0.600, A: 0.022, phase: 1.30, fn: asymCrest   },
      { k: 0.0570, speed: 0.860, A: 0.012, phase: 3.80, fn: stokesCrest },
      { k: 0.0650, speed: 1.050, A: 0.008, phase: 0.45, fn: stokesCrest },
    ]

    function waveTop(x, time) {
      const base = height * 0.68   // slightly higher base to compensate shorter crests
      let sum = 0
      for (const w of WAVE_DEFS) {
        sum += w.fn(w.k * x - w.speed * time + w.phase) * w.A * height
      }
      return base - sum
    }

    /* ── Spray particle system ──────────────────────────────────────── */
    const SPRAY_COLORS = [
      [130, 190, 255],
      [ 90, 155, 255],
      [180, 215, 255],
      [ 43, 128, 255],
      [160, 200, 255],
    ]

    class Spray {
      constructor(x, y) {
        this.x  = x + (Math.random() - 0.5) * SPACING * 3
        this.y  = y - Math.random() * 4
        // Bias velocity rightward (wave propagates left→right)
        this.vx = 20 + Math.random() * 70 * (Math.random() < 0.25 ? -1 : 1)
        this.vy = -(Math.random() * 130 + 35)
        this.life    = 0
        this.maxLife = 0.55 + Math.random() * 0.65
        this.r       = 1.8 + Math.random() * 3.0
        const [r, g, b] = SPRAY_COLORS[Math.floor(Math.random() * SPRAY_COLORS.length)]
        this.rgb = `${r},${g},${b}`
      }

      update(dt) {
        this.vy  += 240 * dt      // gravity
        this.x   += this.vx * dt
        this.y   += this.vy * dt
        this.life += dt
        return this.life < this.maxLife && this.y < height + 20
      }

      draw() {
        const p     = this.life / this.maxLife
        const alpha = (1 - p) * 0.80
        const r     = this.r * (1 - p * 0.35)
        ctx.beginPath()
        ctx.arc(this.x, this.y, Math.max(0.5, r), 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${this.rgb},${alpha.toFixed(2)})`
        ctx.fill()
      }
    }

    const spray = []
    const spawnCooldown = {}

    function spawnCluster(x, y) {
      const n = 2 + Math.floor(Math.random() * 4)   // 2–5 particles
      for (let i = 0; i < n; i++) spray.push(new Spray(x, y))
    }

    /* ── Animation loop ─────────────────────────────────────────────── */
    let prevTops = null

    const animate = (ts) => {
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016
      lastTs = ts
      if (!prefersReducedMotion) t += dt

      ctx.clearRect(0, 0, width, height)
      if (width === 0 || height === 0) { animId = requestAnimationFrame(animate); return }

      const cols = Math.ceil(width  / SPACING) + 2
      const rows = Math.ceil(height / SPACING) + 2
      const tops = new Float32Array(cols)

      /* ── Draw wave body ─────────────────────────────────────── */
      for (let col = 0; col < cols; col++) {
        const x   = col * SPACING
        const top = waveTop(x, t)
        tops[col] = top

        for (let row = 0; row < rows; row++) {
          const y = height - row * SPACING    // row 0 = canvas bottom

          if (y < top) break                  // above wave surface — stop

          // How close to the wave surface: 0 = deep, 1 = at surface
          const depthRatio  = (y - top) / Math.max(1, height - top)
          const surfaceProx = 1 - depthRatio

          // Alpha: bright at surface, fades toward the bottom
          const alpha = 0.07 + surfaceProx * 0.75

          // Subtle colour texture — slight variation per dot
          const v = (col * 3 + row * 7) % 14
          let r, g, b
          if (v < 2)       { r = 165; g = 212; b = 255 }   // foam highlight
          else if (v < 5)  { r =   0; g =  55; b = 200 }   // deep navy
          else             { r =  43; g = 128; b = 255 }   // main blue

          ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`
          ctx.beginPath()
          ctx.arc(x, y, RADIUS, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      /* ── Spawn spray at crests ──────────────────────────────── */
      if (!prefersReducedMotion && prevTops) {
        for (let col = 2; col < cols - 2; col++) {
          // Local minimum in y = local maximum in height = crest
          const isCrest = tops[col] < tops[col - 1] &&
                          tops[col] < tops[col + 1] &&
                          tops[col] < tops[col - 2] &&
                          tops[col] < tops[col + 2]

          if (!isCrest) continue

          // Only spray if this crest is meaningfully tall
          const crestH = height * 0.66 - tops[col]
          if (crestH < height * 0.07) continue

          const key = Math.round(col / 4)
          spawnCooldown[key] = (spawnCooldown[key] || 0) - dt
          if (spawnCooldown[key] <= 0 && Math.random() < 0.025) {
            spawnCluster(col * SPACING, tops[col])
            spawnCooldown[key] = 1.2 + Math.random() * 1.0
          }
        }
      }
      prevTops = tops

      /* ── Update and draw spray ──────────────────────────────── */
      for (let i = spray.length - 1; i >= 0; i--) {
        if (!spray[i].update(dt)) spray.splice(i, 1)
        else spray[i].draw()
      }

      animId = requestAnimationFrame(animate)
    }

    animId = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('resize', resize)
      ro.disconnect()
      cancelAnimationFrame(animId)
    }
  }, [prefersReducedMotion])

  return <canvas ref={canvasRef} className={styles.canvas} />
}
