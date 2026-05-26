import { useEffect, useRef } from 'react'
import styles from './Testimonials.module.css'

const rows = [
  { label: 'Time to launch',       buildIn: '6–12 months',    useSail: '1 day' },
  { label: 'Engineers required',   buildIn: '4–8 FTEs',       useSail: 'Zero' },
  { label: 'Upfront cost',         buildIn: '$500k – $1M',    useSail: '$0' },
  { label: 'Compliance & KYC',     buildIn: 'Build yourself', useSail: 'Handled' },
  { label: 'AI personalization',   buildIn: 'Custom model',   useSail: 'Pre-trained' },
  { label: 'Ongoing maintenance',  buildIn: 'Your team',      useSail: 'Managed' },
  { label: 'Yield access',         buildIn: 'Limited venues', useSail: '200+ protocols' },
  { label: 'Revenue',              buildIn: 'Eventually',     useSail: 'Day one' },
]

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="7.25" stroke="rgba(50,220,120,0.5)" strokeWidth="1.5" />
    <path d="M5 8l2.5 2.5L11 5.5" stroke="rgba(50,220,120,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="7.25" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

function Testimonials() {
  const sectionRef = useRef(null)
  const tableRef = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          tableRef.current?.classList.add(styles.revealed)
          observer.disconnect()
        }
      },
      { threshold: 0.15 }
    )

    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section className={styles.section} ref={sectionRef}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>Why teams choose Sail<br />over building in-house</h2>
          <p className={styles.subtitle}>
            The cost of building financial AI infrastructure is measured in months and millions. Sail ships it in a day.
          </p>
        </div>

        <div className={styles.tableWrap} ref={tableRef}>
          {/* Column headers */}
          <div className={styles.tableHead}>
            <div className={styles.headCell} />
            <div className={styles.headCell}>
              <span className={styles.colBuild}>Build In-House</span>
            </div>
            <div className={`${styles.headCell} ${styles.headSail}`}>
              <span className={styles.colSail}>Use Sail API</span>
              <span className={styles.colBadge}>Recommended</span>
            </div>
          </div>

          {/* Rows */}
          {rows.map((row, index) => (
            <div
              key={index}
              className={`${styles.row} ${index % 2 === 0 ? styles.rowAlt : ''}`}
            >
              <div className={styles.rowLabel}>{row.label}</div>
              <div className={styles.rowBuild}>
                <XIcon />
                <span>{row.buildIn}</span>
              </div>
              <div className={styles.rowSail}>
                <CheckIcon />
                <span>{row.useSail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Testimonials
