import { useEffect, useState } from 'react'
import styles from './WebAgentPage.module.css'
import WebAgentSection from './WebAgentSection'
import Header from './Header'
import AmbientBackground from './AmbientBackground'

const WORDS = ['Autonomously.', 'Safely.']

function useTypewriter(words, typingSpeed = 80, deletingSpeed = 50, pauseMs = 1800) {
  const [display, setDisplay] = useState('')
  const [wordIdx, setWordIdx] = useState(0)
  const [phase, setPhase] = useState('typing') // typing | pausing | deleting

  useEffect(() => {
    const word = words[wordIdx]
    if (phase === 'typing') {
      if (display.length < word.length) {
        const t = setTimeout(() => setDisplay(word.slice(0, display.length + 1)), typingSpeed)
        return () => clearTimeout(t)
      } else {
        const t = setTimeout(() => setPhase('deleting'), pauseMs)
        return () => clearTimeout(t)
      }
    }
    if (phase === 'deleting') {
      if (display.length > 0) {
        const t = setTimeout(() => setDisplay(d => d.slice(0, -1)), deletingSpeed)
        return () => clearTimeout(t)
      } else {
        setWordIdx(i => (i + 1) % words.length)
        setPhase('typing')
      }
    }
  }, [display, phase, wordIdx, words, typingSpeed, deletingSpeed, pauseMs])

  return display
}

export default function WebAgentPage({ onBack }) {
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const typed = useTypewriter(WORDS)

  return (
    <div className={styles.page}>
      <AmbientBackground />
      <Header onOpenApi={() => {}} />

      <div className={styles.content}>

        {/* Hero */}
        <div className={styles.heroSection}>
          <div className={styles.heroInner}>
            <div className={styles.heroNav}>
              <button className={styles.backBtn} onClick={onBack}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Back to Sail
              </button>
              <div className={styles.heroBadge}>
                <span className={styles.heroBadgeDot} />
                Stablecoin Agent
              </div>
            </div>
            <h1 className={styles.heroTitle}>
              Earn <span className={styles.heroTyped}>{typed}<span className={styles.heroCursor} /></span>
            </h1>
            <p className={styles.heroSubtitle}>
              A Personal AI agent that keeps your stablecoins actively earning, safe, and fully under your control.
            </p>
          </div>
        </div>

        {/* Sections */}
        <div className={styles.sections}>
          <div className={styles.sectionCard} style={{ background: '#050D1F', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <WebAgentSection />
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
