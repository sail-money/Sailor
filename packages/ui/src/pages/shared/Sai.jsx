import { useEffect, useState } from 'react'
import styles from './Sai.module.css'

const GRID = [
  '............XXX.................',
  '............XXX.................',
  '............XXXXX...............',
  '............XXXXX...............',
  '..........XXXXXXXXXX............',
  '..........XXXXXXXXXX............',
  '..........XXXXXXXXXX............',
  '.......XXXXXXXXXXXXXXX..........',
  '.......XXXXXXXXXXXXXXX..........',
  '.......XXXXXXXXXXXXXXXXXX.......',
  '.......XXXXXXXXXXXXXXXXXX.......',
  '.......XXXXXXXXXXXXXXXXXX.......',
  '.....XXXXXXXXXXXXXXXXXXXXXX.....',
  '.....XXXXXXXXXXXXXXXXXXXXXX.....',
  '..XXXXXXXXXXXXXXXXXXXXXXXXXXXX..',
  '..XXXXXXXXXXXXXXXXXXXXXXXXXXXX..',
  '..XXXXXXXXXXXXXXXXXXXXXXXXXXXX..',
  '............XXX.................',
  '............XXX.................',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXXoooXXoooXXXXXXX',
  'XXXXXXXXXXXXXXXXXoooXXoooXXXXX..',
  'XXXXXXXXXXXXXXXXXoooXXoooXXXXX..',
  '..XXXXXXXXXXXXXXXXXXXXXXXXX.....',
  '..XXXXXXXXXXXXXXXXXXXXXXXXX.....',
  '..XXXXXXXXXXXXXXXXXXXXXXXXX.....',
  '.....XXXXXXXXXXXXXXXXXXXX.......',
  '.....XXXXXXXXXXXXXXXXXXXX.......',
]

const BLUE = '#1990FF'
const NAVY = '#0A1124'

const VB_W = 32
const VB_H = 30 // tight: 1px breathing room top + 1px bottom for float

const sailPx = []
const hullPx = []
const eyeLPx = []
const eyeRPx = []

GRID.forEach((row, y) => {
  for (let x = 0; x < row.length; x++) {
    const ch = row[x]
    if (ch === '.') continue
    if (ch === 'X') {
      if (y <= 18) sailPx.push([x, y])
      else hullPx.push([x, y])
    } else if (ch === 'o') {
      if (x <= 19) eyeLPx.push([x, y])
      else eyeRPx.push([x, y])
    }
  }
})

function Pixels({ cells, color }) {
  return (
    <g fill={color}>
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y + 0.5} width="1.02" height="1.02" />
      ))}
    </g>
  )
}

export default function Sai({
  size = 80,
  animate = false,
  className = '',
  ariaLabel = 'Sai, the Sail mascot',
}) {
  // Random-interval blinks. Real eyes don't blink on a metronome — keeping
  // this stochastic is the single biggest "feels alive" win.
  const [blinkTick, setBlinkTick] = useState(0)
  useEffect(() => {
    if (!animate) return
    let cancelled = false
    let timer
    const schedule = () => {
      // 4–8s between blinks. Occasionally a double-blink follows quickly (1 in 6).
      const isDouble = Math.random() < 0.16 && blinkTick > 0
      const wait = isDouble ? 280 : 4000 + Math.random() * 4000
      timer = setTimeout(() => {
        if (cancelled) return
        setBlinkTick((t) => t + 1)
        schedule()
      }, wait)
    }
    schedule()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate])

  const cls = [styles.mark, animate ? styles.animate : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className={cls}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
    >
      <span className={styles.halo} aria-hidden />
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        xmlns="http://www.w3.org/2000/svg"
        shapeRendering="crispEdges"
        preserveAspectRatio="xMidYMid meet"
      >
        <g className={styles.boat}>
          <g className={styles.sail}>
            <Pixels cells={sailPx} color={BLUE} />
          </g>
          <g className={styles.hull}>
            <Pixels cells={hullPx} color={BLUE} />
          </g>
          <g className={`${styles.eye} ${styles.eyeLeft}`}>
            <g className={styles.blink} key={`l-${blinkTick}`}>
              <Pixels cells={eyeLPx} color={NAVY} />
            </g>
          </g>
          <g className={`${styles.eye} ${styles.eyeRight}`}>
            <g className={styles.blink} key={`r-${blinkTick}`}>
              <Pixels cells={eyeRPx} color={NAVY} />
            </g>
          </g>
        </g>
      </svg>
    </span>
  )
}
