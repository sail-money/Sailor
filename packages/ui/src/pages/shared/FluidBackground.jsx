import styles from './FluidBackground.module.css'

/**
 * Fluid mesh background — 5 organic gradient blobs that drift slowly,
 * blurred through a frosted glass overlay to form a calm liquid surface.
 * Sits behind page content via fixed positioning + z-index 0.
 */
export default function FluidBackground() {
  return (
    <>
      <div className={styles.fluidBg} aria-hidden="true">
        <div className={styles.blob1} />
        <div className={styles.blob2} />
        <div className={styles.blob3} />
        <div className={styles.blob4} />
        <div className={styles.blob5} />
      </div>
      <div className={styles.fluidFrost} aria-hidden="true" />
      <div className={styles.fluidGrid} aria-hidden="true" />
    </>
  )
}
