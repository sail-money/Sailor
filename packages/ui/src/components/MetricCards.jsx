import { useEffect, useRef, useState } from 'react'
import styles from './MetricCards.module.css'

const metrics = [
  { label: 'Total Value Locked', value: '$2.4B' },
  { label: 'Average APY', value: '18.5%' },
  { label: 'Active Users', value: '142K' },
]

function MetricCards() {
  const svgRef = useRef(null)
  const containerRef = useRef(null)
  const animationRef = useRef(null)
  const [time, setTime] = useState(0)

  useEffect(() => {
    let startTime = Date.now()

    const animate = () => {
      const elapsed = (Date.now() - startTime) / 1000
      setTime(elapsed)
      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const updateLines = () => {
      const svg = svgRef.current
      const container = containerRef.current
      if (!svg || !container) return

      const containerRect = container.getBoundingClientRect()
      const cards = container.querySelectorAll(`.${styles.card}`)

      // Clear existing paths
      while (svg.firstChild) {
        svg.removeChild(svg.firstChild)
      }

      // Single connection point on the right edge of the sphere
      const sphereRadius = 231
      const sphereCenterX = containerRect.width / 2
      const sphereCenterY = containerRect.height / 2

      // Connection point: right corner of sphere with subtle wave (matching sphere rotation)
      const connectionWave = Math.sin(time * 1.5) * 8
      const startX = sphereCenterX + sphereRadius + 20
      const startY = sphereCenterY + connectionWave

      // Draw a larger glowing particle at the connection point
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      dot.setAttribute('cx', startX)
      dot.setAttribute('cy', startY)
      dot.setAttribute('r', '6')
      dot.setAttribute('class', styles.connectionDot)
      svg.appendChild(dot)

      // Add outer glow ring
      const glowRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      glowRing.setAttribute('cx', startX)
      glowRing.setAttribute('cy', startY)
      glowRing.setAttribute('r', '12')
      glowRing.setAttribute('class', styles.connectionGlow)
      svg.appendChild(glowRing)

      cards.forEach((card, index) => {
        const cardRect = card.getBoundingClientRect()
        const cardLeft = cardRect.left - containerRect.left
        const cardCenterY = cardRect.top - containerRect.top + cardRect.height / 2

        // End point with subtle wave matching card movement
        const endWaveY = Math.sin(time * 2 + index * 0.8) * 6
        const endWaveX = Math.cos(time * 1.5 + index * 0.6) * 3
        const endX = cardLeft + endWaveX
        const endY = cardCenterY + endWaveY

        // Create curved path from single point to each card
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')

        // Control points for smooth bezier curve that fans out
        const cp1x = startX + (endX - startX) * 0.4
        const cp1y = startY + (endY - startY) * 0.2
        const cp2x = startX + (endX - startX) * 0.7
        const cp2y = endY

        const d = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`

        path.setAttribute('d', d)
        path.setAttribute('class', styles.line)

        svg.appendChild(path)
      })
    }

    updateLines()
    window.addEventListener('resize', updateLines)

    return () => {
      window.removeEventListener('resize', updateLines)
    }
  }, [time])

  // Calculate wave offsets for cards - more noticeable movement
  const getCardStyle = (index) => {
    const waveY = Math.sin(time * 2 + index * 0.8) * 6
    const waveX = Math.cos(time * 1.5 + index * 0.6) * 3
    const rotate = Math.sin(time * 1.8 + index * 0.5) * 0.5
    return {
      transform: `translate(${waveX}px, ${waveY}px) rotate(${rotate}deg)`,
    }
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <svg className={styles.svg} ref={svgRef} />
      <div className={styles.cards}>
        {metrics.map((metric, index) => (
          <div
            key={index}
            className={styles.card}
            style={getCardStyle(index)}
          >
            <span className={styles.value}>{metric.value}</span>
            <span className={styles.label}>{metric.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default MetricCards
