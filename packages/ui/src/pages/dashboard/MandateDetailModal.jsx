import { useEffect } from 'react'
import { BrandMark, GlassCard, MandateStatus, SailButton } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './MandateDetailModal.module.css'
import { PermissionsPanel } from '../shared/Permissions/Permissions'

/**
 * Full permissions view for a single mandate — chains, assets, actions,
 * time limits, protocols, spending caps. Designed as the "single source
 * of truth" surface a user reviews before trusting their AI.
 *
 * Also reusable from the signing flow: pass `signingMode` to swap the
 * footer for the signature CTA.
 */
export default function MandateDetailModal({
  mandate,
  open,
  onClose,
  onEdit,
  onRevoke,
  signingMode = false,
  onSign,
  onReject,
}) {
  const isOpen = signingMode ? open : !!mandate

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isOpen || !mandate) return null

  const editable = mandate.editable ?? {}
  const isActive = mandate.status === 'active'

  const chains = uniq([editable.chain].filter(Boolean))
  const assets = uniq([editable.asset].filter(Boolean))
  const allowed = (editable.allowed ?? []).filter((a) => a.on)
  const disallowed = (editable.disallowed ?? [])
  const protocols = inferProtocols(allowed)
  const cap = formatCap(editable)
  const time = mandate.duration ?? (editable.days ? `${editable.days} days` : '—')

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>

        <header className={styles.head}>
          <div className={styles.headAi}>
            <BrandMark name={mandate.aiName} size={26} />
            <span className={styles.headAiText}>
              {signingMode ? `${mandate.aiName} is requesting` : `Created in ${mandate.aiName}`}
            </span>
          </div>
          <MandateStatus status={mandate.status} />
        </header>

        <h2 className={`${shared.displayHeadline} ${styles.title}`}>
          {mandate.title}
        </h2>
        {mandate.summary && (
          <p className={styles.prompt}>“{mandate.summary}”</p>
        )}
        {signingMode && (
          <p className={styles.sub}>
            Review every permission before you sign. Nothing happens onchain until you authorize.
          </p>
        )}

        {mandate.actions?.length > 0 ? (
          <PermissionsPanel mandate={mandate} />
        ) : (
          <>
            <dl className={styles.list}>
              <Row k="Spending cap"  v={cap} />
              <Row k="Time limit"    v={time} />
              <Row k="Network"       v={chains.length ? chains.join(', ') : '—'} />
              <Row k="Assets"        v={assets.length ? assets.join(', ') : '—'} />
              <Row k="Protocols"     v={protocols.length ? protocols.join(' · ') : '—'} />
            </dl>

            <section className={styles.permSection}>
              <header className={styles.permHead}>
                <span className={styles.permHeadKicker}>What your AI can do</span>
                <span className={styles.permCount}>{allowed.length}</span>
              </header>
              <ul className={styles.permList}>
                {allowed.map((a) => (
                  <li key={a.id ?? a.label} className={styles.permItem}>
                    <span className={`${styles.permIcon} ${styles.permIconOk}`} aria-hidden>
                      <CheckIcon />
                    </span>
                    <span className={styles.permLabel}>{a.label}</span>
                  </li>
                ))}
                {!allowed.length && (
                  <li className={styles.permEmpty}>No actions configured.</li>
                )}
              </ul>
            </section>
          </>
        )}

        <footer className={styles.foot}>
          {signingMode ? (
            <div className={styles.signActions}>
              <SailButton onClick={onSign}>
                Authorize &amp; sign
              </SailButton>
              {onReject && (
                <SailButton variant="danger" onClick={onReject}>
                  Reject
                </SailButton>
              )}
            </div>
          ) : (
            <div className={styles.viewActions}>
              <SailButton variant="secondary" disabled={!isActive} onClick={onEdit}>
                Quick edit
              </SailButton>
              <SailButton variant="danger" disabled={!isActive} onClick={onRevoke}>
                Revoke
              </SailButton>
            </div>
          )}
        </footer>
      </GlassCard>
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowK}>{k}</dt>
      <dd className={styles.rowV}>{v}</dd>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5l2.6 2.6L11 4" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 4l6 6M10 4l-6 6" />
    </svg>
  )
}

function uniq(arr) {
  return Array.from(new Set(arr))
}

function inferProtocols(allowed) {
  const found = new Set()
  for (const a of allowed) {
    const l = (a.label ?? '').toLowerCase()
    if (l.includes('aave'))     found.add('Aave')
    if (l.includes('compound')) found.add('Compound')
    if (l.includes('gmx'))      found.add('GMX')
    if (l.includes('pendle'))   found.add('Pendle')
    if (l.includes('curve'))    found.add('Curve')
    if (l.includes('uniswap'))  found.add('Uniswap')
  }
  return Array.from(found)
}

function formatCap(editable) {
  const { amount, asset } = editable
  if (amount == null) return '—'
  if (asset === 'WETH' || asset === 'ETH') return `${amount.toFixed(2)} ${asset}`
  return `$${amount.toLocaleString()} ${asset ?? ''}`.trim()
}
