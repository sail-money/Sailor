import { useEffect } from 'react'
import createSailBackground from './sailField'

/**
 * Sail's living "square field" — a transparent WebGL grid of pixel squares,
 * animated by a composite wave, layered behind page content over the dark
 * gradient. Purely decorative; mounts a fixed canvas and tears it down on
 * unmount. Honors prefers-reduced-motion (renders a single static frame).
 */
export default function SailBackground() {
  useEffect(() => {
    // zIndex -1 keeps the canvas behind all app content (it's appended to
    // <body> after #root, so z-index 0 would paint on top).
    const bg = createSailBackground({ zIndex: -1 })
    return () => bg.destroy()
  }, [])
  return null
}