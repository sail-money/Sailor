import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import styles from './ParticleSphere.module.css'
import IconCard from './IconCard'

const ICON_URLS = [
  '/protocol_logos/Group 403.png',
  '/protocol_logos/Group 427.png',
  '/protocol_logos/Group 428.png',
  '/protocol_logos/Group.png',
  '/protocol_logos/image 100.png',
  '/protocol_logos/image 101.png',
  '/protocol_logos/image 103.png',
  '/protocol_logos/image 111.png',
  '/protocol_logos/image 112.png',
  '/protocol_logos/image 4.png',
  '/protocol_logos/image 48.png',
  '/protocol_logos/image 97.png',
  '/protocol_logos/image 98.png',
  '/protocol_logos/image 99.png',
]

function ParticleSphere({ showSphere = true, showFlowParticles = true, showOverlay = true, scale = 1 }) {
  const canvasRef = useRef(null)
  const prefersReducedMotion = useReducedMotion()
  const [selectedIcon, setSelectedIcon] = useState(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const layers = [
      { radius: 80  * scale, particleCount: prefersReducedMotion ? 400  : 800,  brightness: 1.0, size: 1.2 },
      { radius: 155 * scale, particleCount: prefersReducedMotion ? 800  : 1600, brightness: 0.8, size: 1.0 },
      { radius: 231 * scale, particleCount: prefersReducedMotion ? 1200 : 2400, brightness: 0.6, size: 0.8 },
    ]

    const flowParticleCount  = showFlowParticles ? (prefersReducedMotion ? 800  : 3500) : 0
    const iconCount          = showSphere ? 22 : 0
    const outerRadius        = 231 * scale

    let width, height, centerX, centerY
    let time = 0
    let globalRotationY = 0
    let mouseX = 0, mouseY = 0, isMouseOver = false
    let targetMouseX = 0, targetMouseY = 0
    let hoveredIcon = null

    const layerParticles = layers.map(() => [])
    const flowParticles  = []
    const icons          = []
    const iconImages     = []

    ICON_URLS.forEach((url, i) => {
      const img = new Image(); img.src = url
      img.onload = () => { iconImages[i] = img }
    })

    class LayerParticle {
      constructor(layerIndex, layerConfig) {
        this.layerIndex = layerIndex
        this.radius     = layerConfig.radius
        this.brightness = layerConfig.brightness
        this.baseSize   = (0.4 + Math.random() * 0.6) * layerConfig.size
        const theta = Math.random() * Math.PI * 2
        const phi   = Math.acos((Math.random() * 2) - 1)
        this.baseTheta      = theta
        this.phi            = phi
        this.offsetX        = 0
        this.offsetY        = 0
        this.rotationOffset = (Math.random() - 0.5) * 0.001
      }

      update(t) {
        const theta = this.baseTheta + globalRotationY + this.rotationOffset * t
        this.x = this.radius * Math.sin(this.phi) * Math.cos(theta)
        this.y = this.radius * Math.cos(this.phi)
        this.z = this.radius * Math.sin(this.phi) * Math.sin(theta)

        if (isMouseOver && !prefersReducedMotion) {
          const perspective = 600
          const scale   = perspective / (perspective + this.z)
          const screenX = this.x * scale + centerX + this.offsetX
          const screenY = this.y * scale + centerY + this.offsetY
          const dx = mouseX - screenX, dy = mouseY - screenY
          const distance = Math.sqrt(dx * dx + dy * dy)
          const magnetRadius = 100
          if (distance < magnetRadius && distance > 5) {
            const force = Math.pow((magnetRadius - distance) / magnetRadius, 1.5)
            const angle = Math.atan2(dy, dx)
            this.offsetX += Math.cos(angle) * force * 5
            this.offsetY += Math.sin(angle) * force * 5
          }
        }
        this.offsetX *= 0.92
        this.offsetY *= 0.92
      }

      draw() {
        const perspective = 600
        const scale   = perspective / (perspective + this.z)
        const screenX = this.x * scale + centerX + this.offsetX
        const screenY = this.y * scale + centerY + this.offsetY

        if (showOverlay && Math.abs(this.y) < 65) return

        const size        = Math.max(0.5, this.baseSize * scale * 1.5)
        const depthFactor = (this.z + this.radius) / (this.radius * 2)
        const opacity     = Math.max(0.2, Math.min(0.9, depthFactor * 0.7 + 0.2)) * this.brightness
        const isDarkMode  = !document.body.classList.contains('light-mode')

        let r, g, b
        if (this.layerIndex === 0) {
          r = isDarkMode ? 245 : 255; g = isDarkMode ? 248 : 255; b = 255
        } else {
          const cb = this.layerIndex === 1 ? 0.9 : 0.7
          r = isDarkMode ? Math.min(255, 96 * cb) : 59
          g = isDarkMode ? Math.min(255, 165 * cb) : 130
          b = isDarkMode ? Math.min(255, 250 * cb) : 246
        }

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`
        ctx.beginPath()
        ctx.arc(screenX, screenY, size, 0, Math.PI * 2)
        ctx.fill()
        this.screenX = screenX; this.screenY = screenY
        this.depth = this.z;    this.scale = scale
      }
    }

    function drawWaveRing(innerR, outerR, t, opacity) {
      const perspective = 600
      const segments    = 60
      for (let i = 0; i < segments; i++) {
        const angle     = (i / segments) * Math.PI * 2
        const nextAngle = ((i + 1) / segments) * Math.PI * 2
        const wave1     = Math.sin(angle * 3 + t * 2) * 15
        const wave2     = Math.sin(nextAngle * 3 + t * 2) * 15
        const midRadius = (innerR + outerR) / 2
        const r1 = midRadius + wave1, r2 = midRadius + wave2
        const ra1 = angle + globalRotationY,     ra2 = nextAngle + globalRotationY
        const x1 = r1 * Math.cos(ra1), z1 = r1 * Math.sin(ra1)
        const x2 = r2 * Math.cos(ra2), z2 = r2 * Math.sin(ra2)
        const s1 = perspective / (perspective + z1), s2 = perspective / (perspective + z2)
        const sx1 = x1 * s1 + centerX, sx2 = x2 * s2 + centerX
        const d1  = (z1 + midRadius) / (midRadius * 2), d2 = (z2 + midRadius) / (midRadius * 2)
        const avgOp = ((d1 + d2) / 2) * opacity
        const isDarkMode = !document.body.classList.contains('light-mode')
        ctx.save()
        ctx.globalAlpha  = avgOp * 0.3
        ctx.strokeStyle  = isDarkMode ? 'rgba(0, 85, 255, 0.5)' : 'rgba(0, 55, 200, 0.4)'
        ctx.lineWidth    = 30
        ctx.lineCap      = 'round'
        ctx.filter       = 'blur(15px)'
        ctx.beginPath()
        ctx.moveTo(sx1, centerY)
        ctx.lineTo(sx2, centerY)
        ctx.stroke()
        ctx.restore()
      }
    }

    class FlowParticle {
      constructor(index, total) {
        this.index    = index
        this.total    = total
        this.baseSize = 0.3 + Math.random() * 0.4
        this.waveBand = Math.floor(Math.random() * 25)
        this.waveOffset = Math.random() * Math.PI * 0.2
        this.reset(true)
      }

      reset(initial = false) {
        this.x = initial ? -centerX + (this.index / this.total) * width : -centerX
        const bandHeight  = height / 35
        const bandCenter  = (this.waveBand - 12) * bandHeight
        this.startY = bandCenter + (Math.random() - 0.5) * bandHeight * 0.15
        this.y      = this.startY
        this.startZ = (Math.random() - 0.5) * outerRadius * 1.2
        this.z      = this.startZ
        this.speedX = 0.55 + Math.random() * 0.1
        this.offsetX = 0; this.offsetY = 0
      }

      update(t) {
        this.x += this.speedX
        const distFromCenter = Math.abs(this.x)
        const funnelZone     = outerRadius * 2.5
        const wavePhase      = t * 1.5 + this.waveBand * 0.25
        const baseWaveY      = Math.sin(wavePhase + this.x * 0.006) * 25
        const secWaveY       = Math.sin(t * 2.5 + this.x * 0.01 + this.waveBand * 0.15) * 12

        if (distFromCenter < funnelZone) {
          const fp = 1 - (distFromCenter / funnelZone)
          const fs = Math.pow(fp, 1.5)
          const spreadY = this.startY + baseWaveY + secWaveY
          if (distFromCenter < outerRadius * 0.8) {
            const cs = 1 - distFromCenter / (outerRadius * 0.8)
            this.y = spreadY * (1 - fs * 0.85)
            this.z = this.startZ * (1 - fs * 0.7)
            this.y += Math.sin(this.x * 0.02 + t * 2) * 8 * cs
            this.z += Math.cos(this.x * 0.02 + t * 2) * 8 * cs
          } else {
            this.y = spreadY * (1 - fs * 0.7)
            this.z = this.startZ * (1 - fs * 0.5)
          }
        } else {
          this.y = this.startY + baseWaveY + secWaveY
          this.z = this.startZ
        }
        this.y += Math.sin(t * 4 + this.x * 0.025) * 4

        if (isMouseOver && !prefersReducedMotion) {
          const scale   = 600 / (600 + this.z)
          const screenX = this.x * scale + centerX + this.offsetX
          const screenY = this.y * scale + centerY + this.offsetY
          const dx = mouseX - screenX, dy = mouseY - screenY
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 90 && dist > 3) {
            const force = Math.pow((90 - dist) / 90, 1.5)
            this.offsetX += (dx / dist) * force * 4
            this.offsetY += (dy / dist) * force * 4
          }
        }
        this.offsetX *= 0.88; this.offsetY *= 0.88
        if (this.x > centerX) this.reset(false)
      }

      draw() {
        const scale   = 600 / (600 + this.z)
        const screenX = this.x * scale + centerX + this.offsetX
        const screenY = this.y * scale + centerY + this.offsetY
        const dist3d  = Math.sqrt(this.x * this.x + this.z * this.z)
        if (dist3d < 80 && Math.abs(this.y) < 25) { this.depth = this.z; return }
        const size    = Math.max(0.3, this.baseSize * scale)
        const depth   = (this.z + outerRadius * 2) / (outerRadius * 4)
        const opacity = Math.max(0.2, Math.min(0.6, depth * 0.45 + 0.15))
        const isDarkMode = !document.body.classList.contains('light-mode')
        ctx.fillStyle = isDarkMode ? `rgba(0, 85, 255, ${opacity})` : `rgba(0, 55, 200, ${opacity})`
        ctx.beginPath()
        ctx.arc(screenX, screenY, size, 0, Math.PI * 2)
        ctx.fill()
        this.depth = this.z
      }
    }

    class Icon {
      constructor(iconIndex) {
        this.iconIndex = iconIndex % ICON_URLS.length
        const goldenRatio = (1 + Math.sqrt(5)) / 2
        this.baseTheta = 2 * Math.PI * iconIndex / goldenRatio
        this.phi       = Math.acos(1 - 2 * (iconIndex + 0.5) / iconCount)
        this.offsetX   = 0; this.offsetY = 0
      }

      update() {
        const theta = this.baseTheta + globalRotationY
        this.x = outerRadius * Math.sin(this.phi) * Math.cos(theta)
        this.y = outerRadius * Math.cos(this.phi)
        this.z = outerRadius * Math.sin(this.phi) * Math.sin(theta)

        if (isMouseOver && !prefersReducedMotion) {
          const scale   = 600 / (600 + this.z)
          const screenX = this.x * scale + centerX + this.offsetX
          const screenY = this.y * scale + centerY + this.offsetY
          const dx = mouseX - screenX, dy = mouseY - screenY
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 100 && dist > 5) {
            const force = Math.pow((100 - dist) / 100, 1.5)
            const angle = Math.atan2(dy, dx)
            this.offsetX += Math.cos(angle) * force * 6
            this.offsetY += Math.sin(angle) * force * 6
          }
        }
        this.offsetX *= 0.9; this.offsetY *= 0.9
      }

      draw() {
        if (!iconImages[this.iconIndex]) return
        if (showOverlay && Math.abs(this.y) < 65) return
        const scale   = 600 / (600 + this.z)
        const screenX = this.x * scale + centerX + this.offsetX
        const screenY = this.y * scale + centerY + this.offsetY
        const isHovered = hoveredIcon === this
        const size = 32 * scale * (isHovered ? 1.3 : 1)
        ctx.save()
        ctx.globalAlpha = isHovered ? 1 : 0.95
        ctx.shadowColor = `rgba(0, 110, 255, ${isHovered ? 0.9 : 0.7})`
        ctx.shadowBlur  = isHovered ? 30 : 20
        ctx.drawImage(iconImages[this.iconIndex], screenX - size / 2, screenY - size / 2, size, size)
        ctx.restore()
        this.screenX = screenX; this.screenY = screenY
        this.depth = this.z;    this.scale = scale
      }
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr  = window.devicePixelRatio || 1
      width = rect.width; height = rect.height
      centerX = width / 2; centerY = height / 2
      canvas.width  = width  * dpr; canvas.height = height * dpr
      ctx.scale(dpr, dpr)
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px'
    }

    resize()
    window.addEventListener('resize', resize)

    // ── Mouse ─────────────────────────────────────────────────────────────────
    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      targetMouseX = e.clientX - rect.left
      targetMouseY = e.clientY - rect.top
      isMouseOver  = true
      hoveredIcon  = null
      for (let i = icons.length - 1; i >= 0; i--) {
        const icon = icons[i]
        if (!icon.screenX) continue
        const size = 34 * (icon.scale || 1)
        if (Math.sqrt((targetMouseX - icon.screenX) ** 2 + (targetMouseY - icon.screenY) ** 2) < size) {
          hoveredIcon = icon; break
        }
      }
      canvas.style.cursor = hoveredIcon ? 'pointer' : 'default'
    }
    const handleMouseLeave = () => {
      isMouseOver = false; hoveredIcon = null
      canvas.style.cursor = 'default'
    }
    const handleClick = () => {
      if (hoveredIcon) setSelectedIcon({ index: hoveredIcon.iconIndex, url: ICON_URLS[hoveredIcon.iconIndex] })
    }

    canvas.addEventListener('mousemove',  handleMouseMove)
    canvas.addEventListener('mouseleave', handleMouseLeave)
    canvas.addEventListener('click',      handleClick)

    if (showSphere) {
      layers.forEach((cfg, li) => {
        for (let i = 0; i < cfg.particleCount; i++) layerParticles[li].push(new LayerParticle(li, cfg))
      })
      for (let i = 0; i < iconCount; i++) icons.push(new Icon(i))
    }
    if (showFlowParticles) {
      for (let i = 0; i < flowParticleCount; i++) flowParticles.push(new FlowParticle(i, flowParticleCount))
    }

    let animationId
    const animate = () => {
      ctx.clearRect(0, 0, width, height)

      if (!prefersReducedMotion) {
        time += 0.016
        globalRotationY += 0.002
        mouseX += (targetMouseX - mouseX) * 0.12
        mouseY += (targetMouseY - mouseY) * 0.12
      }

      if (showSphere) layerParticles.forEach(ps => ps.forEach(p => p.update(time)))
      if (showFlowParticles) flowParticles.forEach(p => p.update(time))
      if (showSphere) icons.forEach(icon => icon.update(time))

      const allParticles = [
        ...(showSphere ? layerParticles.flat() : []),
        ...(showFlowParticles ? flowParticles : []),
      ]
      allParticles.sort((a, b) => (a.z || a.depth || 0) - (b.z || b.depth || 0))
      allParticles.forEach(p => p.draw())

      if (showSphere) {
        icons.sort((a, b) => a.z - b.z)
        icons.forEach(icon => icon.draw())
      }

      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('mousemove',  handleMouseMove)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
      canvas.removeEventListener('click',      handleClick)
      cancelAnimationFrame(animationId)
    }
  }, [prefersReducedMotion])

  return (
    <>
      <canvas ref={canvasRef} className={styles.canvas} />
      {showOverlay && (
        <div className={styles.sphereOverlay}>
          <div className={styles.sphereMainTitle}>Personal Finance Agents</div>
          <div className={styles.sphereSubtitle}>Connect to the personalized finance engine of the world</div>
        </div>
      )}
      {showOverlay && selectedIcon && <IconCard icon={selectedIcon} onClose={() => setSelectedIcon(null)} />}
    </>
  )
}

export default ParticleSphere
