import styles from './SectionCard.module.css'

export default function SectionCard({ children, index, first = false }) {
  return (
    <div
      className={`${styles.card} ${first ? styles.cardFirst : ''}`}
      style={{ zIndex: 10 + index }}
      data-card-index={index}
    >
      {children}
    </div>
  )
}
