import { useEffect, useRef, useState } from 'react'
import { useInView } from '../hooks/useInView'
import AgenticFlowDiagram from './AgenticFlowDiagram'
import styles from './SailProtocolSection.module.css'

/* ── Architecture stack — five protocol layers ─────────────────────────── */
const LAYERS = [
  {
    name: 'Mandate Layer',
    desc: 'Sessions, policy refs, lifecycle.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
        <path d="M16 4v3h3" />
        <path d="M8 13h8M8 17h6" />
      </svg>
    ),
  },
  {
    name: 'Policy Engine',
    desc: 'Constraint VM, routes, workflows.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    name: 'Custody Adapters',
    desc: 'Safe · Account · EIP-7702.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="9" width="18" height="12" rx="2.5" />
        <path d="M8 9V6a4 4 0 0 1 8 0v3" />
        <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    name: 'Fee Kernel',
    desc: 'Atomic execution-linked settlement.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9c0-1.1 1.3-2 3-2s3 .9 3 2-1.3 2-3 2-3 .9-3 2 1.3 2 3 2 3-.9 3-2" />
        <path d="M12 5v2M12 17v2" />
      </svg>
    ),
  },
  {
    name: 'Read Facades',
    desc: 'Events, evidence, observability.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M2 12C4 7 8 4 12 4s8 3 10 8c-2 5-6 8-10 8S4 17 2 12z" />
      </svg>
    ),
  },
]

/* ── The five onchain-SMA properties (Sail Protocol whitepaper §1) ─────── */
const PROPERTIES = [
  {
    title: 'Self-custody',
    spec: 'subject.holds',
    desc: 'Assets remain in the subject account or Safe. Sail authorizes execution; it never becomes the custodian.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    ),
  },
  {
    title: 'Mandate enforcement',
    spec: 'runtime.check',
    desc: 'Routes, selectors, calldata, return data, value, gas, approvals, and workflow structure are checked at runtime.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5l-5 7 5 7" />
        <path d="M15 5l5 7-5 7" />
        <path d="M13.5 4l-3 16" />
      </svg>
    ),
  },
  {
    title: 'Deterministic settlement',
    spec: 'fees.atomic',
    desc: 'Fees accrue and settle through explicit execution hooks. Performance, management, and distributor splits are atomic.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" />
        <path d="M5 8h14l-3 5h-8z" />
        <circle cx="9"  cy="17" r="2.2" />
        <circle cx="15" cy="17" r="2.2" />
      </svg>
    ),
  },
  {
    title: 'Observable state',
    spec: 'events.live',
    desc: 'Sessions, policies, fee balances, and positions exposed through events and read facades — auditable in real time.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12C4.5 7 8 4.5 12 4.5s7.5 2.5 10 7.5c-2.5 5-6 7.5-10 7.5s-7.5-2.5-10-7.5z" />
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="0.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: 'Cryptographic revocation',
    spec: 'state.revoke',
    desc: 'Sessions, signers, policies, and routes can be paused, revoked, disabled, replaced, or expired through onchain state.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="14" r="4" />
        <path d="M12 12l8-8" />
        <path d="M16 4h4v4" />
        <path d="M14 7l3 3" />
      </svg>
    ),
  },
]

const STANDARDS = [
  { label: 'Safe',     desc: 'modules' },
  { label: 'ERC-4337', desc: 'transport' },
  { label: 'EIP-7702', desc: 'account-code' },
  { label: 'ERC-1271', desc: 'contract sigs' },
  { label: 'ERC-8004', desc: 'identity' },
]

/* ── Three roles — the actor model that wraps every Sail-managed account ── */
const ROLES = [
  {
    name: 'Owner',
    action: 'holds the Safe',
    desc: 'Holds the Safe — EOA, multisig, or MPC. Always self-custodial. Initializes the subject, binds custody, and controls revocation.',
    spec: 'EOA · multisig · MPC',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
        <circle cx="12" cy="12" r="2.4" />
      </svg>
    ),
  },
  {
    name: 'Permission Signer',
    action: 'authorizes the mandate',
    desc: 'Signs EIP-712 lifecycle requests after owner binding. Same party as the Owner in retail; separable for institutional setups (e.g., allocator + compliance signer).',
    spec: 'EIP-712 lifecycle',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19h16" />
        <path d="M5 16l4-1 9-9a2 2 0 0 0-3-3l-9 9-1 4z" />
      </svg>
    ),
  },
  {
    name: 'Manager',
    action: 'executes within bounds',
    desc: 'Signs delegated execution, workflow, composable, or transport requests. Human, asset manager, or autonomous agent — cannot exceed the active mandate at calldata level.',
    spec: 'human · institution · agent',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
]

/* ── TradFi SMA vs Onchain SMA comparison ───────────────────────────────── */
const COMPARISON_ROWS = [
  { property: 'Custody',             tradfi: 'Third-party custodian',          onchain: 'Self-custodial Safe' },
  { property: 'Mandate enforcement', tradfi: 'Legal contract + litigation',    onchain: 'Code enforced at calldata' },
  { property: 'Fee settlement',      tradfi: 'Quarterly, manual reconciliation', onchain: 'Atomic, per execution' },
  { property: 'Transparency',        tradfi: 'Monthly statements, opaque',     onchain: 'Real-time, position-level' },
  { property: 'Revocation',          tradfi: 'Days to weeks via written notice', onchain: 'Seconds — one transaction' },
]

/* ── Architecture visual — layered protocol stack ──────────────────────── */
function ProtocolStackVisual() {
  return (
    <div className={styles.stackWrap}>
      <div className={styles.stackHeader}>
        <span className={styles.stackHeaderDot} />
        <span className={styles.stackHeaderLabel}>SAIL PROTOCOL</span>
        <span className={styles.stackHeaderTag}>kernel</span>
      </div>

      <ul className={styles.stackList}>
        {LAYERS.map(({ name, desc, icon }) => (
          <li key={name} className={styles.stackRow}>
            <span className={styles.stackAccent} aria-hidden="true" />
            <span className={styles.stackIcon}>{icon}</span>
            <span className={styles.stackText}>
              <span className={styles.stackName}>{name}</span>
              <span className={styles.stackDesc}>{desc}</span>
            </span>
          </li>
        ))}
      </ul>

      {/* Footer band — the three roles flow */}
      <div className={styles.stackFooter}>
        <div className={styles.roleBox}>
          <span className={styles.roleLabel}>Owner</span>
          <span className={styles.roleSub}>holds custody</span>
        </div>
        <span className={styles.roleArrow}>→</span>
        <div className={styles.roleBox}>
          <span className={styles.roleLabel}>Signer</span>
          <span className={styles.roleSub}>authorizes</span>
        </div>
        <span className={styles.roleArrow}>→</span>
        <div className={styles.roleBox}>
          <span className={styles.roleLabel}>Manager</span>
          <span className={styles.roleSub}>executes</span>
        </div>
      </div>
    </div>
  )
}

/* ── Scroll-progress driver — rAF poll that reads section rect each frame.
 *    The host app's scroll container suppresses bubbled scroll events, so we
 *    poll instead of listening. We early-out when the section is far from the
 *    viewport to keep this nearly free.                                     */
function useScrollRail(rangeRef, fillRef, markerRef) {
  useEffect(() => {
    let raf = 0
    let lastPct = -1
    const tick = () => {
      const el = rangeRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        const vh = window.innerHeight || document.documentElement.clientHeight
        const total = rect.height + vh * 0.5
        const passed = vh * 0.7 - rect.top
        const p = Math.max(0, Math.min(1, passed / total))
        const pct = +(p * 100).toFixed(2)
        if (pct !== lastPct) {
          lastPct = pct
          if (fillRef.current)   fillRef.current.style.height = `${pct}%`
          if (markerRef.current) markerRef.current.style.top   = `${pct}%`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [rangeRef, fillRef, markerRef])
}

/* ── One card wrapper — fades in when its row enters the viewport */
function PropertyCard({ property, idx }) {
  const [ref, inView] = useInView(0.35)
  const { title, spec, desc, icon } = property
  return (
    <li
      ref={ref}
      className={`${styles.propsItem} ${inView ? styles.propsItemIn : ''}`}
      data-side={idx % 2 === 0 ? 'left' : 'right'}
      style={{ '--idx': idx }}
    >
      <span className={styles.propsConnector} aria-hidden="true" />
      <article className={styles.propsCard}>
        <header className={styles.propsCardTop}>
          <span className={styles.propsCardIndex}>{String(idx + 1).padStart(2, '0')}</span>
          <span className={styles.propsCardTitle}>{title}</span>
        </header>
        <p className={styles.propsCardDesc}>{desc}</p>
        <footer className={styles.propsCardFoot}>
          <span className={styles.propsCardSpec}>{spec}</span>
        </footer>
      </article>
    </li>
  )
}

export default function SailProtocolSection({ onOpenProtocol }) {
  const [sectionRef, inView] = useInView()
  const railRangeRef = useRef(null)
  const railFillRef  = useRef(null)
  const railMarkerRef = useRef(null)
  useScrollRail(railRangeRef, railFillRef, railMarkerRef)

  return (
    <section
      ref={sectionRef}
      className={`${styles.section} ${inView ? styles.visible : ''}`}
    >

      {/* ── Band 1 — Header ───────────────────────────────────── */}
      <header className={styles.headerBand}>
        <p className={styles.eyebrow}>
          <span className={styles.eyebrowDot} />
          Sail Protocol
        </p>
        <h2 className={styles.title}>SMA infrastructure for DeFi</h2>
        <p className={styles.subtitle}>
          Sail Protocol turns any Safe into a Separately Managed Account —
          wiring an Owner, a Permission Signer, and a Manager around the
          user's assets.
        </p>
      </header>

      {/* ── Band 2 — Three Roles (TOP) ─────────────────────────── */}
      <div className={styles.rolesBand}>
        <header className={styles.rolesHead}>
          <h3 className={styles.rolesHeading}>
            Three roles wrap every Sail-managed account.
          </h3>
        </header>

        <ul className={styles.rolesGrid}>
          {ROLES.map((role, i) => (
            <li key={role.name} className={styles.roleCard} style={{ '--idx': i }}>
              <span className={styles.roleCardEdge} aria-hidden="true" />

              <header className={styles.roleCardTop}>
                <span className={styles.roleIndex}>
                  {String(i + 1).padStart(2, '0')}
                </span>
              </header>

              <h4 className={styles.roleName}>{role.name}</h4>
              <p className={styles.roleAction}>
                <span className={styles.roleArrow}>→</span>
                {role.action}
              </p>
              <p className={styles.roleDesc}>{role.desc}</p>

              <footer className={styles.roleFoot}>
                <span className={styles.roleSpec}>{role.spec}</span>
              </footer>
            </li>
          ))}
        </ul>

        {/* Dashed flow arrows: roles → protocol diagram below */}
        <div className={styles.roleFlowArrows} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={styles.roleFlowArrow}>
              <svg viewBox="0 0 12 60" fill="none" preserveAspectRatio="none">
                <line x1="6" y1="0" x2="6" y2="48" stroke="currentColor"
                  strokeWidth="1" strokeDasharray="3 4" strokeLinecap="round" />
                <path d="M2 46 L6 52 L10 46" stroke="currentColor"
                  strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ))}
        </div>
      </div>

      {/* ── Band 3 — Sail Protocol panel (header + diagram) ──── */}
      <div className={styles.protocolPanel}>
        <header className={styles.protocolPanelHead}>
          <div className={styles.protocolPanelHeadLeft}>
            <span className={styles.protocolPanelEyebrow}>
              <span className={styles.protocolPanelEyebrowArrow} aria-hidden="true">↓</span>
              Enforcement substrate
            </span>
            <h3 className={styles.protocolPanelTitle}>Sail Protocol</h3>
            <p className={styles.protocolPanelSubtitle}>
              Mediates between actors and assets — every transaction
              checked, every fee settled.
            </p>
          </div>
          <span className={styles.protocolPanelBadge}>
            <span className={styles.protocolPanelBadgeDot} aria-hidden="true" />
            Audit in progress
          </span>
        </header>

        <div className={styles.diagramBand}>
          <AgenticFlowDiagram />
        </div>
      </div>

      {/* ── Band 2.5 — TradFi vs Onchain SMA comparison ─────── */}
      <div className={styles.comparisonBand}>
        <header className={styles.comparisonHeader}>
          <h3 className={styles.comparisonTitle}>
            TradFi vs Onchain SMA
            <em className={styles.comparisonTitleAccent}>
              structural comparison
            </em>
          </h3>
        </header>

        <div className={styles.comparisonCard}>
          <div className={`${styles.comparisonRow} ${styles.comparisonHead}`}>
            <span className={styles.comparisonHeadProp}>Property</span>
            <span className={styles.comparisonHeadTradfi}>TradFi SMA</span>
            <span className={styles.comparisonHeadOnchain}>Onchain SMA</span>
          </div>
          {COMPARISON_ROWS.map((row) => (
            <div key={row.property} className={styles.comparisonRow}>
              <span className={styles.comparisonProp}>{row.property}</span>
              <span className={styles.comparisonTradfi} data-mobile-label="TradFi">{row.tradfi}</span>
              <span className={styles.comparisonOnchain} data-mobile-label="Onchain">{row.onchain}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Band 3 — Properties of an onchain SMA ───────────── */}
      <div className={styles.propsBand}>
        <header className={styles.propsHead}>
          <h3 className={styles.propsHeading}>Five properties of an onchain SMA</h3>
          <p className={styles.propsLede}>
            The protocol contract: every Sail-managed account satisfies these five invariants
            simultaneously, enforced at the kernel boundary.
          </p>
        </header>

        <div className={styles.propsTimeline} ref={railRangeRef}>
          {/* Central rail with scroll-driven fill + marker */}
          <div className={styles.propsRail} aria-hidden="true">
            <span className={styles.propsRailDash} />
            <span className={styles.propsRailFill}   ref={railFillRef} />
            <span className={styles.propsRailMarker} ref={railMarkerRef} />
          </div>

          <ol className={styles.propsTimelineList}>
            {PROPERTIES.map((property, i) => (
              <PropertyCard key={property.title} property={property} idx={i} />
            ))}
          </ol>
        </div>

        {/* Composes with — sits directly above the CTA */}
        <div className={styles.standardsBand}>
          <span className={styles.standardsLabel}>Composes with</span>
          <ul className={styles.standardsList}>
            {STANDARDS.map(({ label, desc }) => (
              <li key={label} className={styles.standardChip}>
                <span className={styles.standardLabel}>{label}</span>
                <span className={styles.standardDesc}>{desc}</span>
              </li>
            ))}
          </ul>
        </div>

        <button className={styles.ctaBtn} onClick={onOpenProtocol}>
          <span>Explore the protocol</span>
          <span className={styles.ctaArrow}>
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      </div>

    </section>
  )
}
