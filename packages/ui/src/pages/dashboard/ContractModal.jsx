import { useEffect, useRef, useState } from 'react'
import { GlassCard, BrandMark, ConfirmDestructiveModal } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './ContractModal.module.css'
import { useAccount } from 'wagmi'
import { useSailorAccount } from '../../hooks/useSailorData'
import {
  getNetwork,
  getToken,
  getProtocol,
  getTokenAddress,
  getProtocolAddress,
  truncateAddress,
  ACTION_KINDS,
} from '../../data/permissionsRegistry'

/**
 * The Mandate — the View Details surface presented as a formal
 * legal-style contract document.
 *
 * Sections:
 *   1. Header — kicker, contract title, parties, date drafted by AI.
 *   2. Recitals — friendly human-readable summary.
 *   3. Article I  — Parties (Owner EOA, SMA, Delegated Agent).
 *   4. Article II — Scope (networks, assets, protocols).
 *   5. Article III — Limits (spending cap, time limit).
 *   6. Article IV — Permitted actions (numbered).
 *   7. Article V  — Reservation of rights (revocation, pause).
 *   8. Signature block — two columns, AI counter-signer + user signer.
 *
 * Authorize & Sign paints the user's EOA into the signature line in a
 * formal monospace, with a timestamp and a small "signed onchain"
 * receipt. The action then propagates back to the parent.
 */
export default function ContractModal({
  open,
  mandate,
  onClose,
  onAuthorize,
  onReject,
  onRevoke,
  // readOnly = the mandate has already been signed; the contract opens
  // straight into a "signed" view with the EOA signature pre-painted
  // and no Authorize/Reject footer.
  readOnly = false,
  signedDate = null,
  /* mode controls the contract surface's purpose:
       'sign'   — drafting flow (default). Preview → signing → signed.
       'view'   — read-only signed contract (implied by readOnly).
       'revoke' — revocation flow. Opens on signed contract,
                  destructive footer, plays a stamp animation. */
  mode = 'sign',
}) {
  // Effective mode: legacy readOnly prop maps to 'view'.
  const effectiveMode = readOnly && mode === 'sign' ? 'view' : mode
  // preview → signing → signed (sign mode)
  // preview → revoking → revoked (revoke mode)
  // signed (view mode, immediate)
  const { address: mockWallet } = useAccount()
  const { account } = useSailorAccount()
  const mockSafe = account?.safe ?? null
  const mockSafes = account ? [{ name: 'My SMA', address: account.safe }] : []

  const [phase, setPhase] = useState('preview')
  const [signedAt, setSignedAt] = useState(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  // Scroll the modal's article container to the signature block when
  // the user authorizes from above the fold — guarantees they see the
  // signature animation rather than missing it off-screen.
  const sigBlockRef = useRef(null)
  const docRef = useRef(null)

  useEffect(() => {
    if (!open) return
    // View mode: contract is already signed — render signed state.
    // Revoke mode: contract is signed but live — render in preview
    //   (signed sig painted, destructive footer), wait for user.
    // Sign mode: blank preview, awaiting authorization.
    if (effectiveMode === 'view') {
      setPhase('signed')
      setSignedAt(signedDate ? new Date(signedDate) : new Date())
    } else if (effectiveMode === 'revoke') {
      setPhase('preview')
      setSignedAt(signedDate ? new Date(signedDate) : new Date())
    } else {
      setPhase('preview')
      setSignedAt(null)
    }
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      // Lock close while signing or revoking — the animation needs to finish.
      if (e.key === 'Escape' && phase !== 'signing' && phase !== 'revoking' && phase !== 'revoked') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectiveMode])

  function authorize() {
    // Bring the signature block into view first. If the user pressed
    // "Authorize & sign" from above the fold, this guarantees they
    // see the signature animation rather than staring at the article
    // body while it plays off-screen. We scroll the modal's own
    // scroll container (the .doc element) rather than calling
    // scrollIntoView — which can fail to bubble correctly inside a
    // flex column on some browsers — so the behavior is deterministic.
    const sig = sigBlockRef.current
    const doc = docRef.current
    if (sig && doc) {
      const target = Math.max(0, sig.offsetTop - (doc.clientHeight - sig.clientHeight) / 2)
      // Smooth scroll via rAF tween — `scrollTo({behavior:'smooth'})`
      // gets cancelled mid-flight by the imminent phase re-render,
      // so we drive the animation ourselves over ~360ms with an
      // ease-out curve. Lands the user on the signature block
      // before the signing animation starts.
      smoothScrollTo(doc, target, 360)
    }
    // Brief beat so the scroll lands before the animation starts —
    // the user's eye arrives, then the signature begins to paint.
    setTimeout(() => setPhase('signing'), 280)
    setTimeout(() => {
      const now = new Date()
      setSignedAt(now)
      setPhase('signed')
      // Give the user time to read the success state and feel the
      // moment before we tear the modal down.
      setTimeout(() => onAuthorize?.(mandate.id), 4200)
    }, 1600 + 280)
  }
  function finishNow() {
    onAuthorize?.(mandate.id)
  }

  /* Revocation flow — mirrors the signing animation in pacing so the
     two destructive/constructive moments feel like a matched pair.
       0ms     : scroll to signature block (user's eye lands on it)
       280ms   : phase → 'revoking' — contract body fades + lifts;
                 the REVOKED stamp begins its descent (large + faded).
       640ms   : phase → 'revoked' — stamp snaps to scale 1.0 with
                 a spring overshoot, inner ink shadow paints in, an
                 impact ring pulses outward (CSS keyframe).
       640ms+  : caption fades in below the stamp.
       3600ms  : modal tears down via onRevoke callback. */
  function revoke() {
    const sig = sigBlockRef.current
    const doc = docRef.current
    if (sig && doc) {
      const target = Math.max(0, sig.offsetTop - (doc.clientHeight - sig.clientHeight) / 2)
      smoothScrollTo(doc, target, 360)
    }
    setTimeout(() => setPhase('revoking'), 280)
    setTimeout(() => setPhase('revoked'), 640)
    setTimeout(() => onRevoke?.(mandate.id), 3600)
  }

  if (!open || !mandate) return null

  const spec = deriveSpec(mandate)
  const sma = mockSafes[0]
  const today = new Date()

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Mandate"
      onClick={phase === 'preview' ? onClose : undefined}
    >
      <GlassCard
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close"
          disabled={phase === 'signing'}
        >×</button>

        <article
          ref={docRef}
          className={`${styles.doc} ${phase === 'revoking' || phase === 'revoked' ? styles.docRevoking : ''}`}
        >
          {/* ── Document header ── */}
          <header className={styles.docHead}>
            <span className={styles.docKicker}>Mandate</span>
            <h1 className={styles.docTitle}>{mandate.title}</h1>
            <p className={styles.docLede}>
              A bounded delegation between <strong>{truncate(mockWallet)}</strong> and the agent operating inside <strong>{sma.name}</strong>.
            </p>
            <dl className={styles.docMeta}>
              <span className={styles.docMetaCell}>
                <dt>Drafted by</dt>
                <dd className={styles.docMetaWithMark}>
                  <BrandMark name={mandate.aiName} size={14} /> {mandate.aiName}
                </dd>
              </span>
              <span className={styles.docMetaCell}>
                <dt>Requested</dt>
                <dd>{mandate.requestedAgo ?? 'just now'}</dd>
              </span>
              <span className={styles.docMetaCell}>
                <dt>Effective</dt>
                <dd>upon signature</dd>
              </span>
              <span className={styles.docMetaCell}>
                <dt>Date</dt>
                <dd>{formatLongDate(today)}</dd>
              </span>
            </dl>
          </header>

          <Divider />

          {/* ── Recitals / Summary ── */}
          <Section roman="" title="Summary" kicker="Plain-language recital">
            <p className={styles.docBody}>
              The undersigned wallet (the <em>Owner</em>) hereby grants the agent identified herein a
              <em> bounded delegation</em> to act on its behalf inside the Separately Managed
              Account named <strong>{sma.name}</strong>, strictly within the scope, limits, and
              permitted actions defined by this mandate.
            </p>
            {mandate.summary && (
              <blockquote className={styles.recital}>
                <span className={styles.recitalMark} aria-hidden>“</span>
                <p>{mandate.summary}</p>
                <footer>
                  <BrandMark name={mandate.aiName} size={13} />
                  <span>Drafted by {mandate.aiName}</span>
                </footer>
              </blockquote>
            )}
          </Section>

          {/* ── Article I — Parties ── */}
          <Section roman="I" title="Parties">
            <ul className={styles.parties}>
              <Party
                role="Owner"
                desc="Externally Owned Account — sole signer"
                address={mockWallet}
              />
              <Party
                role="Safe Account"
                desc={`Separately Managed Account · ${capitalize(sma.network)}`}
                name={sma.name}
                address={mockSafe}
              />
              <Party
                role="Agent"
                desc={`Delegated EOA · operated by ${mandate.aiName}`}
                address={deriveAgentAddress(mandate)}
                active
              />
            </ul>
          </Section>

          {/* ── Article II — Scope ── */}
          <Section roman="II" title="Scope">
            <div className={styles.scopeGrid}>
              <ScopeBlock label="Networks" count={mandate.networks?.length ?? 0}>
                {(mandate.networks ?? []).map((id) => {
                  const n = getNetwork(id) ?? { label: capitalize(id), color: '#1990FF' }
                  return (
                    <span key={id} className={styles.scopePill}>
                      <span
                        className={styles.scopePillDot}
                        style={{ background: n.color }}
                        aria-hidden
                      />
                      {n.label}
                    </span>
                  )
                })}
              </ScopeBlock>
              <ScopeBlock label="Assets" count={mandate.assets?.length ?? 0}>
                {(mandate.assets ?? []).map((s) => {
                  const t = getToken(s) ?? { symbol: s, color: '#999', name: s }
                  return (
                    <span key={s} className={styles.scopePill}>
                      <span
                        className={styles.scopePillDot}
                        style={{ background: t.color }}
                        aria-hidden
                      />
                      {t.symbol}
                    </span>
                  )
                })}
              </ScopeBlock>
              <ScopeBlock label="Protocols" count={spec.protocols.length}>
                {spec.protocols.length === 0 && (
                  <span className={styles.scopeEmpty}>Any onchain target permitted under the action whitelist.</span>
                )}
                {spec.protocols.map((p) => {
                  const proto = getProtocol(p) ?? { label: capitalize(p), color: '#FFFFFF' }
                  return (
                    <span key={p} className={styles.scopePill}>
                      <span
                        className={styles.scopePillDot}
                        style={{ background: proto.color ?? '#FFFFFF' }}
                        aria-hidden
                      />
                      {proto.label}
                    </span>
                  )
                })}
              </ScopeBlock>
            </div>
          </Section>

          {/* ── Article III — Limits ── */}
          <Section roman="III" title="Limits">
            <div className={styles.limitsGrid}>
              <LimitCell label="Spending cap" emphasis>
                {mandate.caps?.length > 0 ? (
                  mandate.caps.map((c, i) => (
                    <span key={i} className={styles.limitVal}>
                      {c.currency === 'USD'
                        ? `$${c.amount.toLocaleString()}`
                        : `${c.amount} ${c.asset}`}
                      <span className={styles.limitSub}>max · {c.asset}</span>
                    </span>
                  ))
                ) : (
                  <span className={styles.limitVal}>—</span>
                )}
              </LimitCell>
              <LimitCell label="Time limit" emphasis>
                <span className={styles.limitVal}>
                  {mandate.duration ?? '—'}
                  {mandate.endsAt && (
                    <span className={styles.limitSub}>ends · {formatLongDate(new Date(mandate.endsAt * 1000))}</span>
                  )}
                </span>
              </LimitCell>
            </div>
          </Section>

          {/* ── Article IV — Permitted actions ── */}
          <Section roman="IV" title="Permitted actions" kicker={`${mandate.actions?.length ?? mandate.allowed?.length ?? 0} authorised`}>
            {mandate.actions?.length > 0 ? (
              <ol className={styles.actionList}>
                {mandate.actions.map((a, i) => {
                  const kind = ACTION_KINDS?.[a.kind] ?? { label: capitalize(a.kind), color: '#1990FF' }
                  return (
                    <li key={a.id ?? i} className={styles.actionItem}>
                      <span className={styles.actionIndex}>{romanize(i + 1).toLowerCase()}</span>
                      <div className={styles.actionBody}>
                        <span className={styles.actionLabel}>{a.label}</span>
                        <div className={styles.actionMeta}>
                          {a.asset && <span className={styles.actionChip}><span className={styles.actionChipDot} style={{ background: getToken(a.asset)?.color ?? '#999' }} />{a.asset}</span>}
                          {a.venue && <span className={styles.actionChip}><span className={styles.actionChipDot} style={{ background: getProtocol(a.venue)?.color ?? '#fff' }} />{getProtocol(a.venue)?.label ?? capitalize(a.venue)}</span>}
                          {(a.networks ?? []).map((n) => (
                            <span key={n} className={styles.actionChip}>
                              <span className={styles.actionChipDot} style={{ background: getNetwork(n)?.color ?? '#1990FF' }} />
                              {capitalize(n)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <ol className={styles.actionList}>
                {(mandate.allowed ?? []).map((label, i) => (
                  <li key={i} className={styles.actionItem}>
                    <span className={styles.actionIndex}>{romanize(i + 1).toLowerCase()}</span>
                    <div className={styles.actionBody}>
                      <span className={styles.actionLabel}>{label}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {/* ── Article V — Reservation of rights ── */}
          <Section roman="V" title="Reservation of rights">
            <ul className={styles.rights}>
              <li>The Owner may <strong>pause</strong> the agent at any time, halting future executions without revoking the mandate.</li>
              <li>The Owner may <strong>revoke</strong> the mandate at any time. Revocation is permanent and immediate onchain.</li>
              <li>The Owner retains <strong>self-custody</strong> of the Separately Managed Account at all times. Sail never holds the keys.</li>
              <li>Any action taken outside the scope, limits, or permitted actions of this mandate is <strong>rejected onchain</strong> by Template Logic.</li>
            </ul>
          </Section>

          <Divider />

          {/* ── Signature block ── */}
          <section ref={sigBlockRef} className={styles.sigBlock} aria-label="Signatures">
            <header className={styles.sigHead}>
              <span className={styles.docKicker}>Signatures</span>
              <h2 className={styles.sigTitle}>In witness whereof</h2>
              <p className={styles.sigSub}>
                Signed on {formatLongDate(today)}{phase === 'signed' && signedAt && ` at ${formatTime(signedAt)} UTC`}.
              </p>
            </header>

            <div className={styles.sigGrid}>
              {/* AI counter-signer — always already "drafted" */}
              <SignatureCard
                role="Drafted by"
                name={mandate.aiName}
                addressKicker="Agent identity"
                address={`sail-agent#${deriveAgentAddress(mandate).slice(2, 8)}`}
                state="signed"
                signatureValue={`/s/ ${mandate.aiName}`}
                signatureSub="Counter-signed at draft"
                brand={mandate.aiName}
              />

              {/* User signer — already signed in view/revoke modes;
                  empty (pending) in sign mode until Authorize. */}
              <SignatureCard
                role="Owner"
                name="Externally Owned Account"
                addressKicker="EOA address"
                address={truncate(mockWallet)}
                state={
                  effectiveMode === 'view' || effectiveMode === 'revoke' || phase === 'signed'
                    ? 'signed'
                    : phase === 'signing'
                      ? 'signing'
                      : 'pending'
                }
                signatureValue={mockWallet}
                signatureSub={
                  effectiveMode === 'view' || effectiveMode === 'revoke'
                    ? signedAt
                      ? `Signed ${formatLongDate(signedAt)} at ${formatTime(signedAt)} UTC`
                      : 'Signed onchain'
                    : phase === 'signed' && signedAt
                      ? `Signed ${formatLongDate(signedAt)} at ${formatTime(signedAt)} UTC`
                      : 'Awaiting signature'
                }
              />
            </div>

            {/* REVOKED stamp — descends onto the signature pair when
                the user confirms revocation. The visible card stays in
                place; the stamp is purely a CSS overlay. */}
            {(phase === 'revoking' || phase === 'revoked') && (
              <div
                className={`${styles.revokeStamp} ${phase === 'revoked' ? styles.revokeStampLanded : ''}`}
                aria-hidden
              >
                <span className={styles.revokeStampInner}>
                  <span className={styles.revokeStampText}>REVOKED</span>
                  <span className={styles.revokeStampDate}>
                    {signedAt && formatLongDate(signedAt)}
                  </span>
                </span>
                <span className={styles.revokeStampImpact} aria-hidden />
              </div>
            )}
          </section>

          {/* ── Actions / success ── */}
          <footer className={`${styles.docFooter} ${phase === 'signed' && effectiveMode !== 'view' ? styles.docFooterSuccess : ''} ${phase === 'revoked' ? styles.docFooterRevoked : ''}`}>
            {effectiveMode === 'view' ? (
              /* Already-signed view: just a quiet Close button and the
                 onchain timestamp so the user can read the contract. */
              <div className={styles.readOnlyFoot}>
                <span className={styles.readOnlyNote}>
                  Signed onchain · revocable at any time from the dashboard.
                </span>
                <button type="button" className={styles.readOnlyClose} onClick={onClose}>
                  Close
                </button>
              </div>
            ) : effectiveMode === 'revoke' ? (
              /* Revocation flow. */
              phase === 'preview' ? (
                <>
                  <button
                    type="button"
                    className={styles.rejectBtn}
                    onClick={revoke}
                  >
                    Revoke this mandate
                  </button>
                  <button
                    type="button"
                    className={styles.authorizeBtn}
                    onClick={onClose}
                    style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.12)', color: 'var(--text-primary)', boxShadow: 'none' }}
                  >
                    Keep it active
                  </button>
                  <p className={styles.docFooterNote}>
                    Revocation is <strong>permanent</strong> and immediate onchain. Open positions
                    stay in your SMA — Sail won't unwind anything — but your AI loses authority
                    to act and you cannot undo this.
                  </p>
                </>
              ) : phase === 'revoking' ? (
                <div className={styles.revokingBlock} role="status" aria-live="polite">
                  <span className={styles.revokingPulse} aria-hidden />
                  <span className={styles.revokingTitle}>Revoking onchain…</span>
                </div>
              ) : (
                /* phase === 'revoked' — final, calm closure. */
                <div className={styles.revokedBlock} role="status" aria-live="polite">
                  <span className={styles.revokedMark} aria-hidden>
                    <svg viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden>
                      <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1.4" />
                      <path
                        d="M10 16h12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <div className={styles.revokedBody}>
                    <span className={styles.revokedTitle}>Mandate revoked</span>
                    <span className={styles.revokedSub}>
                      The delegated EOA is permanently disabled. Funds remain self-custody.
                    </span>
                  </div>
                </div>
              )
            ) : phase !== 'signed' ? (
              <>
                <button
                  type="button"
                  className={styles.authorizeBtn}
                  onClick={authorize}
                  disabled={phase !== 'preview'}
                >
                  {phase === 'preview' && 'Authorize & sign'}
                  {phase === 'signing' && 'Signing…'}
                </button>
                <button
                  type="button"
                  className={styles.rejectBtn}
                  onClick={() => setRejectOpen(true)}
                  disabled={phase !== 'preview'}
                >
                  Reject mandate
                </button>
                <p className={styles.docFooterNote}>
                  By signing you agree to the scope, limits, and permitted actions described above.
                  Revocable at any time from the dashboard.
                </p>
              </>
            ) : (
              /* Mandate signed — celebratory feedback state. */
              <div className={styles.successBlock} role="status" aria-live="polite">
                <span className={styles.successMark} aria-hidden>
                  <svg viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden>
                    <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1.4" />
                    <path
                      d="M9 16.5l4.5 4.5L23 11"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div className={styles.successBody}>
                  <span className={styles.successTitle}>Mandate signed</span>
                  <span className={styles.successSub}>
                    Your agent is operating inside {mockSafes[0].name} now.
                    {signedAt && ` Signed at ${formatTime(signedAt)} UTC.`}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.successDone}
                  onClick={finishNow}
                  autoFocus
                >
                  Done
                </button>
              </div>
            )}
          </footer>
        </article>
      </GlassCard>

      <ConfirmDestructiveModal
        open={rejectOpen}
        title="Reject this mandate?"
        body={
          <>
            <strong style={{ color: 'var(--text-primary)' }}>{mandate.aiName}</strong> will be told the draft was declined.
            Nothing is created onchain. You can ask your AI to redraft anytime.
          </>
        }
        confirmLabel="Reject mandate"
        cancelLabel="Keep reading"
        onConfirm={() => { setRejectOpen(false); onReject?.(mandate.id) }}
        onCancel={() => setRejectOpen(false)}
      />
    </div>
  )
}

/* ─────────── helpers ─────────── */

/* Manual smooth scroll for an overflow container. We can't use
   `scrollTo({behavior:'smooth'})` here — the modal's phase change
   re-render cancels the in-flight smooth scroll silently. Driving
   the tween ourselves with rAF + an ease-out curve is robust and
   plays nicely with React state transitions. */
function smoothScrollTo(el, target, durationMs = 360) {
  if (!el) return
  const start = el.scrollTop
  const delta = target - start
  if (Math.abs(delta) < 1) return
  const startedAt = Date.now()
  const ease = (t) => 1 - Math.pow(1 - t, 3) // cubic ease-out
  // setTimeout-driven step (not rAF) so the tween also runs when the
  // document is in a background/hidden tab — rAF gets throttled to 0
  // there. ~16ms tick approximates 60fps when visible.
  function step() {
    const t = Math.min(1, (Date.now() - startedAt) / durationMs)
    el.scrollTop = start + delta * ease(t)
    if (t < 1) setTimeout(step, 16)
  }
  step()
}

function Section({ roman, title, kicker, children }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        {roman && <span className={styles.sectionRoman}>Article {roman}</span>}
        <h2 className={styles.sectionTitle}>{title}</h2>
        {kicker && <span className={styles.sectionKicker}>{kicker}</span>}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

function Divider() { return <span className={styles.divider} aria-hidden /> }

function Party({ role, name, desc, address, active }) {
  return (
    <li className={`${styles.party} ${active ? styles.partyActive : ''}`}>
      <span className={styles.partyRole}>{role}</span>
      <span className={styles.partyName}>{name ?? truncate(address)}</span>
      <span className={styles.partyDesc}>{desc}</span>
      <span className={styles.partyAddr}>{address}</span>
    </li>
  )
}

function ScopeBlock({ label, count, children }) {
  return (
    <div className={styles.scopeBlock}>
      <header className={styles.scopeHead}>
        <span>{label}</span>
        <span className={styles.scopeCount}>{count}</span>
      </header>
      <div className={styles.scopeChips}>
        {children}
      </div>
    </div>
  )
}

function LimitCell({ label, emphasis, children }) {
  return (
    <div className={`${styles.limitCell} ${emphasis ? styles.limitCellEmphasis : ''}`}>
      <span className={styles.limitLabel}>{label}</span>
      <div className={styles.limitValueWrap}>{children}</div>
    </div>
  )
}

function SignatureCard({ role, name, addressKicker, address, state, signatureValue, signatureSub, brand }) {
  /* When this card represents the AI counter-signer (Drafted by …), we
     tint the signed state with the provider's brand colour so the user
     can see at a glance which AI authored the mandate. The owner's
     signature card keeps Sail's brand blue. */
  const providerCls = brand ? styles[`sigCardProvider_${providerKey(brand)}`] : ''
  return (
    <div className={`${styles.sigCard} ${styles[`sigCard_${state}`]} ${providerCls}`}>
      <header className={styles.sigCardHead}>
        <span className={styles.sigCardRole}>{role}</span>
        {brand && <BrandMark name={brand} size={14} />}
      </header>
      <span className={styles.sigCardName}>{name}</span>
      <div className={styles.sigCardAddr}>
        <span className={styles.sigCardAddrLabel}>{addressKicker}</span>
        <span className={styles.sigCardAddrValue}>{address}</span>
      </div>

      <div className={styles.sigLineWrap}>
        <span className={styles.sigX} aria-hidden>X</span>
        <div className={styles.sigLine}>
          {state === 'signed' && (
            <span className={styles.sigValue}>{signatureValue}</span>
          )}
          {state === 'signing' && (
            <span className={styles.sigPenLine} aria-hidden />
          )}
        </div>
      </div>
      <span className={styles.sigSub}>{signatureSub}</span>
    </div>
  )
}

/* ─────────── data derivers ─────────── */
function deriveSpec(mandate) {
  // Pull "Protocols" from the action venues; if explicit list exists, use it.
  const protos = new Set()
  for (const a of mandate.actions ?? []) {
    if (a.venue) protos.add(a.venue)
  }
  return {
    protocols: Array.from(protos),
  }
}

function deriveAgentAddress(mandate) {
  // Deterministically hashed from the mandate id so the same agent
  // always shows the same MPC wallet.
  let h = 0
  const s = mandate.id ?? ''
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  h = Math.abs(h)
  const hex = h.toString(16).padStart(8, '0')
  const more = (h * 7).toString(16).padStart(8, '0')
  const more2 = (h * 11).toString(16).padStart(8, '0')
  return ('0x' + hex + more + more2 + hex).slice(0, 42)
}

function romanize(n) {
  const r = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI']
  return r[n - 1] ?? `${n}`
}
function providerKey(name) {
  const n = (name ?? '').toLowerCase()
  if (n === 'claude' || n === 'anthropic') return 'claude'
  if (n === 'cursor') return 'cursor'
  if (n === 'codex' || n === 'chatgpt' || n === 'openai' || n === 'gpt') return 'codex'
  return 'default'
}
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }
function truncate(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
function formatLongDate(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
function formatTime(d) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}
