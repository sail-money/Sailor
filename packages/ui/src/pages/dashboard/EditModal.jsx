import { useEffect, useMemo, useState } from 'react'
import { GlassCard, RevealCalldata, SailButton } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './EditModal.module.css'

/**
 * Quick, bounded edits to a signed mandate.
 * For new strategies or different venues, users are routed back to the AI.
 */
export default function EditModal({ open, mandate, onClose, onSave, onAskAIRedraft }) {
  return (
    <div
      className={`${styles.overlay} ${open ? styles.overlayOpen : ''}`}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? 'true' : undefined}
      aria-label="Adjust agent"
      onClick={onClose}
    >
      <GlassCard
        className={`${styles.card} ${open ? styles.cardOpen : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {mandate ? (
          <EditContent
            key={mandate.id}
            mandate={mandate}
            onClose={onClose}
            onSave={onSave}
            onAskAIRedraft={onAskAIRedraft}
          />
        ) : null}
      </GlassCard>
    </div>
  )
}

function EditContent({ mandate, onClose, onSave, onAskAIRedraft }) {
  const initial = mandate.editable
  const [name, setName] = useState(mandate.title || '')
  const [amount, setAmount] = useState(initial.amount)
  const [days, setDays] = useState(initial.days || 30)
  const [allowed, setAllowed] = useState(initial.allowed)
  const [phase, setPhase] = useState('editing') // editing | waiting | confirmed

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const isEth = initial.asset === 'WETH' || initial.asset === 'ETH'
  const amountStep = isEth ? 0.05 : 25
  const amountMin = isEth ? 0.05 : 25
  const amountMax = isEth ? 5 : 5000

  const fmtAmount = (n) =>
    isEth ? `${n.toFixed(2)} ${initial.asset}` : `$${n.toLocaleString()} ${initial.asset}`

  const fmtBound = (n) =>
    isEth ? `${n.toFixed(2)}` : `$${n.toLocaleString()}`

  const draftTitle = useMemo(() => {
    if (initial.kind === 'hedge') return `${initial.asset} hedge — ${amount.toFixed(2)} ETH ceiling`
    if (initial.kind === 'park') return `$${amount} ${initial.asset} stablecoin park`
    return `$${amount} ${initial.asset} yield on ${initial.chain}`
  }, [amount, initial])

  const draftConstraints = useMemo(() => {
    const base = [
      isEth ? `${amount.toFixed(2)} ETH max` : `$${amount} max`,
      initial.asset,
      initial.chain,
    ]
    const allowedOn = allowed.filter((a) => a.on)
    if (allowedOn.length === 1) base.push(allowedOn[0].label)
    return base
  }, [amount, allowed, initial, isEth])

  const calldata = useMemo(() => {
    const wei = isEth
      ? `${Math.round(amount * 1e18)}`
      : `${amount * 1_000_000}`
    const actions = allowed.filter((a) => a.on).map((a) => `"${a.id}"`).join(', ')
    return `// EIP-712 typed data — new mandate
{
  "manager":   "0xA1...c0de",
  "asset":     "${initial.asset === 'USDC'
    ? '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
    : '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'}",
  "maxAmount": "${wei}",
  "expiresAt": ${Math.floor(Date.now() / 1000) + days * 86400},
  "actions":   [${actions}]
}`
  }, [amount, days, allowed, initial, isEth])

  function toggle(id) {
    setAllowed((prev) => prev.map((a) => (a.id === id ? { ...a, on: !a.on } : a)))
  }

  function commit() {
    setPhase('waiting')
    setTimeout(() => {
      setPhase('confirmed')
      setTimeout(() => {
        onSave?.({
          ...mandate,
          title: (name && name.trim()) ? name.trim() : draftTitle,
          duration: days > 0 ? `Ends in ${days} days` : mandate.duration,
          constraints: draftConstraints,
          lastAction: { ago: 'just now', label: 'Modified mandate parameters' },
          status: 'active',
          editable: {
            ...initial,
            amount,
            days,
            allowed,
          },
        })
      }, 1100)
    }, 1700)
  }

  if (phase !== 'editing') {
    const confirmed = phase === 'confirmed'
    return (
      <div className={styles.confirm}>
        <div className={`${styles.confirmIndicator} ${confirmed ? styles.confirmDone : ''}`}>
          {confirmed ? (
            <svg viewBox="0 0 32 32" width="52" height="52" aria-hidden>
              <circle cx="16" cy="16" r="14" fill="none" stroke="var(--accent-blue)" strokeWidth="2" />
              <path d="M9 16.5l4.5 4.5L23 11" fill="none" stroke="var(--accent-blue)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className={styles.pulse} />
          )}
        </div>
        <h3 className={`${shared.displayHeadline} ${styles.confirmHeadline}`}>
          {confirmed ? 'Agent updated.' : 'Waiting for your signature…'}
        </h3>
        <p className={shared.italicMannerism}>
          {confirmed
            ? 'New constraints are now enforced on-chain.'
            : 'Approve the new agent in your wallet to continue.'}
        </p>
      </div>
    )
  }

  return (
    <>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>

      <header className={styles.header}>
        <span className={styles.quickPill}>
          <span className={styles.quickPillDot} aria-hidden />
          Quick edit
        </span>
        <h2 className={`${shared.displayHeadline} ${styles.headline}`}>
          Adjust your agent.
        </h2>
        <p className={styles.subtitle}>
          Tune the cap and time window. For bigger changes, ask your AI.
        </p>
        {mandate.summary && (
          <p className={styles.originalPrompt}>“{mandate.summary}”</p>
        )}
      </header>

      <div className={styles.body}>
        <section className={styles.renameField}>
          <label htmlFor="rename-mandate" className={styles.fieldLabel}>
            Rename agent
          </label>
          <input
            id="rename-mandate"
            type="text"
            className={styles.renameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={mandate.title}
            maxLength={64}
          />
        </section>

        <div className={styles.fieldGrid}>
          <section className={styles.field}>
            <div className={styles.fieldHead}>
              <span className={styles.fieldLabel}>Spending cap</span>
              <span className={styles.fieldValue}>{fmtAmount(amount)}</span>
            </div>
            <input
              type="range"
              className={styles.range}
              min={amountMin}
              max={amountMax}
              step={amountStep}
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value))}
              style={{ '--val': `${((amount - amountMin) / (amountMax - amountMin)) * 100}%` }}
            />
            <div className={styles.rangeBounds}>
              <span>{fmtBound(amountMin)}</span>
              <span>{fmtBound(amountMax)}</span>
            </div>
          </section>

          <section className={styles.field}>
            <div className={styles.fieldHead}>
              <span className={styles.fieldLabel}>Duration</span>
              <span className={styles.fieldValue}>{days} {days === 1 ? 'day' : 'days'}</span>
            </div>
            <input
              type="range"
              className={styles.range}
              min={1}
              max={90}
              step={1}
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
              style={{ '--val': `${((days - 1) / 89) * 100}%` }}
            />
            <div className={styles.rangeBounds}>
              <span>1 day</span>
              <span>90 days</span>
            </div>
          </section>
        </div>

        <div className={styles.calldataWrap}>
          <RevealCalldata
            calldata={calldata}
            label="View technical details"
            caption="The new EIP-712 payload your wallet will sign."
          />
        </div>
      </div>

      <footer className={styles.footer}>
        {/* The single most consequential sentence in the product. Promoted
            from italic fineprint to an amber callout immediately above
            the primary action. Fintech HIG: irreversible state changes
            must be visible *at the moment of confirmation*. */}
        <div className={styles.revokeNotice} role="note">
          <span className={styles.revokeNoticeIcon} aria-hidden>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2.5l6 11H2l6-11z" />
              <path d="M8 7v3" />
              <circle cx="8" cy="12" r=".7" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className={styles.revokeNoticeBody}>
            <span className={styles.revokeNoticeTitle}>This re-signs your agent</span>
            <span className={styles.revokeNoticeSub}>
              The current agent is revoked the instant you sign — your AI cannot act between the two signatures.
            </span>
          </span>
        </div>
        <div className={styles.actions}>
          <SailButton onClick={commit}>Save and re-sign</SailButton>
          <SailButton
            variant="secondary"
            onClick={() => {
              onClose?.()
              onAskAIRedraft?.(mandate)
            }}
          >
            Ask your AI for a bigger change →
          </SailButton>
        </div>
      </footer>
    </>
  )
}
