'use client'

import { useCallback, useEffect, useState } from 'react'
import { GlassCard, RevealCalldata, Sai } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './PendingSigningModal.module.css'
import { useMockSigner } from '../../hooks/useMockSigner'
import { submitMandate } from '../../data/sailorClient'

/* User-facing labels for each SigningRequest.kind. Lifted from
   Sailor/packages/ui/src/pages/station/SigningStation.jsx:14 and extended
   with the kinds the SDK declares (revoke / arbitrary). */
const KIND_LABELS = {
  'create-sma': 'Create Safe (SMA)',
  'deploy-mandate': 'Deploy mandate',
  'register-permission': 'Register permission',
  'attach-mandate': 'Attach mandate',
  'revoke-permissions': 'Revoke permissions',
  'set-delegate': 'Set agent as manager',
  'arbitrary-tx': 'Transaction',
}

const CHAIN_NAMES = {
  1: 'Ethereum',
  130: 'Unichain',
  8453: 'Base',
  42161: 'Arbitrum',
  1301: 'Unichain Sepolia',
  11155111: 'Sepolia',
  421614: 'Arbitrum Sepolia',
  84532: 'Base Sepolia',
}
const chainName = (id) => CHAIN_NAMES[id] ?? `Chain ${id}`
const shortHex = (h) => (h && h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h ?? '')

/**
 * Surface 4 — the pending-signing surface that replaces the standalone
 * signing-station PAGE. Opened from the dashboard banner.
 *
 * Each item is a `SigningRequest` (see @sail/sdk/signing.ts): base
 * { id, kind, title, description, chainId, details[], createdAt } plus either
 * a `transaction` ({to?, value, data}) or `typed-data` ({typedData}) payload.
 * A mandate-draft (GET /api/mandate-draft) is surfaced here too as a synthetic
 * card whose Authorize signs the draft then POSTs /api/mandate-submit.
 *
 * Authorize / Reject are wired through the signing channel (`send`), exactly
 * like SigningStation's Orchestrator (lines 172–204). The channel resolves the
 * request and echoes `request-resolved`; the dashboard drops it from state,
 * shrinking this list and the banner count.
 */
export default function PendingSigningModal({
  open,
  requests = [],
  draft = null,
  wallet,
  send,
  onClose,
  onDraftSubmitted,
}) {
  const { isConnected, address, chainId: walletChain } = wallet ?? {}
  const { sendTransactionAsync, signTypedDataAsync } = useMockSigner()

  // phase: { phase:'idle'|'submitting'|'done'|'error', requestId, kind, txHash?, message? }
  const [phase, setPhase] = useState({ phase: 'idle' })

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  // Only one signing op may be live at a time — disable the others while one
  // is submitting/done (prevents simultaneous wallet prompts when live).
  const signingInProgress = phase.phase === 'submitting' || phase.phase === 'done'

  // When the channel resolves the active request, the dashboard drops it from
  // `requests`. Reset our local phase so the remaining cards leave their
  // `Waiting…`/disabled state (mirrors SigningStation's request-resolved reset).
  useEffect(() => {
    if (phase.phase === 'idle') return
    if (!requests.some((r) => r.id === phase.requestId)) setPhase({ phase: 'idle' })
  }, [requests, phase.phase, phase.requestId])

  /* ── Authorize a SigningRequest ── (lifted from SigningStation Orchestrator) */
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
        send?.({ type: 'signed', requestId: req.id, txHash: hash })
      } else {
        // typed-data: restore stringified-bigint message fields to BigInt.
        const message = Object.fromEntries(
          Object.entries(req.typedData.message).map(([k, v]) =>
            [k, typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v],
          ),
        )
        const sig = await signTypedDataAsync({
          domain: req.typedData.domain,
          types: req.typedData.types,
          primaryType: req.typedData.primaryType,
          message,
        })
        setPhase({ phase: 'done', requestId: req.id, kind: req.kind, txHash: sig })
        send?.({ type: 'signature', requestId: req.id, signature: sig })
      }
    } catch (err) {
      setPhase({
        phase: 'error',
        requestId: req.id,
        kind: req.kind,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [sendTransactionAsync, signTypedDataAsync, send])

  const handleReject = useCallback((id) => {
    setPhase({ phase: 'idle' })
    send?.({ type: 'rejected', requestId: id })
  }, [send])

  /* ── Authorize a mandate draft ──
     Sign the draft's typed-data, then persist via POST /api/mandate-submit. */
  const [draftPhase, setDraftPhase] = useState({ phase: 'idle' })
  const handleSignDraft = useCallback(async () => {
    if (!draft) return
    setDraftPhase({ phase: 'submitting' })
    try {
      const td = draft.typedData
      let signature = '0xmock-draft-signature'
      if (td) {
        const message = Object.fromEntries(
          Object.entries(td.message ?? {}).map(([k, v]) =>
            [k, typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v],
          ),
        )
        signature = await signTypedDataAsync({
          domain: td.domain, types: td.types, primaryType: td.primaryType, message,
        })
      }
      const signedAt = new Date().toISOString()
      await submitMandate({ signature, signedAt })
      setDraftPhase({ phase: 'done' })
      onDraftSubmitted?.()
    } catch (err) {
      setDraftPhase({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [draft, signTypedDataAsync, onDraftSubmitted])

  if (!open) return null

  const count = requests.length + (draft ? 1 : 0)

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>

        <header className={styles.header}>
          <span className={styles.kicker}>
            <span className={styles.kickerDot} aria-hidden />
            {count} awaiting signature
          </span>
          <h2 className={`${shared.displayHeadline} ${styles.headline}`}>
            {count === 0
              ? "You're all caught up."
              : count === 1
                ? 'One request needs your signature.'
                : 'Requests awaiting your signature.'}
          </h2>
          {count > 0 && (
            <p className={styles.sub}>
              Your agent drafted {count === 1 ? 'this operation' : 'these operations'}. Review the
              plain-English summary against the calldata, then authorize to bring it on-chain. You are
              the only key that can.
            </p>
          )}
        </header>

        {!isConnected && (
          <div className={styles.gateNote}>
            <span className={styles.gateNoteDot} aria-hidden />
            Connect the Owner wallet to authorize. Review is available, but signing is disabled until
            you connect.
          </div>
        )}

        <ul className={styles.list}>
          {draft && (
            <DraftCard
              draft={draft}
              phase={draftPhase}
              disabled={signingInProgress}
              canSign={Boolean(isConnected)}
              onSign={handleSignDraft}
            />
          )}
          {requests.map((req) => (
            <OperationCard
              key={req.id}
              request={req}
              phase={phase}
              canSign={Boolean(isConnected)}
              walletChain={walletChain}
              otherActive={signingInProgress && phase.requestId !== req.id}
              onSign={handleSign}
              onReject={handleReject}
            />
          ))}
        </ul>

        {count === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptySai} aria-hidden><Sai size={52} animate /></div>
            <p className={styles.emptyText}>Queue clear. Your agent will push new requests here as it works.</p>
          </div>
        )}

        <button type="button" className={styles.later} onClick={onClose}>
          {count === 0 ? 'Close' : 'Review later — keep in notifications'}
        </button>
      </GlassCard>
    </div>
  )
}

/* ────────── One signing request, rendered as a reviewable contract ────────── */
function OperationCard({ request, phase, canSign, walletChain, otherActive, onSign, onReject }) {
  const mine = phase.requestId === request.id
  const submitting = mine && phase.phase === 'submitting'
  const done = mine && phase.phase === 'done'
  const hasError = mine && phase.phase === 'error'
  const wrongChain = canSign && walletChain != null && walletChain !== request.chainId

  const isTyped = request.type === 'typed-data'
  const isDeploy = request.type === 'transaction' && !request.to
  // Don't synthesize an Action row if the request already provides one.
  const hasActionDetail = (request.details ?? []).some((d) => /^action$/i.test(d.label))

  // The technical payload behind the plain-English summary — typed-data message
  // or the raw transaction calldata. Must match the details[] above it.
  const calldata = isTyped
    ? JSON.stringify(
        {
          primaryType: request.typedData.primaryType,
          domain: request.typedData.domain,
          message: request.typedData.message,
        },
        null, 2,
      )
    : request.data

  return (
    <li className={`${styles.item} ${done ? styles.itemDone : ''}`}>
      <header className={styles.itemTop}>
        <span className={styles.itemKind}>{KIND_LABELS[request.kind] ?? request.kind}</span>
        <span className={styles.itemAgo}>{request.type === 'typed-data' ? 'SIGNATURE' : 'TRANSACTION'}</span>
      </header>

      <h3 className={`${shared.displayHeadline} ${styles.itemTitle}`}>{request.title}</h3>
      {request.description && <p className={styles.itemDesc}>{request.description}</p>}

      <dl className={styles.details}>
        {(request.details ?? []).map((d) => (
          <div key={d.label} className={styles.detailRow}>
            <dt className={styles.detailK}>{d.label}</dt>
            <dd className={styles.detailV}>{d.value}</dd>
          </div>
        ))}
        <div className={styles.detailRow}>
          <dt className={styles.detailK}>Network</dt>
          <dd className={styles.detailV}>{chainName(request.chainId)}</dd>
        </div>
        {request.type === 'transaction' && request.to && (
          <div className={styles.detailRow}>
            <dt className={styles.detailK}>Contract</dt>
            <dd className={`${styles.detailV} ${styles.detailMono}`}>{request.to}</dd>
          </div>
        )}
        {isDeploy && !hasActionDetail && (
          <div className={styles.detailRow}>
            <dt className={styles.detailK}>Action</dt>
            <dd className={styles.detailV}>Deploys a new contract</dd>
          </div>
        )}
      </dl>

      <RevealCalldata
        calldata={calldata}
        label={isTyped ? 'View signed message' : 'View raw calldata'}
        caption={
          isTyped
            ? 'This is the exact EIP-712 message your wallet will sign. The summary above is derived from it.'
            : 'This is the exact calldata that will be broadcast. The summary above is derived from it.'
        }
      />

      {done && <div className={`${styles.banner} ${styles.bannerOk}`}>Submitted · {shortHex(phase.txHash)}</div>}
      {hasError && <div className={`${styles.banner} ${styles.bannerDanger}`}>{phase.message}</div>}
      {wrongChain && (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          Wallet is on {chainName(walletChain)} — switch to {chainName(request.chainId)} to sign.
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.reject}
          disabled={submitting || done || otherActive}
          onClick={() => onReject(request.id)}
        >
          Reject
        </button>
        <button
          type="button"
          className={styles.authorize}
          disabled={!canSign || submitting || done || wrongChain || otherActive}
          onClick={() => onSign(request)}
        >
          {!canSign
            ? 'Connect to sign'
            : otherActive
              ? 'Waiting…'
              : submitting
                ? (isTyped ? 'Signing…' : 'Submitting…')
                : done
                  ? 'Signed ✓'
                  : isTyped ? 'Sign message' : 'Sign & submit'}
        </button>
      </div>
    </li>
  )
}

/* ────────── Mandate draft (GET /api/mandate-draft) ──────────
   A draft is not yet a SigningRequest — it's the agent's proposed mandate,
   reviewed item-by-item, signed once, then persisted via /api/mandate-submit. */
function DraftCard({ draft, phase, disabled, canSign, onSign }) {
  const submitting = phase.phase === 'submitting'
  const done = phase.phase === 'done'
  const hasError = phase.phase === 'error'
  const items = draft.items ?? []

  return (
    <li className={`${styles.item} ${done ? styles.itemDone : ''}`}>
      <header className={styles.itemTop}>
        <span className={styles.itemKind}>Mandate draft</span>
        <span className={styles.itemAgo}>SIGNATURE</span>
      </header>

      <h3 className={`${shared.displayHeadline} ${styles.itemTitle}`}>Review your new mandate</h3>
      <p className={styles.itemDesc}>
        Each line is one permission your agent will hold under this mandate. Signing authorizes the
        whole set — nothing outside it.
      </p>

      <ul className={styles.draftItems}>
        {items.map((it, i) => (
          <li key={i} className={styles.draftItem}>
            <span className={styles.draftItemDot} aria-hidden />
            <div className={styles.draftItemBody}>
              <span className={styles.draftItemTemplate}>{it.template}</span>
              {it.explanation && <span className={styles.draftItemExplain}>{it.explanation}</span>}
            </div>
          </li>
        ))}
      </ul>

      {draft.typedData && (
        <RevealCalldata
          calldata={JSON.stringify(draft.typedData, null, 2)}
          label="View signed message"
          caption="The exact EIP-712 mandate your wallet will sign."
        />
      )}

      {done && <div className={`${styles.banner} ${styles.bannerOk}`}>Mandate signed & submitted</div>}
      {hasError && <div className={`${styles.banner} ${styles.bannerDanger}`}>{phase.message}</div>}

      <div className={styles.actions}>
        <span />
        <button
          type="button"
          className={styles.authorize}
          disabled={!canSign || submitting || done || disabled}
          onClick={onSign}
        >
          {!canSign ? 'Connect to sign' : submitting ? 'Signing…' : done ? 'Signed ✓' : 'Sign mandate'}
        </button>
      </div>
    </li>
  )
}
