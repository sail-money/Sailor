import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useChains, useDisconnect, useSendTransaction, useSignTypedData, useSwitchChain } from 'wagmi'
import { GlassCard, Sai, SailButton, BadgeRow, ChainGlyph } from '../shared'
import PageHeader from '../shared/PageHeader'
import NotConnectedCard from '../shared/NotConnectedCard'
import ProfileModal from '../dashboard/ProfileModal'
import AIHandoffModal from '../dashboard/AIHandoffModal'
import styles from './SigningPage.module.css'
import shared from '../shared/shared.module.css'
import { useSailorAccount, useSailorMandateDraft } from '../../hooks/useSailorData'
import { useSigningSocket } from '../../hooks/useSigningSocket'
import { MandateSigningFlow } from '../signing/Signing'
import { explorerCodeUrl, explorerTxUrl } from '../../lib/explorer'
import { describePermission } from '../../lib/permissions'
import { nextSigningPhase, failureCopy } from './signingPhase'
import { decideSignerEntry } from './signerEntry'

const KIND_LABELS = {
  'create-sma': 'Create Safe (SMA)',
  'deploy-mandate': 'Deploy mandate',
  'register-permission': 'Register permission',
  'attach-mandate': 'Register mandate',
  'set-delegate': 'Set agent as manager',
  'arbitrary-tx': 'Arbitrary transaction',
}

const shortHex = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
const chainName = (chains, id) => chains.find((c) => c.id === id)?.name ?? `Chain ${id}`

// Pixel-art checkmark — drawn on the same 1px grid as the Sai boat logo so the
// confirmed status glyph reads as part of the brand rather than a generic tick.
// Rendered in accent blue with a soft glow; pops in when the tx confirms.
function PixelCheck({ className = '' }) {
  return (
    <svg viewBox="0 0 7 6" width="16" height="14" className={className} role="img" aria-label="Confirmed">
      <path
        fill="currentColor"
        d="M6 0h1v1h-1zM6 1h1v1h-1zM5 1h1v1h-1zM5 2h1v1h-1zM4 2h1v1h-1zM4 3h1v1h-1zM3 3h1v1h-1zM3 4h1v1h-1zM2 4h1v1h-1zM2 5h1v1h-1zM1 3h1v1h-1zM1 4h1v1h-1zM0 2h1v1h-1zM0 3h1v1h-1z"
      />
    </svg>
  )
}

// Open-in-explorer glyph — the same square-shouldered "arrow out of a box" mark
// used for utility links across the dashboard. Replaces the old "View code on
// scanner ↗" text so the signing card stays coherent with the rest of the app.
function ScannerLinkIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 9 L9 5" />
      <path d="M5.4 5 H9 V8.6" />
    </svg>
  )
}

// describePermission — plain-language fallback for what a permission/request
// authorizes, matched from its name. See lib/permissions.js (shared with the
// dashboard so the two never drift).

export default function SigningPage() {
  const { draft } = useSailorMandateDraft()
  const hasDraft = draft && (draft.permissions ?? draft.items ?? []).length > 0

  const [requests, setRequests] = useState([])
  const [phase, setPhase] = useState({ phase: 'idle' })
  const [profileOpen, setProfileOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  const _wallet = useAccount()
  const { address: walletAddress, isConnected } = _wallet
  const chains = useChains()
  const { disconnect } = useDisconnect()
  const { account: realAccount, loading: accountLoading } = useSailorAccount()

  // First-load routing: never show the bare "connect your wallet" signing-page
  // chrome to a user who hasn't onboarded yet and has nothing pending to
  // approve — send them to the wizard instead (see signerEntry.js).
  const signerEntry = decideSignerEntry({
    stateLoaded: !accountLoading,
    hasAccount: !!realAccount,
    pendingCount: requests.length,
  })
  useEffect(() => {
    if (signerEntry === 'wizard') window.location.hash = '#/dashboard'
  }, [signerEntry])

  // Mirror of requests in a ref so handleMessage can read the current length
  // inside setPhase's updater without a stale closure.
  const requestsRef = useRef([])

  const handleMessage = useCallback((msg) => {
    // Remove a request from the local pending list and return what remains.
    // Idempotent — request-resolved and request-confirmed both prune the same id.
    const pruneRequest = (requestId) => {
      const remaining = requestsRef.current.filter((r) => r.id !== requestId)
      requestsRef.current = remaining
      setRequests(remaining)
      return remaining
    }
    if (msg.type === 'pending') {
      requestsRef.current = msg.requests
      setRequests(msg.requests)
    } else if (msg.type === 'request') {
      if (!requestsRef.current.find((r) => r.id === msg.request.id)) {
        requestsRef.current = [...requestsRef.current, msg.request]
      }
      setRequests(requestsRef.current)
    } else if (msg.type === 'request-resolved' || msg.type === 'request-confirmed') {
      // Both prune the request from the local queue; nextSigningPhase (pure,
      // unit-tested in signingPhase.test.js) decides whether to advance to the
      // next card or take the terminal screen — so both handlers are locked to
      // the same queue/screen invariant. Compute inside the setPhase updater so
      // it reads the freshest phase (the child sets 'done'/'submitting' directly).
      const remaining = pruneRequest(msg.requestId)
      setPhase((p) => nextSigningPhase(p, remaining.length, msg))
    }
  }, [])

  const { status: daemonStatus, send } = useSigningSocket({ onMessage: handleMessage })

  useEffect(() => {
    if (daemonStatus !== 'connected') return
    if (isConnected && walletAddress) send({ type: 'wallet-connected', address: walletAddress })
    else send({ type: 'wallet-disconnected' })
  }, [daemonStatus, walletAddress, isConnected, send])

  const profileSafes = realAccount
    ? [{ id: 'live-sma', name: 'My SMA', address: realAccount.safe, network: realAccount.chainId === 8453 ? 'base' : realAccount.chainId === 42161 ? 'arbitrum' : 'ethereum', networks: [], agentCount: 0, createdAt: null }]
    : []

  return (
    <div className={styles.shell}>
      <PageHeader
        eyebrow="Signing"
        title="Pending Signatures"
        backTo="#/dashboard"
        leaveLabel={requests.length > 0 || hasDraft ? 'Sign later' : 'Back to dashboard'}
      />

      <main className={styles.main}>
        {signerEntry === 'loading' || signerEntry === 'wizard' ? (
          // Neutral loading beat — either state hasn't resolved yet, or we're
          // about to redirect to the wizard (the effect above fires this render).
          // Never the signing page's interactive chrome before we know it's the right view.
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, padding: '40px 0' }}>
            <Sai size={64} animate />
          </div>
        ) : !isConnected ? (
          // Left-aligned like every other gate — the card carries its own layout.
          <div style={{ display: 'flex', flex: 1, padding: '24px 0' }}>
            <NotConnectedCard eyebrow="SIGNING" title="Connect to approve requests." sub="Connect the owner wallet to review and sign pending agent requests." />
          </div>
        ) : phase.phase === 'success' ? (
          <TransactionStateCard state="confirmed" kind={phase.kind} note={phase.note} onDone={() => { setPhase({ phase: 'idle' }); window.location.hash = '#/dashboard' }} />
        ) : phase.phase === 'chain-failed' ? (
          <FailureScreen outcome={phase.outcome} message={phase.message} onDone={() => { setPhase({ phase: 'idle' }); window.location.hash = '#/dashboard' }} />
        ) : phase.phase === 'unverified' ? (
          <UnverifiedScreen message={phase.message} onDone={() => { setPhase({ phase: 'idle' }); window.location.hash = '#/dashboard' }} />
        ) : phase.phase === 'awaiting-confirmation' ? (
          <TransactionStateCard state="submitting" kind={phase.kind} onDone={() => { setPhase({ phase: 'idle' }); window.location.hash = '#/dashboard' }} />
        ) : hasDraft ? (
          <MandateSigningFlow draft={draft} />
        ) : requests.length === 0 ? (
          <EmptyQueue daemonConnected={daemonStatus === 'connected'} onAsk={() => setAiOpen(true)} />
        ) : (
          <Orchestrator requests={requests} chains={chains} phase={phase} setPhase={setPhase} send={send} />
        )}
      </main>

      <ProfileModal
        open={profileOpen}
        wallet={walletAddress}
        safes={profileSafes}
        currentSafeId="live-sma"
        hasSMA={!!realAccount}
        onClose={() => setProfileOpen(false)}
        onDisconnect={() => { setProfileOpen(false); disconnect() }}
        onCreateSMA={() => { setProfileOpen(false); window.location.hash = '#/dashboard' }}
        onRenameSafe={() => {}}
        onSelectSafe={() => {}}
      />

      <AIHandoffModal
        open={aiOpen}
        variant="new"
        context="signer"
        onClose={() => setAiOpen(false)}
      />
    </div>
  )
}

function Orchestrator({ requests, chains, phase, setPhase, send }) {
  const { sendTransactionAsync } = useSendTransaction()
  const { signTypedDataAsync } = useSignTypedData()

  const handleSign = useCallback(async (req) => {
    setPhase({ phase: 'submitting', requestId: req.id, kind: req.kind })
    try {
      if (req.type === 'transaction') {
        const hash = await sendTransactionAsync({
          to: req.to ? req.to : undefined,
          data: req.data,
          value: req.value ? BigInt(req.value) : 0n,
          chainId: req.chainId,
        })
        setPhase({ phase: 'done', requestId: req.id, kind: req.kind, txHash: hash })
        send({ type: 'signed', requestId: req.id, txHash: hash })
      } else {
        const message = Object.fromEntries(
          Object.entries(req.typedData.message).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v])
        )
        const sig = await signTypedDataAsync({ domain: req.typedData.domain, types: req.typedData.types, primaryType: req.typedData.primaryType, message })
        setPhase({ phase: 'done', requestId: req.id, kind: req.kind, txHash: sig })
        send({ type: 'signature', requestId: req.id, signature: sig })
      }
    } catch (err) {
      setPhase({ phase: 'error', requestId: req.id, kind: req.kind, message: err instanceof Error ? err.message : String(err) })
    }
  }, [sendTransactionAsync, signTypedDataAsync, setPhase, send])

  const handleReject = useCallback((id) => {
    setPhase({ phase: 'idle' })
    send({ type: 'rejected', requestId: id })
  }, [setPhase, send])

  // Only one signing operation can be active at a time — if any card is
  // submitting/done, disable the sign button on all others to prevent
  // simultaneous wallet prompts.
  const signingInProgress = phase.phase === 'submitting' || phase.phase === 'done'

  return (
    <>
      {requests.map((req) => (
        <OperationCard
          key={req.id}
          request={req}
          chains={chains}
          phase={phase}
          onSign={handleSign}
          onReject={handleReject}
          otherActive={signingInProgress && phase.requestId !== req.id}
        />
      ))}
    </>
  )
}

function OperationCard({ request, chains, phase, onSign, onReject, otherActive }) {
  const _wallet = useAccount()
  const { isConnected, chainId: walletChain } = _wallet
  const { switchChain } = useSwitchChain()

  const mine = phase.requestId === request.id
  const submitting = mine && phase.phase === 'submitting'
  const done = mine && phase.phase === 'done'
  const hasError = mine && phase.phase === 'error'
  const wrongChain = isConnected && walletChain !== undefined && walletChain !== request.chainId

  return (
    <div className={styles.card}>
      <span className={styles.cardKicker}>{KIND_LABELS[request.kind] ?? request.kind}</span>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{request.title}</h2>
        <p className={styles.cardDesc}>{request.description}</p>
      </div>

      {request.permissions?.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
          {request.permissions.map((p, i) => {
            const codeUrl = p.address ? explorerCodeUrl(request.chainId, p.address) : null
            return (
              <div key={p.address ?? i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, rgba(255,255,255,0.72))' }}>{p.label}</span>
                  {codeUrl && (
                    <a href={codeUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={styles.scannerLink} title="View verified code on scanner" aria-label={`View verified code for ${p.label} on the block explorer`}>
                      <ScannerLinkIcon />
                    </a>
                  )}
                </div>
                {p.explanation
                  ? <ExplanationBlock ex={p.explanation} />
                  : <p className={styles.permFallback}>{describePermission(p.label)}</p>}
              </div>
            )
          })}
        </div>
      ) : request.explanation ? (
        <ExplanationBlock ex={request.explanation} />
      ) : (
        <p className={styles.permFallback}>{describePermission(request.title || request.kind)}</p>
      )}

      <div className={styles.details}>
        {request.details.map((d) => <DetailRow key={d.label} label={d.label} value={d.value} chainId={request.chainId} />)}
        <DetailRow label="Network" value={chainName(chains, request.chainId)} mono={false} />
        {request.type === 'transaction' && request.to && <DetailRow label="Contract" value={request.to} chainId={request.chainId} />}
        {request.type === 'transaction' && !request.to && <DetailRow label="Action" value="Deploys a new contract" mono={false} />}
      </div>

      {request.registrationFee && (
        <div style={{
          marginTop: 4,
          marginBottom: 4,
          padding: '10px 12px',
          borderRadius: 2,
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Registration fee</span>
          <span style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 14, color: 'var(--text-primary, #fff)', fontWeight: 600 }}>
              {request.registrationFee.totalEth} {request.registrationFee.symbol ?? 'ETH'}
            </span>
            {request.registrationFee.permissionCount > 1 && request.registrationFee.perPermissionEth && (
              <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                {request.registrationFee.permissionCount} permissions × {request.registrationFee.perPermissionEth} {request.registrationFee.symbol ?? 'ETH'}
              </span>
            )}
          </span>
        </div>
      )}

      {done && (
        <div className={`${styles.banner} ${styles.ok}`}>
          Submitted —{' '}
          {request.type === 'transaction' && explorerTxUrl(request.chainId, phase.txHash) ? (
            <a href={explorerTxUrl(request.chainId, phase.txHash)} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
              {shortHex(phase.txHash)} ↗
            </a>
          ) : shortHex(phase.txHash)}
        </div>
      )}
      {hasError && <div className={`${styles.banner} ${styles.danger}`}>{phase.message}</div>}
      {wrongChain && (
        <div className={`${styles.banner} ${styles.warn}`}>
          <span className={styles.chainSwitchFrom}>
            <ChainGlyph chainId={walletChain} size={15} />
            Wallet is on {chainName(chains, walletChain)}.
          </span>
          <button type="button" className={styles.chainSwitchBtn} onClick={() => switchChain({ chainId: request.chainId })}>
            Switch to <ChainGlyph chainId={request.chainId} size={15} /> {chainName(chains, request.chainId)}
          </button>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.reject} disabled={submitting || done || otherActive} onClick={() => onReject(request.id)}>Reject</button>
        {!isConnected ? (
          <span className={styles.connectHint}>Connect wallet to sign</span>
        ) : (
          <button type="button" className={styles.primary} disabled={submitting || done || wrongChain || otherActive} onClick={() => onSign(request)}>
            {otherActive ? 'Waiting…' : submitting ? (request.type === 'typed-data' ? 'Signing…' : 'Submitting…') : done ? 'Signed ✓' : request.type === 'typed-data' ? 'Sign message' : 'Sign & submit'}
          </button>
        )}
      </div>
    </div>
  )
}

/* Plain-language summary of the permission being signed, parsed from the
   contract's comments by the CLI (explainPermission). Mirrors the mandate
   review panel so deploy/registration cards say what is being authorized. */
function ExplanationBlock({ ex }) {
  const hasBody = (ex.enforced?.length ?? 0) > 0 || (ex.notEnforced?.length ?? 0) > 0
  if (!hasBody) return null

  return (
    <div style={{
      margin: '0 0 14px', padding: 12, borderRadius: 6,
      background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
        What you're signing
      </div>
      <BadgeRow items={[ex.protocol, ex.chain, ex.version]} />
      {ex.enforced?.length > 0 && (
        <div style={{ marginBottom: ex.notEnforced?.length > 0 ? 8 : 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4DABFF', marginBottom: 5 }}>
            Enforced on-chain
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {ex.enforced.map((b, i) => (
              <li key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', paddingLeft: 12, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0, color: '#4DABFF' }}>·</span>{b}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ex.notEnforced?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 5 }}>
            {/* Bespoke explanations (explainPermission) always carry `source`; shared-template
                explanations (SHARED_TEMPLATE_EXPLANATIONS) never do — the gap is a protocol
                boundary, not agent code, so it gets different framing. */}
            {ex.source ? 'Agent code — not enforced on-chain' : 'Not enforced by this permission'}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {ex.notEnforced.map((b, i) => (
              <li key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', paddingLeft: 12, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0 }}>·</span>{b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, mono = true, chainId }) {
  // For a permission/contract address, link to its verified source on the
  // chain's block explorer (Basescan/Etherscan/…). Label kept generic
  // ("scanner") so it reads the same on every network.
  const isAddress = typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)
  const isContract = /contract|permission/i.test(label)
  const codeUrl = isAddress && isContract && chainId ? explorerCodeUrl(chainId, value) : null

  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {mono ? <code className={styles.detailValue}>{value}</code> : <span className={styles.detailValue}>{value}</span>}
        {codeUrl && (
          <a href={codeUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={styles.scannerLink} title="View verified code on scanner" aria-label="View verified contract code on the block explorer">
            <ScannerLinkIcon />
          </a>
        )}
      </span>
    </div>
  )
}

/* ONE card for the whole post-signature lifecycle. After the owner signs, the
   agent submits the tx (state='submitting') and then it confirms on-chain
   (state='confirmed') — this single card transitions in place rather than
   swapping between two different screens. The primary action stays grey
   (secondary) while confirming and turns blue (primary) once confirmed. */
function TransactionStateCard({ state, kind, note, onDone }) {
  const isPermission = kind === 'register-permission' || kind === 'attach-mandate'
  const confirmed = state === 'confirmed'
  const headline = confirmed
    ? (isPermission ? 'Permission registered.' : 'Confirmed on-chain.')
    : 'Signature received.'
  const tagline = confirmed
    ? (isPermission
        ? 'Your agent is now authorized to dispatch within this permission.'
        : 'The transaction is confirmed on-chain.')
    : 'The agent is submitting the on-chain transaction — this updates automatically once it confirms.'
  return (
    <GlassCard className={`${styles.emptyCard} ${styles.txCard} ${confirmed ? styles.txCardDone : ''}`}>
      {/* Indeterminate progress bar along the card's top edge — the primary
          "actively confirming" signal while we wait for the on-chain receipt.
          Only rendered in the pending state; it resolves away on confirmation. */}
      {!confirmed && (
        <div className={styles.txProgress} aria-hidden>
          <span className={styles.txProgressBar} />
        </div>
      )}
      <div className={styles.emptyCardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.emptyCardHeader}>
        <span className={styles.txState}>
          {confirmed
            ? <PixelCheck className={styles.txCheck} />
            : <span className={`${styles.txStateDot} ${styles.txStateDotPending}`} aria-hidden />}
          <span className={styles.emptyKicker}>{confirmed ? 'CONFIRMED' : 'SUBMITTING'}</span>
        </span>
        <h1 className={`${shared.displayHeadline} ${styles.emptyHeadline}`} style={confirmed ? { color: '#4DABFF' } : undefined}>
          {headline}
        </h1>
        <p className={`${shared.italicMannerism} ${styles.emptyTagline}`}>
          {tagline}
        </p>
        {confirmed && note && (
          <p className={`${shared.italicMannerism} ${styles.emptyTagline}`} style={{ opacity: 0.8 }}>
            {note}
          </p>
        )}
      </header>
      <div className={styles.emptyCta}>
        {/* The primary action stays disabled until the transaction confirms, so the
            owner can't leave mid-submission. The page header's "Back to dashboard"
            remains available as an escape hatch if confirmation stalls. */}
        {confirmed ? (
          <SailButton fullWidth variant="primary" onClick={onDone}>
            Back to dashboard →
          </SailButton>
        ) : (
          <SailButton fullWidth variant="secondary" disabled aria-live="polite">
            <span className={styles.txSpinner} aria-hidden />
            Waiting for confirmation…
          </SailButton>
        )}
      </div>
    </GlassCard>
  )
}

function FailureScreen({ outcome, message, onDone }) {
  // 'reverted' = mined then reverted on-chain; 'failed' = the submission itself
  // errored, so the transaction was never sent. Worded distinctly (failureCopy).
  const copy = failureCopy(outcome)
  return (
    <GlassCard className={styles.emptyCard}>
      <div className={styles.emptyCardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.emptyCardHeader}>
        <span className={styles.emptyKicker} style={{ color: 'var(--danger)' }}>
          {copy.kicker}
        </span>
        <h1 className={`${shared.displayHeadline} ${styles.emptyHeadline}`} style={{ color: 'var(--danger)' }}>
          {copy.headline}
        </h1>
        {/* Raw node/viem errors can be very long (they inline the full calldata),
            so the message scrolls inside a clamped box instead of blowing out the
            modal width. */}
        <p className={styles.failMessage}>
          {message}
        </p>
      </header>
      <div className={styles.emptyCta}>
        <SailButton fullWidth onClick={onDone}>
          Back to dashboard →
        </SailButton>
      </div>
    </GlassCard>
  )
}

/* Signed and submitted (we have a tx hash), but the receipt could not be
   observed — no RPC for the chain, or the wait timed out. Deliberately NOT a
   red failure: the transaction may well have succeeded. */
function UnverifiedScreen({ message, onDone }) {
  return (
    <GlassCard className={styles.emptyCard}>
      <div className={styles.emptyCardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.emptyCardHeader}>
        <span className={styles.emptyKicker} style={{ color: 'var(--warn)' }}>UNCONFIRMED</span>
        <h1 className={`${shared.displayHeadline} ${styles.emptyHeadline}`} style={{ color: 'var(--warn)' }}>
          Signed &amp; submitted — could not confirm.
        </h1>
        <p className={`${shared.italicMannerism} ${styles.emptyTagline}`}>
          {message ?? 'The transaction was submitted but its on-chain result could not be read here.'}
        </p>
        <p className={`${shared.italicMannerism} ${styles.emptyTagline}`} style={{ opacity: 0.8 }}>
          It may still have succeeded — verify with <code>sailor mandate list</code>.
        </p>
      </header>
      <div className={styles.emptyCta}>
        <SailButton fullWidth onClick={onDone}>
          Back to dashboard →
        </SailButton>
      </div>
    </GlassCard>
  )
}

function EmptyQueue({ daemonConnected, onAsk }) {
  return (
    <GlassCard className={styles.emptyCard}>
      <div className={styles.emptyCardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.emptyCardHeader}>
        <span className={styles.emptyKicker}>SIGNING</span>
        <h1 className={`${shared.displayHeadline} ${styles.emptyHeadline}`}>
          No signatures pending.
        </h1>
        <p className={`${shared.italicMannerism} ${styles.emptyTagline}`}>
          {daemonConnected
            ? 'Nothing to sign right now — your agent drops approval requests here as it works.'
            : <>Run <code style={{ fontSize: 13, opacity: 0.8 }}>sailor station start</code> to connect — this page reconnects on its own.</>}
        </p>
      </header>
      <div className={styles.emptyCta}>
        <SailButton fullWidth onClick={onAsk}>
          Ask AI how to get started
        </SailButton>
      </div>
    </GlassCard>
  )
}
