import { useEffect, useRef } from 'react'
import styles from './HowItWorks.module.css'

const segments = [
  {
    tag: 'Neobanks & Fintechs',
    title: 'Give users yield that banks won\'t.',
    description: 'Your users\' idle cash earns nothing. Sail routes it to best-in-class returns automatically — no new engineering, no compliance burden on your side.',
    gradient: 'linear-gradient(135deg, #000B2E 0%, #0030CC 100%)',
    color: '#0090FF',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    tag: 'Wealth Managers',
    title: 'AI monitoring that never sleeps.',
    description: 'Replace manual portfolio reviews with an AI agent that monitors every position 24/7, surfaces risks early, and triggers rebalancing on your behalf.',
    gradient: 'linear-gradient(135deg, #001A70 0%, #0040CC 100%)',
    color: '#2B80FF',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    tag: 'Payment Platforms',
    title: 'Turn float into a revenue line.',
    description: 'Transaction float sitting in settlement accounts earns nothing. Sail turns idle reserves into yield revenue with zero engineering lift from your team.',
    gradient: 'linear-gradient(135deg, #0030CC 0%, #1990FF 100%)',
    color: '#66c2ff',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
  },
  {
    tag: 'Enterprise & Banks',
    title: 'Your brand. Our infrastructure.',
    description: 'White-label the full Sail stack under your brand. We handle model training, compliance, and infrastructure — you take all the credit with your clients.',
    gradient: 'linear-gradient(135deg, #1990FF 0%, #66c2ff 100%)',
    color: '#A8D8FF',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
]

function HowItWorks() {
  const sectionRef = useRef(null)
  const cardsRef = useRef([])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const card = entry.target
            const index = cardsRef.current.indexOf(card)
            setTimeout(() => {
              card.classList.add(styles.revealed)
            }, index * 120)
            observer.unobserve(card)
          }
        })
      },
      { threshold: 0.1 }
    )

    cardsRef.current.forEach((card) => {
      if (card) observer.observe(card)
    })

    return () => observer.disconnect()
  }, [])

  return (
    <section className={styles.section} ref={sectionRef}>
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.label}>Solutions</span>
          <h2 className={styles.title}>Built for every type<br />of financial product</h2>
          <p className={styles.subtitle}>
            Whether you're a startup or a global institution, Sail adapts to your stack, your compliance requirements, and your users.
          </p>
        </div>

        <div className={styles.grid}>
          {segments.map((segment, index) => (
            <div
              key={index}
              className={styles.card}
              ref={el => cardsRef.current[index] = el}
            >
              <div className={styles.cardIcon} style={{ color: segment.color }}>
                {segment.icon}
                <div className={styles.iconGlow} style={{ background: segment.gradient }} />
              </div>
              <span className={styles.tag}>{segment.tag}</span>
              <h3 className={styles.cardTitle}>{segment.title}</h3>
              <p className={styles.cardDescription}>{segment.description}</p>
              <div className={styles.cardAccent} style={{ background: segment.gradient }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default HowItWorks
