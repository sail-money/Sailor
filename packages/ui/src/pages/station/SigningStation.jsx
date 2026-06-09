import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useChains, useDisconnect, useSendTransaction, useSignTypedData, useSwitchChain } from 'wagmi'
import { FluidBackground, GlassCard, Sai, SailButton } from '../shared'
import PageHeader from '../shared/PageHeader'
import ChainIcon from '../shared/ChainIcon'
import NotConnectedCard from '../shared/NotConnectedCard'
import ProfileModal from '../dashboard/ProfileModal'
import AIHandoffModal from '../dashboard/AIHandoffModal'
import styles from './SigningStation.module.css'
import shared from '../shared/shared.module.css'
import { useSailorAccount, useSailorMandateDraft } from '../../hooks/useSailorData'
import { useSigningSocket } from '../../hooks/useSigningSocket'
import { MandateSigningFlow } from '../signing/Signing'

const KIND_LABELS = {
  'create-sma': 'Create Safe (SMA)',
  'deploy-mandate': 'Deploy Mandate',
  'register-permission': 'Register Permission',
  'attach-mandate': 'Attach Mandate',
  'set-delegate': 'Set Agent as Manager',
}

const shortHex = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
const chainName = (chains, id) => chains.find((c) => c.id === id)?.name ?? `Chain ${id}`

/* ── Chain dropdown ── */
function ChainDropdown({ open, onClose }) {
  const chains = useChains()
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [switching, setSwitching] = useState(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!e.target?.closest?.(`.${styles.chainDropdownWrap}`)) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', key) }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.chainMenu}>
      <header className={styles.chainMenuHeader}>Switch network</header>
      <ul className={styles.chainMenuList}>
        {chains.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`${styles.chainOption} ${c.id === chainId ? styles.chainOptionActive : ''}`}
              disabled={switching === c.id}
              onClick={async () => {
                setSwitching(c.id)
                try { await switchChainAsync({ chainId: c.id }) } catch { /* user rejected */ }
                setSwitching(null)
                onClose()
              }}
            >
              <ChainIcon chainId={c.id} size={18} />
              <span className={styles.chainOptionName}>{c.name}</span>
              {c.id === chainId && <span className={styles.chainCheck}>✓</span>}
              {switching === c.id && <span className={styles.chainSwitching}>…</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SigningStation() {
  const { draft } = useSailorMandateDraft()
  const hasDraft = draft && (draft.permissions ?? draft.items ?? []).length > 0

  const [requests, setRequests] = useState([])
  const [phase, setPhase] = useState({ phase: 'idle' })
  const [profileOpen, setProfileOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  const { address: walletAddress, isConnected } = useAccount()
  const chains = useChains()
  const { disconnect } = useDisconnect()
  const { account: realAccount } = useSailorAccount()

  // Mirror of requests in a ref so handleMessage can read the current length
  // inside setPhase's updater without a stale closure.
  const requestsRef = useRef([])

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'pending') {
      requestsRef.current = msg.requests
      setRequests(msg.requests)
    } else if (msg.type === 'request') {
      if (!requestsRef.current.find((r) => r.id === msg.request.id)) {
        requestsRef.current = [...requestsRef.current, msg.request]
      }
      setRequests(requestsRef.current)
    } else if (msg.type === 'request-resolved') {
      const remaining = requestsRef.current.filter((r) => r.id !== msg.requestId)
      requestsRef.current = remaining
      setRequests(remaining)
      // Only show the full SuccessScreen when this was the last request.
      // When more requests remain, go idle so the next card shows immediately
      // instead of closing the station and sending the user to the dashboard.
      setPhase((p) => {
        if (p.requestId !== msg.requestId) return p
        if (p.phase === 'done' && remaining.length === 0) {
          return { phase: 'success', requestId: msg.requestId, kind: p.kind }
        }
        return { phase: 'idle' }
      })
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
      <FluidBackground />

      <PageHeader
        eyebrow="Signing Station"
        title="Pending Signatures"
        backTo="#/dashboard"
      />

      <main className={styles.main}>
        {!isConnected ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, padding: '40px 0' }}>
            <NotConnectedCard eyebrow="SIGNING STATION" title="Connect to approve requests." sub="Connect the owner wallet to review and sign pending agent requests." />
          </div>
        ) : phase.phase === 'success' ? (
          <SuccessScreen kind={phase.kind} onDone={() => { setPhase({ phase: 'idle' }); window.location.hash = '#/dashboard' }} />
        ) : hasDraft ? (
          <MandateSigningFlow draft={draft} embedded />
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
        context="station"
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
  const { isConnected, chainId: walletChain } = useAccount()
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

      <div className={styles.details}>
        {request.details.map((d) => <DetailRow key={d.label} label={d.label} value={d.value} />)}
        <DetailRow label="Network" value={chainName(chains, request.chainId)} mono={false} />
        {request.type === 'transaction' && request.to && <DetailRow label="Contract" value={request.to} />}
        {request.type === 'transaction' && !request.to && <DetailRow label="Action" value="Deploys a new contract" mono={false} />}
      </div>

      {done && <div className={`${styles.banner} ${styles.ok}`}>Submitted — {shortHex(phase.txHash)}</div>}
      {hasError && <div className={`${styles.banner} ${styles.danger}`}>{phase.message}</div>}
      {wrongChain && (
        <div className={`${styles.banner} ${styles.warn}`}>
          Wallet is on {chainName(chains, walletChain)}.{' '}
          <button type="button" className={styles.linkBtn} onClick={() => switchChain({ chainId: request.chainId })}>
            Switch to {chainName(chains, request.chainId)}
          </button>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.reject} disabled={submitting || done || otherActive} onClick={() => onReject(request.id)}>Reject</button>
        {!isConnected ? (
          <span className={styles.connectHint}>Connect wallet to sign</span>
        ) : (
          <button type="button" className={styles.primary} disabled={submitting || done || wrongChain || otherActive} onClick={() => onSign(request)}>
            {otherActive ? 'Waiting…' : submitting ? (request.type === 'typed-data' ? 'Signing…' : 'Submitting…') : done ? 'Signed ✓' : request.type === 'typed-data' ? 'Sign Message' : 'Sign & Submit'}
          </button>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono = true }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      {mono ? <code className={styles.detailValue}>{value}</code> : <span className={styles.detailValue}>{value}</span>}
    </div>
  )
}

function SuccessScreen({ kind, onDone }) {
  const isPermission = kind === 'register-permission' || kind === 'attach-mandate'
  return (
    <GlassCard className={styles.emptyCard}>
      <div className={styles.emptyCardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.emptyCardHeader}>
        <span className={styles.emptyKicker}>SIGNED</span>
        <h1 className={`${shared.displayHeadline} ${styles.emptyHeadline}`} style={{ color: 'var(--accent-green, #4ade80)' }}>
          ✓ {isPermission ? 'Permission registered.' : 'Done.'}
        </h1>
        <p className={`${shared.italicMannerism} ${styles.emptyTagline}`}>
          {isPermission
            ? 'Your agent is authorized to dispatch within this permission.'
            : 'The request was signed and submitted.'}
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
        <span className={styles.emptyKicker}>SIGNING STATION</span>
        <h1 className={`${shared.displayHeadline} ${styles.emptyHeadline}`}>
          No signatures pending.
        </h1>
        <p className={`${shared.italicMannerism} ${styles.emptyTagline}`}>
          {daemonConnected
            ? 'The agent will push approval requests here as it works.'
            : <>Run <code style={{ fontSize: 13, opacity: 0.8 }}>sailor station start</code> to connect — this page will reconnect automatically.</>}
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
