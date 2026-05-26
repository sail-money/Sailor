import { useEffect, useState } from 'react'
import {
  BrandMark,
  Sai,
  ConstraintPill,
  RevealCalldata,
  SailButton,
} from '../shared'
import shared from '../shared/shared.module.css'
import styles from './PendingDrawer.module.css'
import { PermissionsPanel } from '../shared/Permissions/Permissions'

function brandClass(name) {
  const n = (name ?? '').toLowerCase()
  if (n === 'claude' || n === 'anthropic') return styles.listItem_claude
  if (n === 'cursor') return styles.listItem_cursor
  if (n === 'codex' || n === 'chatgpt' || n === 'openai' || n === 'gpt') return styles.listItem_openai
  return ''
}

function SpecRow({ k, v }) {
  return (
    <div className={styles.specRow}>
      <dt className={styles.specK}>{k}</dt>
      <dd className={styles.specV}>{v ?? '—'}</dd>
    </div>
  )
}

function inferProtocols(allowed) {
  const found = new Set()
  for (const label of allowed ?? []) {
    const l = (label ?? '').toLowerCase()
    if (l.includes('aave'))     found.add('Aave')
    if (l.includes('compound')) found.add('Compound')
    if (l.includes('gmx'))      found.add('GMX')
    if (l.includes('pendle'))   found.add('Pendle')
    if (l.includes('curve'))    found.add('Curve')
    if (l.includes('uniswap'))  found.add('Uniswap')
  }
  return Array.from(found)
}

function deriveSpec(item) {
  const constraints = item.constraints ?? []
  let cap, time, network, asset
  for (const c of constraints) {
    if (/\$|eth max|max/i.test(c) && !cap) cap = c
    else if (/\bday|week|hour|remaining\b/i.test(c) && !time) time = c
    else if (/ on /i.test(c)) {
      const [a, n] = c.split(/ on /i)
      asset = asset ?? a.trim()
      network = network ?? n.trim()
    }
  }
  const protocols = inferProtocols(item.allowed)
  return {
    cap, time, network, asset,
    protocols: protocols.length ? protocols.join(' · ') : null,
  }
}

export default function PendingDrawer({
  open,
  pending = [],
  selectedId,
  onClose,
  onSelect,
  onBack,
  onAuthorize,
  onReject,
}) {
  const selected = pending.find((p) => p.id === selectedId)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <>
      <div
        className={`${styles.backdrop} ${open ? styles.backdropOpen : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`${styles.drawer} ${selected ? brandClass(selected.aiName) : ''} ${selected ? styles.drawerTinted : ''} ${open ? styles.drawerOpen : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Pending signing requests"
      >
        <header className={styles.head}>
          {selected ? (
            <button type="button" className={styles.back} onClick={onBack}>
              <span aria-hidden>←</span>
              <span>All pending</span>
            </button>
          ) : (
            <div className={styles.headTitle}>
              <span className={shared.metaLabel}>Pending signatures</span>
              <h2 className={`${shared.displayHeadline} ${styles.headHeadline}`}>
                Drafts waiting for you.
              </h2>
              <p className={styles.headHint}>
                Your AI has drafted these. Nothing happens until you sign.
              </p>
            </div>
          )}
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className={styles.body}>
          {selected ? (
            <DetailView
              key={selected.id}
              pending={selected}
              onAuthorize={() => onAuthorize?.(selected.id)}
              onReject={() => onReject?.(selected.id)}
            />
          ) : (
            <ListView pending={pending} onSelect={onSelect} />
          )}
        </div>
      </aside>
    </>
  )
}

function ListView({ pending, onSelect }) {
  if (!pending.length) {
    return (
      <div className={styles.empty}>
        <Sai size={72} animate rounded />
        <p className={styles.emptyTitle}>You’re all caught up.</p>
        <p className={styles.emptyBody}>
          When your AI drafts a new agent, it’ll show up here for you to review.
        </p>
      </div>
    )
  }

  return (
    <ul className={styles.list}>
      {pending.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            className={`${styles.listItem} ${brandClass(p.aiName)}`}
            onClick={() => onSelect(p.id)}
          >
            <div className={styles.listItemTop}>
              <span className={styles.aiTag}>
                <BrandMark name={p.aiName} size={22} />
                <span className={styles.aiTagText}>{p.aiName}</span>
              </span>
              <span className={styles.requestedAgo}>{p.requestedAgo}</span>
            </div>
            <h4 className={`${shared.displayHeadline} ${styles.listItemTitle}`}>
              {p.title}
            </h4>
            <ul className={styles.actionRow}>
              {p.allowed.slice(0, 3).map((a) => (
                <li key={a} className={styles.actionChip}>
                  <span className={styles.actionChipDot} aria-hidden />
                  <span className={styles.actionChipLabel}>{a}</span>
                </li>
              ))}
              {p.allowed.length > 3 && (
                <li className={styles.actionMore}>+{p.allowed.length - 3}</li>
              )}
            </ul>
            <span className={styles.listItemCta}>Review &amp; sign →</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function DetailView({ pending, onAuthorize, onReject }) {
  const [phase, setPhase] = useState('review') // review | waiting | confirmed

  useEffect(() => {
    if (phase !== 'waiting') return
    const t = setTimeout(() => {
      setPhase('confirmed')
      const t2 = setTimeout(() => onAuthorize?.(), 1200)
      return () => clearTimeout(t2)
    }, 1700)
    return () => clearTimeout(t)
  }, [phase, onAuthorize])

  if (phase !== 'review') {
    const confirmed = phase === 'confirmed'
    return (
      <div className={styles.confirm}>
        <div className={`${styles.confirmIndicator} ${confirmed ? styles.confirmDone : ''}`}>
          {confirmed ? (
            <svg viewBox="0 0 32 32" width="48" height="48" aria-hidden>
              <circle cx="16" cy="16" r="14" fill="none" stroke="var(--accent-blue)" strokeWidth="2" />
              <path d="M9 16.5l4.5 4.5L23 11" fill="none" stroke="var(--accent-blue)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className={styles.pulse} />
          )}
        </div>
        <h3 className={`${shared.displayHeadline} ${styles.confirmHeadline}`}>
          {confirmed ? 'Agent authorized.' : 'Waiting for your signature…'}
        </h3>
        <p className={shared.italicMannerism}>
          {confirmed
            ? 'Your AI is now operating within the agent.'
            : 'Approve the request in your wallet to continue.'}
        </p>
      </div>
    )
  }

  return (
    <article className={styles.detail}>
      <header className={styles.detailHead}>
        <span className={styles.aiTag}>
          <BrandMark name={pending.aiName} size={22} />
          <span className={styles.aiTagText}>{pending.aiName} is requesting</span>
        </span>
        <span className={styles.requestedAgo}>{pending.requestedAgo}</span>
      </header>

      <h3 className={`${shared.displayHeadline} ${styles.detailTitle}`}>
        {pending.title}
      </h3>

      <p className={styles.summary}>“{pending.summary}”</p>

      {pending.actions?.length > 0 ? (
        <PermissionsPanel mandate={pending} />
      ) : (
        <>
          <dl className={styles.specGrid}>
            <SpecRow k="Spending cap" v={deriveSpec(pending).cap} />
            <SpecRow k="Time limit"   v={deriveSpec(pending).time} />
            <SpecRow k="Network"      v={deriveSpec(pending).network} />
            <SpecRow k="Asset"        v={deriveSpec(pending).asset} />
            {deriveSpec(pending).protocols && (
              <SpecRow k="Protocols" v={deriveSpec(pending).protocols} />
            )}
          </dl>
          <div className={styles.divider} />
          <section className={styles.section}>
            <span className={shared.metaLabel}>What your AI can do</span>
            <ul className={styles.permList}>
              {pending.allowed.map((a) => (
                <li key={a} className={styles.permItem}>
                  <span className={styles.permCheck} aria-hidden>✓</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <div className={styles.divider} />

      <RevealCalldata
        calldata={pending.calldata}
        label="View technical details"
        caption="This is what gets recorded onchain. It defines exactly what your AI can do."
      />

      <footer className={styles.actions}>
        <div className={styles.actionsRow}>
          <SailButton onClick={() => setPhase('waiting')}>
            Authorize agent
          </SailButton>
          <SailButton variant="danger" onClick={onReject}>
            Reject
          </SailButton>
        </div>
        <p className={styles.revocable}>
          Revocable on-chain at any time from your dashboard.
        </p>
      </footer>
    </article>
  )
}
