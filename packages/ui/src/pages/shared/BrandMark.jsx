import styles from './BrandMark.module.css'

/**
 * Small circular avatar showing the AI client's brand mark.
 * Uses official brand SVGs served from /public/brands/.
 */
export default function BrandMark({ name, size = 28 }) {
  const variant = resolveVariant(name)

  if (variant === 'fallback') {
    return (
      <span
        className={`${styles.disc} ${styles.fallback}`}
        style={{ width: size, height: size }}
        aria-label={name}
      >
        <span style={{ fontSize: Math.round(size * 0.48), lineHeight: 1 }}>
          {(name?.[0] ?? '?').toUpperCase()}
        </span>
      </span>
    )
  }

  const src = `/brands/${variant}.svg`
  // Inner logo size — proportional to disc, slightly smaller for visual padding
  const innerScale =
    variant === 'claude' ? 0.78 :
    variant === 'cursor' ? 0.58 :
    /* openai */          0.68
  const innerSize = Math.round(size * innerScale)

  return (
    <span
      className={`${styles.disc} ${styles[variant]}`}
      style={{ width: size, height: size }}
      aria-label={name}
    >
      <img
        src={src}
        alt=""
        width={innerSize}
        height={innerSize}
        className={styles.icon}
        aria-hidden
      />
    </span>
  )
}

function resolveVariant(name) {
  const n = (name ?? '').toLowerCase()
  if (n === 'claude' || n === 'anthropic') return 'claude'
  if (n === 'cursor') return 'cursor'
  if (n === 'chatgpt' || n === 'codex' || n === 'openai' || n === 'gpt') return 'openai'
  return 'fallback'
}
