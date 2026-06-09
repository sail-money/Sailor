import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './InfoTip.module.css'

const GAP = 8
const MARGIN = 10

export default function InfoTip({ children, label = 'More info', side = 'top' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const bubbleRef = useRef(null)
  const id = useId()

  const place = useCallback(() => {
    const btn = btnRef.current
    const bubble = bubbleRef.current
    if (!btn || !bubble) return
    const r = btn.getBoundingClientRect()
    const bw = bubble.offsetWidth
    const bh = bubble.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = r.left + r.width / 2 - bw / 2
    left = Math.max(MARGIN, Math.min(left, vw - bw - MARGIN))
    const above = r.top - GAP - bh
    const below = r.bottom + GAP
    let top = side === 'bottom' ? below : above
    if (top < MARGIN) top = below
    if (top + bh > vh - MARGIN) top = Math.max(MARGIN, above)
    setPos({ left, top })
  }, [side])

  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  return (
    <span className={styles.wrap}>
      <button
        ref={btnRef}
        type="button"
        className={styles.icon}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="4.6" r="0.95" fill="currentColor" />
          <rect x="7.2" y="6.6" width="1.6" height="5" rx="0.6" fill="currentColor" />
        </svg>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <span
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className={styles.bubble}
          style={{
            left: pos ? `${pos.left}px` : '-9999px',
            top: pos ? `${pos.top}px` : '-9999px',
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          {children}
        </span>,
        document.body,
      )}
    </span>
  )
}
