import { useEffect, useRef, useState } from 'react'
import styles from './ProductFeatures.module.css'

// Animated typing effect hook
function useTypingEffect(text, speed = 50, startDelay = 0) {
  const [displayText, setDisplayText] = useState('')
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    let timeout
    let index = 0

    const startTyping = () => {
      const typeChar = () => {
        if (index < text.length) {
          setDisplayText(text.slice(0, index + 1))
          index++
          timeout = setTimeout(typeChar, speed)
        } else {
          setIsComplete(true)
        }
      }
      typeChar()
    }

    timeout = setTimeout(startTyping, startDelay)
    return () => clearTimeout(timeout)
  }, [text, speed, startDelay])

  return { displayText, isComplete }
}

// Terminal Card Component
function TerminalCard({ isVisible }) {
  const { displayText: line1, isComplete: line1Done } = useTypingEffect(
    'Initialize rebalancing for ',
    30,
    isVisible ? 500 : 99999
  )
  const { displayText: line2 } = useTypingEffect(
    'Analyzing liquidity depth across 4 exchanges. Optimal route secured.',
    25,
    isVisible ? 2500 : 99999
  )
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!isVisible) return
    const timer = setTimeout(() => {
      const interval = setInterval(() => {
        setProgress(p => {
          if (p >= 100) {
            clearInterval(interval)
            return 100
          }
          return p + 2
        })
      }, 50)
      return () => clearInterval(interval)
    }, 4000)
    return () => clearTimeout(timer)
  }, [isVisible])

  return (
    <div className={styles.terminalCard}>
      <div className={styles.terminalHeader}>
        <div className={styles.terminalDots}>
          <span className={styles.dot} />
          <span className={styles.dot} />
        </div>
        <span className={styles.terminalTitle}>SAIL_OS v3.2</span>
      </div>

      <div className={styles.terminalBody}>
        <div className={styles.messageBox}>
          <p>
            {line1}
            {line1.length > 0 && <strong>Portfolio Alpha</strong>}
            {line1Done && '. Target '}
            {line1Done && <span className={styles.highlight}>12.5% APY</span>}
            {line1Done && '.'}
          </p>
        </div>

        <div className={styles.protocolBox}>
          <div className={styles.protocolHeader}>
            <svg className={styles.protocolIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span>SAIL PROTOCOL</span>
          </div>
          <p className={styles.protocolText}>{line2}</p>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className={styles.terminalFooter}>
          <span className={styles.statusLabel}>EXECUTING</span>
          <span className={styles.statusValue}>$52,400.00</span>
        </div>
      </div>
    </div>
  )
}

// Network Visualization Component
function NetworkVisualization({ isVisible }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!isVisible) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animationId
    let time = 0

    const resize = () => {
      canvas.width = canvas.offsetWidth * 2
      canvas.height = canvas.offsetHeight * 2
      ctx.scale(2, 2)
    }
    resize()

    const nodes = [
      { x: 0.5, y: 0.5, size: 40, main: true },
      { x: 0.2, y: 0.3, size: 8 },
      { x: 0.25, y: 0.7, size: 10 },
      { x: 0.8, y: 0.25, size: 8 },
      { x: 0.75, y: 0.75, size: 12 },
      { x: 0.15, y: 0.5, size: 6 },
      { x: 0.85, y: 0.5, size: 6 },
    ]

    const connections = [
      [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
      [1, 5], [2, 5], [3, 6], [4, 6]
    ]

    const animate = () => {
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight
      ctx.clearRect(0, 0, w, h)
      time += 0.02

      // Draw connections
      connections.forEach(([a, b], i) => {
        const nodeA = nodes[a]
        const nodeB = nodes[b]
        const ax = nodeA.x * w
        const ay = nodeA.y * h
        const bx = nodeB.x * w
        const by = nodeB.y * h

        // Animated pulse along line
        const pulsePos = (Math.sin(time * 2 + i * 0.5) + 1) / 2

        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.strokeStyle = 'rgba(0, 0, 180, 0.15)'
        ctx.lineWidth = 1
        ctx.stroke()

        // Pulse dot
        const px = ax + (bx - ax) * pulsePos
        const py = ay + (by - ay) * pulsePos
        ctx.beginPath()
        ctx.arc(px, py, 2, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(0, 0, 180, 0.6)'
        ctx.fill()
      })

      // Draw nodes
      nodes.forEach((node, i) => {
        const x = node.x * w
        const y = node.y * h
        const pulse = Math.sin(time * 3 + i) * 2

        if (node.main) {
          // Main center node
          ctx.beginPath()
          ctx.arc(x, y, node.size + pulse, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(30, 60, 90, 0.8)'
          ctx.fill()
          ctx.strokeStyle = 'rgba(0, 0, 180, 0.4)'
          ctx.lineWidth = 2
          ctx.stroke()

          // Inner glow
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, node.size)
          gradient.addColorStop(0, 'rgba(0, 0, 180, 0.2)')
          gradient.addColorStop(1, 'rgba(0, 0, 180, 0)')
          ctx.beginPath()
          ctx.arc(x, y, node.size * 1.5, 0, Math.PI * 2)
          ctx.fillStyle = gradient
          ctx.fill()
        } else {
          // Smaller nodes
          ctx.beginPath()
          ctx.arc(x, y, node.size + pulse * 0.3, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(0, 0, 180, 0.3)'
          ctx.fill()
        }
      })

      animationId = requestAnimationFrame(animate)
    }

    animate()
    return () => cancelAnimationFrame(animationId)
  }, [isVisible])

  return (
    <div className={styles.networkCard}>
      <canvas ref={canvasRef} className={styles.networkCanvas} />
      <div className={styles.networkCenter}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <div className={styles.networkStatus}>
        <span className={styles.statusDot} />
        <span>NETWORK ACTIVE</span>
      </div>
    </div>
  )
}

// Treasury/Governance Card Component
function GovernanceCard({ isVisible }) {
  const [sliderValue, setSliderValue] = useState(70)
  const [showTooltip, setShowTooltip] = useState(false)

  useEffect(() => {
    if (!isVisible) return
    const timer = setTimeout(() => setShowTooltip(true), 2000)
    return () => clearTimeout(timer)
  }, [isVisible])

  return (
    <div className={styles.governanceCard}>
      <div className={styles.govHeader}>
        <div className={styles.govStatus}>
          <span className={styles.statusDotGreen} />
          <span>TREASURY_V4</span>
        </div>
        <div className={styles.govAvatars}>
          <span className={styles.avatar}>JD</span>
          <span className={styles.avatar}>AS</span>
          <span className={styles.avatarMore}>+3</span>
        </div>
      </div>

      <div className={styles.govBody}>
        <div className={styles.sliderSection}>
          <div className={styles.sliderHeader}>
            <span>ALLOCATION LIMIT</span>
            <div className={styles.tooltipWrapper}>
              <span className={styles.sliderValue}>{sliderValue}%</span>
              {showTooltip && (
                <div className={styles.tooltip}>Signed by Alex</div>
              )}
            </div>
          </div>
          <div className={styles.slider}>
            <div className={styles.sliderTrack}>
              <div
                className={styles.sliderFill}
                style={{ width: `${sliderValue}%` }}
              />
              <div
                className={styles.sliderThumb}
                style={{ left: `${sliderValue}%` }}
              />
            </div>
          </div>
        </div>

        <div className={styles.govActions}>
          <button className={styles.actionBtn}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            Audit Log
          </button>
          <button className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12l2 2 4-4" />
              <circle cx="12" cy="12" r="10" />
            </svg>
            Approve Tx
          </button>
        </div>
      </div>
    </div>
  )
}

// Main ProductFeatures Component
function ProductFeatures() {
  const sectionRef = useRef(null)
  const [isVisible, setIsVisible] = useState(false)
  const cardsRef = useRef([])

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2 }
    )

    if (sectionRef.current) {
      observer.observe(sectionRef.current)
    }

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!isVisible) return

    cardsRef.current.forEach((card, index) => {
      if (card) {
        setTimeout(() => {
          card.classList.add(styles.revealed)
        }, index * 200)
      }
    })
  }, [isVisible])

  const features = [
    {
      label: 'HTML Preview',
      title: 'Automated Execution',
      description: 'Generate high-yield strategies and execute trades in milliseconds with our custodial AI algorithms.',
      visual: 'terminal'
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      ),
      title: 'Smart Liquidity',
      description: 'Connect to deep liquidity pools across networks to ensure zero-slippage execution on institutional orders.',
      visual: 'network'
    },
    {
      title: 'Multi-Sig Governance',
      description: 'Manage treasury operations with institutional-grade security. Set permissions, approve transactions, and audit logs.',
      visual: 'governance'
    }
  ]

  return (
    <section className={styles.section} ref={sectionRef}>
      <div className={styles.container}>
        <div className={styles.grid}>
          {features.map((feature, index) => (
            <div
              key={index}
              className={styles.card}
              ref={el => cardsRef.current[index] = el}
            >
              <div className={styles.cardContent}>
                {feature.label && (
                  <span className={styles.label}>{feature.label}</span>
                )}
                <h3 className={styles.title}>
                  {feature.icon && <span className={styles.titleIcon}>{feature.icon}</span>}
                  {feature.title}
                </h3>
                <p className={styles.description}>{feature.description}</p>
              </div>

              <div className={styles.cardVisual}>
                {feature.visual === 'terminal' && <TerminalCard isVisible={isVisible} />}
                {feature.visual === 'network' && <NetworkVisualization isVisible={isVisible} />}
                {feature.visual === 'governance' && <GovernanceCard isVisible={isVisible} />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default ProductFeatures
