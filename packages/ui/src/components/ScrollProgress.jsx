import { useEffect, useState } from 'react'
import styles from './ScrollProgress.module.css'

const SECTIONS = [
  { index: 0, label: 'Hero' },
  { index: 1, label: 'About' },
  { index: 2, label: 'Security Agent' },
  { index: 3, label: 'Yield Agent' },
  { index: 4, label: 'Protocol' },
  { index: 5, label: 'Users' },
  { index: 6, label: 'FAQ' },
]

export default function ScrollProgress() {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const cards = [...document.querySelectorAll('[data-card-index]')]
    const update = () => {
      let current = 0
      for (const card of cards) {
        if (card.getBoundingClientRect().top <= 80) {
          current = parseInt(card.dataset.cardIndex)
        }
      }
      setActive(prev => prev === current ? prev : current)
    }
    window.addEventListener('scroll', update, { passive: true })
    update()
    return () => window.removeEventListener('scroll', update)
  }, [])

  return (
    <div className={`${styles.wrap} ${active > 0 ? styles.wrapVisible : ''}`}>
      {SECTIONS.map(({ index, label }) => (
        <div
          key={index}
          className={`${styles.item} ${index === active ? styles.itemActive : ''} ${index < active ? styles.itemPast : ''} ${index === 1 ? styles.itemAbout : ''}`}
          onClick={() => {
            const card = document.querySelector(`[data-card-index="${index}"]`)
            card?.scrollIntoView({ behavior: 'smooth' })
          }}
        >
          <span className={styles.dot} />
          {index !== 0 && <span className={styles.label}>{label}</span>}
        </div>
      ))}
    </div>
  )
}
