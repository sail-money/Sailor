'use client'

import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './InfoTip.module.css'

/**
 * InfoTip — a small ⓘ icon that reveals an explanatory tooltip on hover/focus.
 *
 * Demystifies protocol/framework jargon (SMA, session, manager, mandate…) for
 * users who don't know the concepts. Accessible: keyboard-focusable, described
 * via aria, dismissible on blur/leave.
 *
 * Positioning: the bubble is rendered `position: fixed` and its coordinates are
 * computed from the icon's bounding rect, then CLAMPED to the viewport — so it
 * can never be clipped by a container edge or spill off-screen, no matter where
 * the icon sits. It flips above/below depending on available room.
 *
 *   <InfoTip label="What is an SMA?">A Separately Managed Account is…</InfoTip>
 *
 * `side` is the PREFERRED side ('top' default | 'bottom'); it flips if clipped.
 */
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

    // Horizontal: center on the icon, then clamp inside the viewport.
    let left = r.left + r.width / 2 - bw / 2
    left = Math.max(MARGIN, Math.min(left, vw - bw - MARGIN))

    // Vertical: try the preferred side, flip if it would clip.
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
        // Portaled to <body> so a transformed ancestor (animations, the
        // onboarding card) can't trap the fixed-positioned bubble — its
        // viewport coordinates then land exactly where computed.
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
