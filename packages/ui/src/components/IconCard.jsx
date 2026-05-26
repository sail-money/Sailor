import { useEffect, useState } from 'react'
import Button from './Button'
import styles from './IconCard.module.css'

function IconCard({ icon, onClose }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 300)
  }

  return (
    <div className={`${styles.overlay} ${visible ? styles.visible : ''}`} onClick={handleClose}>
      <div className={styles.card} onClick={e => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={handleClose}>
          &times;
        </button>
        <div className={styles.iconWrapper}>
          <img src={icon.url} alt={`Token ${icon.index + 1}`} width={40} height={40} />
        </div>
        <h3 className={styles.title}>Token #{icon.index + 1}</h3>
        <p className={styles.description}>A unique digital asset on the Sail platform</p>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Value</span>
            <span className={styles.statValue}>$1,234</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Change</span>
            <span className={`${styles.statValue} ${styles.positive}`}>+12.5%</span>
          </div>
        </div>
        <Button variant="primary" className={styles.cardButton}>
          View Details
        </Button>
      </div>
    </div>
  )
}

export default IconCard
