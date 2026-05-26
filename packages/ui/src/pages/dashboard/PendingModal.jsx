import { useEffect, useState } from 'react'
import { BrandMark, GlassCard, SailButton } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './PendingModal.module.css'
import { PermissionsPanel } from '../shared/Permissions/Permissions'
import ContractModal from './ContractModal'

/**
 * Login-time pending mandates modal — like the Edit modal in look & feel.
 * If the user closes without acting, items remain in the notifications
 * side panel (the existing drawer reached via the bell icon).
 */
export default function PendingModal({
  open,
  pending = [],
  onClose,
  onAuthorize,
  onReject,
}) {
  // The contract modal renders a single pending mandate as a legal
  // document — opened when the user taps "View details" on any item.
  const [contractId, setContractId] = useState(null)
  const contractItem = pending.find((p) => p.id === contractId) ?? null

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !contractId) onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose, contractId])

  if (!open) return null

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>

        <header className={styles.header}>
          <span className={styles.kicker}>
            <span className={styles.kickerDot} aria-hidden />
            {pending.length} pending {pending.length === 1 ? 'agent' : 'agents'}
          </span>
          <h2 className={`${shared.displayHeadline} ${styles.headline}`}>
            Drafts waiting for your signature.
          </h2>
          <p className={styles.sub}>
            Your AI prepared {pending.length === 1 ? 'a draft' : 'these drafts'} for you to review.
            Authorize to bring {pending.length === 1 ? 'it' : 'them'} on-chain — or close to come back later.
          </p>
        </header>

        <ul className={styles.list}>
          {pending.map((p) => (
            <PendingItem
              key={p.id}
              item={p}
              onView={() => setContractId(p.id)}
            />
          ))}
        </ul>

        <button type="button" className={styles.later} onClick={onClose}>
          Review later — keep in notifications
        </button>
      </GlassCard>

      {/* Contract view — opens on top of the pending list when the user
          taps "View details" on any item. */}
      <ContractModal
        open={!!contractItem}
        mandate={contractItem}
        onClose={() => setContractId(null)}
        onAuthorize={(id) => {
          setContractId(null)
          onAuthorize?.(id)
        }}
        onReject={(id) => {
          setContractId(null)
          onReject?.(id)
        }}
      />
    </div>
  )
}

function brandClass(name) {
  const n = (name ?? '').toLowerCase()
  if (n === 'claude' || n === 'anthropic') return styles.item_claude
  if (n === 'cursor') return styles.item_cursor
  if (n === 'codex' || n === 'chatgpt' || n === 'openai' || n === 'gpt') return styles.item_openai
  return ''
}

function PendingItem({ item, onView }) {
  const aiClass = brandClass(item.aiName)

  return (
    <li className={`${styles.item} ${aiClass}`}>
      <header className={styles.itemTop}>
        <span className={styles.itemAi}>
          <BrandMark name={item.aiName} size={22} />
          <span className={styles.itemAiText}>{item.aiName} is requesting</span>
        </span>
        <span className={styles.itemAgo}>{item.requestedAgo}</span>
      </header>

      <h3 className={`${shared.displayHeadline} ${styles.itemTitle}`}>
        {item.title}
      </h3>

      {item.summary && (
        <p className={styles.itemSummary}>“{item.summary}”</p>
      )}

      {/* Reading the mandate is now a precondition to signing. Authorize
          and Reject live inside the full contract; this is the single
          way in. */}
      <button
        type="button"
        className={styles.reviewBtn}
        onClick={onView}
      >
        <span>Review mandate</span>
        <span className={styles.reviewBtnArrow} aria-hidden>
          <ChevronRight />
        </span>
      </button>
    </li>
  )
}

function SpecRow({ k, v }) {
  return (
    <div className={styles.specRow}>
      <dt className={styles.specK}>{k}</dt>
      <dd className={styles.specV}>{v ?? '—'}</dd>
    </div>
  )
}

function CheckSmall() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5l2.6 2.6L11 4" />
    </svg>
  )
}
function ChevronRight() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3l4 4-4 4" />
    </svg>
  )
}
function ChevronDown() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 5l3.5 3.5L10.5 5" />
    </svg>
  )
}

/* Parse the pending item's constraint pills + allowed labels into a
   structured spec — Spending cap / Time / Network / Asset / Protocols. */
function deriveSpec(item) {
  const constraints = item.constraints ?? []
  let cap, time, network, asset
  for (const c of constraints) {
    const lc = c.toLowerCase()
    if (/\$|eth max|max/i.test(c) && !cap) cap = c
    else if (/\bday|week|hour|remaining\b/i.test(c) && !time) time = c
    else if (/ on /i.test(c)) {
      const [a, n] = c.split(/ on /i)
      asset = asset ?? a.trim()
      network = network ?? n.trim()
    }
  }
  const protocols = inferProtocols(item.allowed ?? [])
  return {
    cap, time, network, asset,
    protocols: protocols.length ? protocols.join(' · ') : null,
  }
}

function inferProtocols(allowed) {
  const found = new Set()
  for (const label of allowed) {
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
