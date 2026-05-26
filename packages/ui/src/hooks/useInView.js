import { useEffect, useRef, useState } from 'react'

/**
 * Fires once when the element enters the viewport.
 * @param {number} threshold – 0–1, default 0.15
 */
export function useInView(threshold = 0.15) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    /* Trigger as soon as any pixel intersects. Works for both short and tall
       sections — a 15% threshold can never fire on a 5000px section in an
       812px viewport, so we lock to threshold 0. Also fall back to true after
       a short delay in case the observer never fires (e.g. very tall pages on
       slower mobile browsers). */
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          observer.disconnect()
          clearTimeout(fallback)
        }
      },
      { threshold: 0, rootMargin: '200px 0px 200px 0px' }
    )
    observer.observe(el)

    const fallback = setTimeout(() => setInView(true), 1200)

    return () => {
      observer.disconnect()
      clearTimeout(fallback)
    }
  }, [threshold])

  return [ref, inView]
}
