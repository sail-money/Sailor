import styles from './SailButton.module.css'

export default function SailButton({
  children,
  variant = 'primary',
  fullWidth = false,
  disabled = false,
  type = 'button',
  className = '',
  ...rest
}) {
  const cls = [
    styles.btn,
    styles[variant] ?? styles.primary,
    fullWidth ? styles.fullWidth : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={cls} disabled={disabled} {...rest}>
      {children}
    </button>
  )
}
