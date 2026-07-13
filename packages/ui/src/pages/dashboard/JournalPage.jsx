import { useEffect, useMemo } from 'react'
import {
  BrandMark,
  HorizonBackground,
  Sai,
  SailButton,
} from '../shared'
import shared from '../shared/shared.module.css'
import styles from './JournalPage.module.css'
import { useSailorAccount, useSailorActivity, useSailorMandate } from '../../hooks/useSailorData'
import { explorerTxUrl } from '../../lib/explorer'

/**
 * JournalPage — full-page detail for a single Decision Journal entry.
 *
 * Lives at /journal/:entryId. Replaces the previous JournalDrawer
 * (right-side slide-in) with a routed full-page surface that matches
 * the dashboard's chrome.
 *
 * Sections (top to bottom):
 *   - Header (back to dashboard)
 *   - Title block: time, status, source pill, actor, action sentence,
 *     summary meta
 *   - Reasoning card  (the AI's plain-language rationale)
 *   - Evidence card   (k/v grid the agent referenced)
 *   - Provenance card (permission used, MPC wallet, recommendation id)
 *   - Run artifact card (tx hash linked, block, gas, venue)
 *   - Prev / next navigation between adjacent entries
 */
export default function JournalPage({ entryId, onBack }) {
  const { events, loading: activityLoading } = useSailorActivity()
  const { mandates } = useSailorMandate()
  const mandate = mandates[0] ?? null
  const { account } = useSailorAccount()

  const entry = useMemo(
    () => events.find((e) => e.id === entryId) ?? events.find((_, i) => String(i) === entryId),
    [events, entryId],
  )

  const { prev, next } = useMemo(() => {
    if (!entry) return { prev: null, next: null }
    const idx = events.indexOf(entry)
    return {
      prev: idx > 0 ? events[idx - 1] : null,
      next: idx < events.length - 1 ? events[idx + 1] : null,
    }
  }, [entry, events])

  const agent = useMemo(() => {
    if (!entry || !mandate) return null
    const perms = mandate.permissions ?? []
    return perms.find((m) => (m.role ?? m.template) === entry.actor) ?? null
  }, [entry, mandate])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [entryId])

  // Don't declare the entry missing while the first /api/activity fetch is
  // still in flight — on direct navigation `events` starts as [] and a valid
  // entry would flash "Activity not found" for one fetch round-trip.
  if (!entry && activityLoading) {
    return (
      <div className={`${shared.pageShell} ${styles.shell}`}>
        <HorizonBackground />
      </div>
    )
  }

  if (!entry) {
    return (
      <div className={`${shared.pageShell} ${styles.shell}`}>
        <HorizonBackground />
        <main className={styles.notFound}>
          <Sai size={48} />
          <h1 className={styles.notFoundTitle}>Activity not found</h1>
          <p className={styles.notFoundBody}>
            The URL points to a journal entry that doesn't exist. It may have been pruned from local storage.
          </p>
          <SailButton onClick={onBack}>Back to dashboard</SailButton>
        </main>
      </div>
    )
  }

  const statusTone = entry.status === 'rejected'
    ? 'danger'
    : entry.status === 'warn'
      ? 'warn'
      : entry.status === 'success'
        ? 'success'
        : 'info'

  return (
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <HorizonBackground />

      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={onBack}
          aria-label="Back to dashboard"
        >
          <ChevronLeft />
          <span>Dashboard</span>
        </button>
      </header>

      <main className={styles.main}>
        {/* ── Title block ─────────────────────────────────────────
            Tight identity row (kind pill + time + status), then the
            action sentence as the h1, then the one-line summary. */}
        <section className={styles.titleBlock}>
          <div className={styles.titleMetaRow}>
            <span className={`${styles.kindPill} ${styles[`kind_${entry.kind ?? 'event'}`] ?? ''}`}>
              {entry.kindLabel ?? 'Event'}
            </span>
            <span className={styles.timeMeta}>
              {entry.dateLabel ? `${entry.dateLabel}, ` : ''}{entry.time}
            </span>
            <span className={styles.metaDot} aria-hidden>·</span>
            <span className={`${styles.statusPill} ${styles[`status_${statusTone}`]}`}>
              <span className={styles.statusPillDot} aria-hidden />
              {entry.status === 'success' && 'Confirmed'}
              {entry.status === 'rejected' && 'Held by mandate'}
              {entry.status === 'warn' && 'Warning'}
              {entry.status === 'info' && 'Info'}
            </span>
          </div>

          <div className={styles.titleActorRow}>
            {agent && (
              <span className={styles.titleActorBadge}>
                <BrandMark name={agent.aiName} size={18} />
                <span>{agent.aiName}</span>
              </span>
            )}
            <span className={styles.titleActorName}>{entry.actor}</span>
          </div>

          <h1 className={styles.title}>{entry.action}</h1>
          {entry.meta && <p className={styles.titleSub}>{entry.meta}</p>}
        </section>

        {/* ── Reasoning ──────────────────────────────────────────
            The plain-language rationale the AI recorded for this
            action. Calm blockquote treatment, mirroring the mandate
            summary recital style — the user reads it the same way. */}
        {entry.detail?.reasoning && (
          <section className={styles.card}>
            <header className={styles.cardHead}>
              <div className={styles.cardHeadText}>
                <h2 className={styles.cardTitle}>
                  <NoteGlyph />
                  Reasoning
                </h2>
                <p className={styles.cardSub}>
                  What the agent recorded as the rationale for this action.
                </p>
              </div>
            </header>
            <blockquote className={styles.reasoning}>
              <span className={styles.reasoningMark} aria-hidden>“</span>
              <p>{entry.detail.reasoning}</p>
            </blockquote>
          </section>
        )}

        {/* ── Evidence ───────────────────────────────────────────
            Structured key/value pairs the agent referenced when making
            this decision. Rendered as a grid so each fact stands on
            its own line — easy to scan, easy to copy. */}
        {entry.detail?.evidence?.length > 0 && (
          <section className={styles.card}>
            <header className={styles.cardHead}>
              <div className={styles.cardHeadText}>
                <h2 className={styles.cardTitle}>
                  <ListGlyph />
                  Evidence
                </h2>
                <p className={styles.cardSub}>
                  Inputs the agent cited at decision time.
                </p>
              </div>
              <span className={styles.cardHeadMeta}>
                {entry.detail.evidence.length} data point{entry.detail.evidence.length === 1 ? '' : 's'}
              </span>
            </header>
            <dl className={styles.evidenceGrid}>
              {entry.detail.evidence.map((kv) => (
                <div key={kv.k} className={styles.evidenceRow}>
                  <dt>{kv.k}</dt>
                  <dd>{kv.v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* ── Provenance ─────────────────────────────────────────
            Authorization context — which permission gated the call,
            which MPC wallet signed it, which manager recommendation
            triggered it. Stitches the entry into the protocol's
            trust spine. */}
        {entry.detail?.authorization && (
          <section className={styles.card}>
            <header className={styles.cardHead}>
              <div className={styles.cardHeadText}>
                <h2 className={styles.cardTitle}>
                  <ShieldGlyph />
                  Authorization
                </h2>
                <p className={styles.cardSub}>
                  Which permission the manager named when authorizing this call.
                </p>
              </div>
            </header>
            <div className={styles.authBox}>
              <span className={styles.authMark} aria-hidden>✓</span>
              <div className={styles.authText}>
                <span className={styles.authLabel}>{entry.detail.authorization.label}</span>
                <span className={styles.authSub}>{entry.detail.authorization.sub}</span>
              </div>
            </div>
          </section>
        )}

        {/* ── Run artifact ───────────────────────────────────────
            For confirmed/submitted runs only: the onchain receipt —
            tx hash (linked to explorer), block, gas, venue. */}
        {entry.detail?.artifact && (
          <section className={styles.card}>
            <header className={styles.cardHead}>
              <div className={styles.cardHeadText}>
                <h2 className={styles.cardTitle}>
                  <SealGlyph />
                  Run artifact
                </h2>
                <p className={styles.cardSub}>
                  The onchain receipt for this run.
                </p>
              </div>
            </header>
            <dl className={styles.artifactGrid}>
              {Object.entries(entry.detail.artifact).map(([k, v]) => (
                <div key={k} className={styles.artifactRow}>
                  <dt>{k}</dt>
                  <dd>
                    {k === 'Tx hash' ? (
                      <a
                        href={explorerTxUrl(account?.chainId, String(v).replace('…', '')) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.txLink}
                      >
                        {v}
                        <ArrowOutIcon />
                      </a>
                    ) : (
                      v
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* ── Prev / next navigation ────────────────────────────
            Step through the journal without re-opening the dashboard.
            Mirrors how the reference v2.0 journal lets you keep moving
            through entries from the same surface. */}
        <nav className={styles.paginate} aria-label="Adjacent activity">
          {prev ? (
            <a href={`#/journal/${prev.id}`} className={styles.paginateLink}>
              <ChevronLeftSm />
              <span className={styles.paginateText}>
                <span className={styles.paginateKicker}>Previous</span>
                <span className={styles.paginateTitle}>{prev.action}</span>
              </span>
            </a>
          ) : <span className={styles.paginateSpacer} aria-hidden />}
          {next ? (
            <a href={`#/journal/${next.id}`} className={`${styles.paginateLink} ${styles.paginateLinkRight}`}>
              <span className={styles.paginateText}>
                <span className={styles.paginateKicker}>Next</span>
                <span className={styles.paginateTitle}>{next.action}</span>
              </span>
              <ChevronRightSm />
            </a>
          ) : <span className={styles.paginateSpacer} aria-hidden />}
        </nav>
      </main>
    </div>
  )
}

/* ─────────── Icons ─────────── */
function ChevronLeft() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3l-4 4 4 4" />
    </svg>
  )
}
function ChevronLeftSm() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3l-4 4 4 4" />
    </svg>
  )
}
function ChevronRightSm() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 3l4 4-4 4" />
    </svg>
  )
}
function NoteGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 2.5h5l3 3v8a.5.5 0 01-.5.5h-7.5a.5.5 0 01-.5-.5v-10a.5.5 0 01.5-.5z" />
      <path d="M9 2.5v3h3" />
      <path d="M5.6 9h5M5.6 11.4h3" />
    </svg>
  )
}
function ListGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 4h8M5 8h8M5 12h8" />
      <circle cx="2.5" cy="4" r="0.7" fill="currentColor" />
      <circle cx="2.5" cy="8" r="0.7" fill="currentColor" />
      <circle cx="2.5" cy="12" r="0.7" fill="currentColor" />
    </svg>
  )
}
function ShieldGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2l5 2v4c0 3.6-2.5 5.4-5 6-2.5-.6-5-2.4-5-6V4l5-2z" />
      <path d="M5.6 8.2l1.7 1.7L10.4 7" />
    </svg>
  )
}
function SealGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="7" r="4" />
      <path d="M6 10.5L5.2 13.4l2.8-1.6 2.8 1.6L10 10.5" />
    </svg>
  )
}
function ArrowOutIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 9 L9 5" />
      <path d="M5.4 5 H9 V8.6" />
    </svg>
  )
}
