import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import styles from './AmbientBackground.module.css'

const SCALE = 3

// Each wave: direction (kx,ky), speed, amplitude, phase offset
// Mixing long slow swells with shorter mid-frequency waves creates natural ocean movement
const WAVES = [
  { kx:  0.013, ky:  0.007, speed: 0.55, amp: 52, phase: 0.0 },
  { kx: -0.009, ky:  0.016, speed: 0.45, amp: 44, phase: 1.8 },
  { kx:  0.020, ky: -0.011, speed: 0.70, amp: 30, phase: 3.2 },
  { kx: -0.015, ky: -0.018, speed: 0.58, amp: 26, phase: 0.9 },
  { kx:  0.030, ky:  0.022, speed: 0.90, amp: 13, phase: 2.5 },
]

function AmbientBackground() {
  const canvasRef = useRef(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    let animationId
    let W = 0, H = 0
    let imgData  = null
    let time     = 0
    let isActive = true

    const init = () => {
      W = Math.ceil(window.innerWidth  / SCALE)
      H = Math.ceil(window.innerHeight / SCALE)
      canvas.width  = W
      canvas.height = H
      imgData = ctx.createImageData(W, H)
      for (let i = 3; i < imgData.data.length; i += 4) imgData.data[i] = 255
    }

    const render = () => {
      const d = imgData.data
      const t = time

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          // Analytically compute height + surface gradient from overlapping waves
          let gx = 0, gy = 0

          for (const w of WAVES) {
            const arg = w.kx * x + w.ky * y + w.speed * t + w.phase
            const c   = Math.cos(arg)   // derivative of sin — gives the gradient
            gx += w.amp * w.kx * c
            gy += w.amp * w.ky * c
          }

          // Lighting — thresholds calibrated for sine-wave gradient scale (~0–4)
          const raw     = -gx - gy
          const diffuse = Math.max(0, raw * 0.06)
          const spec    = raw > 0 ? Math.pow(Math.min(raw / 3.5, 1), 3.0) * 0.9 : 0

          const p = (y * W + x) * 4
          d[p]     = Math.min(255, 18 + diffuse * 10 + spec * 100)
          d[p + 1] = Math.min(255, 38 + diffuse * 25 + spec * 100)
          d[p + 2] = Math.min(255, 165 + diffuse * 80 + spec * 140)
        }
      }

      ctx.putImageData(imgData, 0, 0)
    }

    const animate = () => {
      if (!isActive) return
      if (!prefersReducedMotion) time += 0.008
      render()
      if (!prefersReducedMotion) animationId = requestAnimationFrame(animate)
    }

    const onResize = () => init()
    window.addEventListener('resize', onResize)

    init()
    animate()

    return () => {
      isActive = false
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', onResize)
    }
  }, [prefersReducedMotion])

  return <canvas ref={canvasRef} className={styles.canvas} />
}

export default AmbientBackground
