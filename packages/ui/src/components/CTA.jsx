import { useEffect, useRef } from 'react'
import Button from './Button'
import styles from './CTA.module.css'

function CTA({ onOpenApi }) {
  const sectionRef = useRef(null)
  const contentRef = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          contentRef.current?.classList.add(styles.revealed)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )

    if (sectionRef.current) {
      observer.observe(sectionRef.current)
    }

    return () => observer.disconnect()
  }, [])

  return (
    <section className={styles.section} ref={sectionRef}>

      <div className={styles.container}>
        <div className={styles.content} ref={contentRef}>
          <h2 className={styles.title}>Unlocking Personalized<br />finance for all</h2>
          <div className={styles.buttons}>
            <Button variant="primary" magnetic className={styles.button} onClick={onOpenApi}>
              Contact Team
            </Button>
            <a
              href="#"
              className={styles.docsLink}
              onClick={(e) => { e.preventDefault(); if (onOpenApi) onOpenApi() }}
            >
              <span>Open Docs</span>
              <span className={styles.docsLinkArrow} aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

export default CTA
