import styles from './GlowOrb.module.css'

/**
 * Gemini-style floating sphere — dark body with electric-blue rim lighting.
 * size   : diameter in px
 * delay  : animation offset so multiple orbs feel independent
 * style  : positioning overrides (top/left/right/bottom/opacity)
 */
export default function GlowOrb({ size = 700, delay = '0s', style = {} }) {
  return (
    <div
      className={styles.orb}
      style={{ width: size, height: size, animationDelay: delay, ...style }}
      aria-hidden="true"
    />
  )
}
