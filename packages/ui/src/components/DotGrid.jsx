import { useEffect, useRef } from 'react'

export default function DotGrid({ style, white, blueBottom }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const GAP = 22
    let animId
    let t = 0
    let offsets = []

    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      const cols = Math.ceil(canvas.width  / GAP) + 2
      const rows = Math.ceil(canvas.height / GAP) + 2
      offsets = Array.from({ length: rows * cols }, () => Math.random() * Math.PI * 2)
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const cols = Math.ceil(canvas.width  / GAP) + 1
      const rows = Math.ceil(canvas.height / GAP) + 1
      const cx = canvas.width  / 2
      const cy = canvas.height / 2
      const maxDist = Math.sqrt(cx * cx + cy * cy)

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * GAP
          const y = r * GAP

          // Distance from center — dots fade in toward edges, sparse at center
          const dx = x - cx
          const dy = y - cy
          const dist = Math.sqrt(dx * dx + dy * dy)
          const edgeFactor = Math.pow(dist / maxDist, 1.4) // 0 at center, 1 at corner

          const idx = r * (Math.ceil(canvas.width / GAP) + 2) + c
          const offset = offsets[idx] ?? 0

          // White mode: two waves at different speeds for ripple effect
          const pulse = white
            ? Math.max(0, Math.sin(t * 1.8 + offset) * 0.5 + 0.5) *
              Math.max(0, Math.sin(t * 0.7 + c * 0.3 + r * 0.2) * 0.5 + 0.5)
            : Math.sin(t + offset) * 0.5 + 0.5

          const alpha = white
            ? edgeFactor * (0.28 + pulse * 0.36)
            : edgeFactor * (0.22 + pulse * 0.35)
          if (alpha < 0.01) continue

          let color
          if (white) {
            if (blueBottom) {
              // Blend from white (top) to blue (bottom)
              const yFactor = Math.pow(y / canvas.height, 1.5)
              const r = Math.round((220 + pulse * 35) * (1 - yFactor) + 25  * yFactor)
              const g = Math.round((220 + pulse * 35) * (1 - yFactor) + 100 * yFactor)
              const b = Math.round((220 + pulse * 35) * (1 - yFactor) + 255 * yFactor)
              color = `rgba(${r},${g},${b},${alpha})`
            } else {
              const brightness = Math.round(220 + pulse * 35)
              color = `rgba(${brightness},${brightness},${brightness},${alpha})`
            }
          } else {
            // Warm tan → blue for cream background
            const blue = Math.round(160 + pulse * 60)
            color = `rgba(120,115,${blue},${alpha})`
          }

          const radius = 1.1
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fillStyle = color
          ctx.fill()
        }
      }

      t += white ? 0.014 : 0.008
      animId = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        ...style,
      }}
    />
  )
}
