import styles from './SailIcon.module.css'

/**
 * Minimal line-art sailboat — SF Symbol-esque, single accent color.
 * Used as a "this is a Sail mandate" avatar on each card.
 */
export default function SailIcon({ size = 36, muted = false, className = '' }) {
  return (
    <span
      className={`${styles.disc} ${muted ? styles.discMuted : ''} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        className={styles.icon}
        width={Math.round(size * 0.5)}
        height={Math.round(size * 0.5)}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* mast */}
        <line x1="10" y1="2" x2="10" y2="13" />
        {/* main sail (right side) */}
        <path d="M10 3.5 L15.2 12.5 L10 12.5 Z" fill="currentColor" fillOpacity="0.18" />
        {/* jib sail (left, smaller) */}
        <path d="M10 5.5 L6.4 12.5 L10 12.5 Z" />
        {/* hull */}
        <path d="M3.5 14 L16.5 14 L14.4 17 L5.6 17 Z" fill="currentColor" fillOpacity="0.16" />
      </svg>
    </span>
  )
}
