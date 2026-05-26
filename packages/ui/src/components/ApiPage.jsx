import styles from './ApiPage.module.css'
import Header from './Header'
import AmbientBackground from './AmbientBackground'
import DotGrid from './DotGrid'
import PhoneMockup from './PhoneMockup'

const TABLE_ROWS = [
  { label: 'Time to launch',      inhouse: '6–12 months',  sail: '1 day' },
  { label: 'Engineers required',  inhouse: '4–8 FTEs',     sail: 'Zero' },
  { label: 'Upfront cost',        inhouse: '$500k – $1M',  sail: '$0' },
  { label: 'Compliance & KYC',    inhouse: 'Build yourself', sail: 'Handled' },
  { label: 'AI personalization',  inhouse: 'Custom model',  sail: 'Pre-trained' },
  { label: 'Ongoing maintenance', inhouse: 'Your team',     sail: 'Managed' },
  { label: 'Yield access',        inhouse: 'Limited venues', sail: '200+ protocols' },
  { label: 'Revenue',             inhouse: 'Eventually',    sail: 'Day one' },
]

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
      <circle cx="10" cy="10" r="9" fill="rgba(74,222,128,0.15)" stroke="rgba(74,222,128,0.4)" strokeWidth="1"/>
      <path d="M6.5 10.5l2.5 2.5 4.5-4.5" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
      <circle cx="10" cy="10" r="9" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      <path d="M7 7l6 6M13 7l-6 6" stroke="rgba(255,255,255,0.3)" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  )
}

function ComparisonTable() {
  return (
    <div className={styles.tableSection}>
      <div className={styles.tableHeader}>
        <h2 className={styles.tableTitle}>Why teams choose Sail<br />over building in-house</h2>
        <p className={styles.tableSubtitle}>
          The cost of building financial AI infrastructure is measured in months and millions. Sail ships it in a day.
        </p>
      </div>

      <div className={styles.tableWrap}>
        <div className={styles.tableCard}>
          <div className={`${styles.tableRow} ${styles.tableRowHead}`}>
            <div className={styles.tableColLabel} />
            <div className={styles.tableColInhouse}>
              <span className={styles.tableColTitle}>BUILD IN-HOUSE</span>
            </div>
            <div className={styles.tableColSail}>
              <span className={`${styles.tableColTitle} ${styles.tableColTitleSail}`}>USE SAIL API</span>
              <span className={styles.tableRecommended}>RECOMMENDED</span>
            </div>
          </div>

          {TABLE_ROWS.map((row, i) => (
            <div key={row.label} className={`${styles.tableRow} ${i % 2 === 1 ? styles.tableRowAlt : ''}`}>
              <div className={styles.tableColLabel}>
                <span className={styles.tableRowLabel}>{row.label}</span>
              </div>
              <div className={styles.tableColInhouse}>
                <CrossIcon />
                <span className={styles.tableInhouseVal}>{row.inhouse}</span>
              </div>
              <div className={styles.tableColSail}>
                <CheckIcon />
                <span className={styles.tableSailVal}>{row.sail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ApiPage({ onBack }) {
  return (
    <div className={styles.page}>
      <AmbientBackground />
      <Header onOpenApi={() => {}} />

      <div className={styles.content}>

        {/* Hero */}
        <div className={styles.heroSection}>
          <DotGrid white blueBottom style={{ opacity: 0.3 }} />
          <div className={styles.heroInner}>
            <div className={styles.heroNav}>
              <button className={styles.backBtn} onClick={onBack}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Back to Sail
              </button>
              <div className={styles.heroBadge}>
                <span className={styles.heroBadgeDot} />
                API / SDK
              </div>
            </div>
            <h1 className={styles.heroTitle}>Your brand.<br />Sail's engine.</h1>
            <p className={styles.heroSubtitle}>
              Embed a fully functional yield and personalization layer directly
              in your app — no custom UI to build or maintain.
            </p>
          </div>
        </div>

        {/* PhoneMockup — detailed feature section */}
        <div className={styles.phoneSectionWrap}>
          <DotGrid white blueBottom style={{ opacity: 0.3 }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <PhoneMockup onOpenApi={() => {}} />
          </div>
        </div>

        {/* Sections */}
        <div className={styles.sections}>

          <div className={styles.sectionCard} style={{ background: '#050D1F', position: 'relative', overflow: 'hidden' }}>
            <DotGrid white blueBottom style={{ opacity: 0.25 }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <ComparisonTable />
            </div>
          </div>


        </div>

      </div>
    </div>
  )
}
