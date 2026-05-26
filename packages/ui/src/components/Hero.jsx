import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import ParticleWaves from './ParticleWaves'
import Button from './Button'
import styles from './Hero.module.css'

function Hero() {
  const heroRef = useRef(null)
  const contentRef = useRef(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    if (prefersReducedMotion) return

    const handleScroll = () => {
      const hero = heroRef.current
      const content = contentRef.current
      if (!hero || !content) return

      const scrollY = window.scrollY
      const heroHeight = hero.offsetHeight

      if (scrollY < heroHeight) {
        const progress = scrollY / heroHeight
        content.style.opacity = 1 - progress * 1.5
        content.style.transform = `translateY(${scrollY * 0.3}px)`
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [prefersReducedMotion])

  return (
    <section className={styles.hero} ref={heroRef}>
      <div className={styles.sphereContainer}>
        <ParticleWaves />

        {/* All text + buttons overlay the waves */}
        <div className={styles.overlay} ref={contentRef}>
          <div className={styles.content}>
            <h1 className={styles.title}>Personal Finance Agents</h1>
            <p className={styles.description}>
              Grow and protect your money with AI agents that adapt to you.
            </p>
          </div>
          <div className={styles.cta}>
            <Button variant="primary" magnetic className={styles.ctaButton}>
              Get Started
            </Button>
            <Button magnetic className={styles.ctaButton}>
              Learn More
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export default Hero
