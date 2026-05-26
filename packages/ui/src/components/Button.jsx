import { useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import styles from './Button.module.css'

function Button({ children, variant = 'default', magnetic = false, className = '', ...props }) {
  const buttonRef = useRef(null)
  const prefersReducedMotion = useReducedMotion()

  const handleMouseMove = (e) => {
    if (!magnetic || prefersReducedMotion) return
    const btn = buttonRef.current
    const rect = btn.getBoundingClientRect()
    const x = e.clientX - rect.left - rect.width / 2
    const y = e.clientY - rect.top - rect.height / 2
    btn.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px)`
  }

  const handleMouseLeave = () => {
    if (!magnetic || prefersReducedMotion) return
    buttonRef.current.style.transform = ''
  }

  return (
    <button
      ref={buttonRef}
      className={`${styles.button} ${styles[variant]} ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      {children}
    </button>
  )
}

export default Button
