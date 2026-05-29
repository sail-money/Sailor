import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useChains, useDisconnect, useSendTransaction, useSignTypedData, useSwitchChain } from 'wagmi'
import { FluidBackground, GlassCard, Sai, SailButton } from '../shared'
import PageHeader from '../shared/PageHeader'
import ChainIcon from '../shared/ChainIcon'
import ProfileModal from '../dashboard/ProfileModal'
import AIHandoffModal from '../dashboard/AIHandoffModal'
import styles from './SigningStation.module.css'
import shared from '../shared/shared.module.css'
import { useSailorAccount } from '../../hooks/useSailorData'

const SIGNING_SERVER_BASE_PORT = 3141
const SIGNING_SERVER_PORT_RANGE = 10
const POLL_INTERVAL_MS = 3_000

const SERVER_OVERRIDE = (() => {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('server')
  if (!raw) return null
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  return port
})()

async function discoverSigningServer() {
  if (SERVER_OVERRIDE) {
    try {
      const res = await fetch(`http://localhost:${SERVER_OVERRIDE}/config`, { signal: AbortSignal.timeout(1_500) })
      if (res.ok) return res.json()
    } catch { /* fall through */ }
    return null
  }
  for (let port = SIGNING_SERVER_BASE_PORT; port < SIGNING_SERVER_BASE_PORT + SIGNING_SERVER_PORT_RANGE; port++) {
    try {
      const res = await fetch(`http://localhost:${port}/config`, { signal: AbortSignal.timeout(500) })
      if (res.ok) return res.json()
    } catch { /* try next */ }
  }
  return null
}


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
  const [daemonStatus, setDaemonStatus] = useState('checking')
  const [requests, setRequests] = useState([])
  const [phase, setPhase] = useState({ phase: 'idle' })
  const [profileOpen, setProfileOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  const wsRef = useRef(null)
  const sendRef = useRef(null)

  const { address: walletAddress, isConnected } = useAccount()
  const chains = useChains()
  const { disconnect } = useDisconnect()
  const { account: realAccount } = useSailorAccount()

  const connectWs = useCallback((wsUrl) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    sendRef.current = (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)) }
    ws.onopen = () => setDaemonStatus('connected')
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'pending') setRequests(msg.requests)
        else if (msg.type === 'request') setRequests((prev) => prev.find((r) => r.id === msg.request.id) ? prev : [...prev, msg.request])
        else if (msg.type === 'request-resolved') {
          setRequests((prev) => prev.filter((r) => r.id !== msg.requestId))
          setPhase((p) => (p.requestId === msg.requestId ? { phase: 'idle' } : p))
        }
      } catch { /* ignore malformed */ }
    }
    ws.onclose = () => { setDaemonStatus('disconnected'); wsRef.current = null }
    ws.onerror = () => { setDaemonStatus('disconnected'); wsRef.current = null }
  }, [])

  useEffect(() => {
    const poll = async () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return
      const cfg = await discoverSigningServer()
      if (cfg) connectWs(cfg.wsUrl)
      else setDaemonStatus((s) => (s === 'checking' ? 'disconnected' : s))
    }
    poll()
    const t = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [connectWs])

  useEffect(() => {
    if (daemonStatus !== 'connected') return
    if (isConnected && walletAddress) sendRef.current?.({ type: 'wallet-connected', address: walletAddress })
    else sendRef.current?.({ type: 'wallet-disconnected' })
  }, [daemonStatus, walletAddress, isConnected])

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

        {requests.length === 0 ? (
          <EmptyQueue daemonConnected={daemonStatus === 'connected'} onAsk={() => setAiOpen(true)} />
        ) : (
          <Orchestrator requests={requests} chains={chains} phase={phase} setPhase={setPhase} sendRef={sendRef} />
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

function Orchestrator({ requests, chains, phase, setPhase, sendRef }) {
  const { sendTransactionAsync } = useSendTransaction()
  const { signTypedDataAsync } = useSignTypedData()

  const handleSign = useCallback(async (req) => {
    setPhase({ phase: 'submitting', requestId: req.id })
    try {
      if (req.type === 'transaction') {
        const hash = await sendTransactionAsync({
          to: req.to ? req.to : undefined,
          data: req.data,
          value: req.value ? BigInt(req.value) : 0n,
          chainId: req.chainId,
        })
        setPhase({ phase: 'done', requestId: req.id, txHash: hash })
        sendRef.current?.({ type: 'signed', requestId: req.id, txHash: hash })
      } else {
        const message = Object.fromEntries(
          Object.entries(req.typedData.message).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v])
        )
        const sig = await signTypedDataAsync({ domain: req.typedData.domain, types: req.typedData.types, primaryType: req.typedData.primaryType, message })
        setPhase({ phase: 'done', requestId: req.id, txHash: sig })
        sendRef.current?.({ type: 'signature', requestId: req.id, signature: sig })
      }
    } catch (err) {
      setPhase({ phase: 'error', requestId: req.id, message: err instanceof Error ? err.message : String(err) })
    }
  }, [sendTransactionAsync, signTypedDataAsync, setPhase, sendRef])

  const handleReject = useCallback((id) => {
    setPhase({ phase: 'idle' })
    sendRef.current?.({ type: 'rejected', requestId: id })
  }, [setPhase, sendRef])

  return (
    <>
      {requests.map((req) => (
        <OperationCard key={req.id} request={req} chains={chains} phase={phase} onSign={handleSign} onReject={handleReject} />
      ))}
    </>
  )
}

function OperationCard({ request, chains, phase, onSign, onReject }) {
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
        <button type="button" className={styles.reject} disabled={submitting || done} onClick={() => onReject(request.id)}>Reject</button>
        {!isConnected ? (
          <span className={styles.connectHint}>Connect wallet to sign</span>
        ) : (
          <button type="button" className={styles.primary} disabled={submitting || done || wrongChain} onClick={() => onSign(request)}>
            {submitting ? (request.type === 'typed-data' ? 'Signing…' : 'Submitting…') : done ? 'Signed ✓' : request.type === 'typed-data' ? 'Sign Message' : 'Sign & Submit'}
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
