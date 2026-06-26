import styles from './HorizonBackground.module.css'

/**
 * Horizon background — 5 organic gradient blobs that drift slowly,
 * blurred through a frosted glass overlay to form a calm liquid surface.
 * Sits behind page content via fixed positioning + z-index 0.
 */
export default function HorizonBackground() {
  return (
    <>
      <div className={styles.horizonBg} aria-hidden="true">
        <div className={styles.blob1} />
        <div className={styles.blob2} />
        <div className={styles.blob3} />
        <div className={styles.blob4} />
        <div className={styles.blob5} />
      </div>
      <div className={styles.horizonFrost} aria-hidden="true" />
    </>
  )
}
