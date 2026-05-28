import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useChains, useDisconnect, useSendTransaction, useSignTypedData, useSwitchChain } from 'wagmi'
import { FluidBackground, Sai } from '../shared'
import ProfileModal from '../dashboard/ProfileModal'
import shared from '../shared/shared.module.css'
import styles from './SigningStation.module.css'
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

const CHAIN_COLORS = {
  1: '#627EEA', 10: '#FF0420', 56: '#F3BA2F', 100: '#04795B',
  137: '#8247E5', 8453: '#0052FF', 42161: '#28A0F0', 43114: '#E84142',
  59144: '#61DFFF', 84532: '#3c6ef5', 421614: '#28A0F0', 11155111: '#627EEA',
}
const CHAIN_LLAMA_NAMES = {
  1: 'ethereum', 10: 'optimism', 56: 'bsc', 100: 'xdai',
  137: 'polygon', 8453: 'base', 42161: 'arbitrum', 43114: 'avalanche',
  59144: 'linea', 84532: 'base', 421614: 'arbitrum',
}
const chainColor = (id) => CHAIN_COLORS[id] ?? '#888'
const chainIconUrl = (id) => CHAIN_LLAMA_NAMES[id]
  ? `https://icons.llamao.fi/icons/chains/rsz_${CHAIN_LLAMA_NAMES[id]}.jpg`
  : null

function ChainIcon({ chainId, size = 20 }) {
  const [err, setErr] = useState(false)
  const url = chainIconUrl(chainId)
  if (url && !err) {
    return (
      <img
        src={url}
        width={size}
        height={size}
        onError={() => setErr(true)}
        style={{ borderRadius: '50%', display: 'block', flexShrink: 0 }}
        alt=""
      />
    )
  }
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: chainColor(chainId), boxShadow: `0 0 6px ${chainColor(chainId)}66`,
    }} />
  )
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
  const [chainOpen, setChainOpen] = useState(false)

  const wsRef = useRef(null)
  const sendRef = useRef(null)

  const { address: walletAddress, isConnected, chainId } = useAccount()
  const chains = useChains()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()
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

  const currentChain = chains.find((c) => c.id === chainId)
  const profileSafes = realAccount
    ? [{ id: 'live-sma', name: 'My SMA', address: realAccount.safe, network: realAccount.chainId === 8453 ? 'base' : realAccount.chainId === 42161 ? 'arbitrum' : 'ethereum', networks: [], agentCount: 0, createdAt: null }]
    : []

  return (
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <FluidBackground />

      <header className={styles.header}>
        {/* Left: brand + title */}
        <div className={styles.headerLeft}>
          <button type="button" className={styles.brand} onClick={() => { window.location.hash = '#/dashboard' }} aria-label="Back to dashboard">
            <Sai size={48} animate />
          </button>
          <div className={styles.headerTitle}>
            <span className={styles.eyebrow}>Signing Station</span>
            <h1 className={styles.title}>Pending Signatures</h1>
          </div>
        </div>

        {/* Right: chain + wallet + back arrow */}
        <div className={styles.topActionsPill}>
          <div className={styles.chainDropdownWrap}>
            <button
              type="button"
              className={styles.notifBtn}
              onClick={() => setChainOpen((v) => !v)}
              aria-label="Switch network"
              title={currentChain?.name ?? 'Select network'}
            >
              {isConnected && chainId
                ? <ChainIcon chainId={chainId} size={20} />
                : <span className={styles.chainIconPlaceholder} />}
            </button>
            <ChainDropdown open={chainOpen} onClose={() => setChainOpen(false)} />
          </div>

          <button
            type="button"
            className={styles.avatarBtn}
            onClick={isConnected ? () => setProfileOpen(true) : openConnectModal}
            aria-label={isConnected && walletAddress ? `Profile (${walletAddress})` : 'Connect wallet'}
            title={isConnected && walletAddress ? walletAddress : undefined}
          >
            <span className={styles.avatarBtnMonogram} aria-hidden>
              {isConnected && walletAddress ? walletAddress.slice(2, 4).toUpperCase() : '—'}
            </span>
            <span className={styles.avatarBtnAddr}>
              {isConnected && walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Not connected'}
            </span>
          </button>

          <button
            type="button"
            className={styles.backBtn}
            onClick={() => { window.location.hash = '#/dashboard' }}
            aria-label="Back to dashboard"
          >
            <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 3L5 7l4 4" />
            </svg>
          </button>
        </div>
      </header>

      <main className={styles.main}>

        {requests.length === 0 ? (
          <EmptyQueue daemonConnected={daemonStatus === 'connected'} />
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

function EmptyQueue({ daemonConnected }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      padding: '72px 32px', gap: 14, borderRadius: 20,
      background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)',
    }}>
      <h2 style={{ fontFamily: 'system-ui, sans-serif', fontSize: 18, fontWeight: 600, color: '#ffffff', margin: 0 }}>
        No signatures pending
      </h2>
      <p style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14, color: 'rgba(255,255,255,0.55)', margin: 0, lineHeight: 1.6 }}>
        {daemonConnected
          ? 'The agent will push approval requests here as it works.'
          : <>Run <code style={{ fontFamily: 'monospace', fontSize: 12, background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4, color: 'rgba(255,255,255,0.8)', whiteSpace: 'nowrap' }}>sailor station start</code> to connect — this page will reconnect automatically.</>}
      </p>
    </div>
  )
}
