import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useSendTransaction, useSignTypedData, useSwitchChain } from 'wagmi'
import { FluidBackground, Sai } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './SigningStation.module.css'

function goToDashboard() {
  window.location.hash = '#/dashboard'
}

/**
 * Signing Station — the browser side of the CLI ↔ UI signing handoff.
 *
 * Discovers the local signing daemon (started by `sailor station start`, or an
 * ephemeral per-command server) by port-probing 3141–3150 for /config, then
 * connects over WebSocket. The agent (CLI) pushes signing requests; the owner
 * approves them here with their wallet:
 *   - transaction requests (create-sma, deploy-mandate, arbitrary-tx) are submitted via the
 *     wallet. Use "arbitrary-tx" for any custom calldata the agent needs the owner to sign
 *     (e.g. admin calls on custom permissions).
 *   - typed-data requests (register-permission) are signed off-chain; the agent
 *     submits the resulting transaction itself.
 */

const SIGNING_SERVER_BASE_PORT = 3141
const SIGNING_SERVER_PORT_RANGE = 10 // scans 3141–3150
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
    const url = `http://localhost:${SERVER_OVERRIDE}`
    try {
      const res = await fetch(`${url}/config`, { signal: AbortSignal.timeout(1_500) })
      if (res.ok) return res.json()
    } catch {
      /* fall through */
    }
    return null
  }
  for (
    let port = SIGNING_SERVER_BASE_PORT;
    port < SIGNING_SERVER_BASE_PORT + SIGNING_SERVER_PORT_RANGE;
    port++
  ) {
    try {
      const res = await fetch(`http://localhost:${port}/config`, {
        signal: AbortSignal.timeout(500),
      })
      if (res.ok) return res.json()
    } catch {
      /* port not responding, try next */
    }
  }
  return null
}

const CHAIN_NAMES = {
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum One',
  84532: 'Base Sepolia',
  421614: 'Arbitrum Sepolia',
  11155111: 'Sepolia',
}
const chainName = (id) => CHAIN_NAMES[id] ?? `Chain ${id}`
const shortHex = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`

const KIND_LABELS = {
  'create-sma': 'Create Safe (SMA)',
  'deploy-mandate': 'Deploy Mandate',
  'register-permission': 'Register Permission',
  'attach-mandate': 'Attach Mandate',
  'set-delegate': 'Set Agent as Manager',
  'arbitrary-tx': 'Arbitrary Transaction',
}

export default function SigningStation() {
  const [status, setStatus] = useState('checking') // checking | connected | disconnected
  const [requests, setRequests] = useState([])
  const [phase, setPhase] = useState({ phase: 'idle' })

  const wsRef = useRef(null)
  const sendRef = useRef(null)

  const connectWs = useCallback((wsUrl) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    sendRef.current = (msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }

    ws.onopen = () => setStatus('connected')
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'pending') {
          setRequests(msg.requests)
        } else if (msg.type === 'request') {
          setRequests((prev) =>
            prev.find((r) => r.id === msg.request.id) ? prev : [...prev, msg.request],
          )
        } else if (msg.type === 'request-resolved') {
          setRequests((prev) => prev.filter((r) => r.id !== msg.requestId))
          setPhase((p) => (p.requestId === msg.requestId ? { phase: 'idle' } : p))
        }
      } catch {
        /* ignore malformed */
      }
    }
    ws.onclose = () => {
      setStatus('disconnected')
      wsRef.current = null
    }
    ws.onerror = () => {
      setStatus('disconnected')
      wsRef.current = null
    }
  }, [])

  // Poll for the signing server (scans ports 3141–3150).
  useEffect(() => {
    const poll = async () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return
      const cfg = await discoverSigningServer()
      if (cfg) connectWs(cfg.wsUrl)
      else setStatus((s) => (s === 'checking' ? 'disconnected' : s))
    }
    poll()
    const t = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [connectWs])

  // Notify the server when the wallet connects / disconnects.
  const { address: walletAddress, isConnected } = useAccount()
  useEffect(() => {
    if (status !== 'connected') return
    if (isConnected && walletAddress) {
      sendRef.current?.({ type: 'wallet-connected', address: walletAddress })
    } else {
      sendRef.current?.({ type: 'wallet-disconnected' })
    }
  }, [status, walletAddress, isConnected])

  return (
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <FluidBackground />

      {/* Header mirrors the dashboard: brand mascot on the left (also the
          home link), a connection-status chip, and the wallet button on the
          right. A dedicated "Back to dashboard" button makes the round trip
          obvious now that the station is a first-class page. */}
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <button
            type="button"
            className={styles.brand}
            onClick={goToDashboard}
            aria-label="Back to dashboard"
          >
            <Sai size={40} animate />
          </button>
          <button type="button" className={styles.backBtn} onClick={goToDashboard}>
            <ArrowLeftIcon />
            <span>Dashboard</span>
          </button>
        </div>

        <div className={styles.topbarRight}>
          <StatusChip status={status} count={requests.length} />
          <ConnectButton showBalance={false} />
        </div>
      </header>

      <div className={styles.titleBlock}>
        <p className={styles.eyebrow}>Signing Station</p>
        <h1 className={`${shared.displayHeadline} ${styles.title}`}>Pending signatures</h1>
        <p className={styles.subtitle}>
          Review and approve what your agent is asking you to sign. Nothing is
          signed without you.
        </p>
      </div>

      <div className={styles.stack}>
        {status !== 'connected' ? (
          <WaitingState status={status} />
        ) : requests.length === 0 ? (
          <EmptyQueue />
        ) : (
          <Orchestrator
            requests={requests}
            phase={phase}
            setPhase={setPhase}
            sendRef={sendRef}
          />
        )}
      </div>
    </div>
  )
}

/** Connection-status chip — mirrors the dashboard's pill vocabulary. */
function StatusChip({ status, count }) {
  const label =
    status === 'connected'
      ? count > 0
        ? `${count} pending`
        : 'Agent connected'
      : status === 'checking'
        ? 'Looking for agent…'
        : 'Agent offline'
  const cls =
    status === 'connected'
      ? count > 0
        ? styles.chipLive
        : styles.chipOk
      : styles.chipIdle
  return (
    <span className={`${styles.statusChip} ${cls}`}>
      <span className={styles.statusChipDot} aria-hidden />
      {label}
    </span>
  )
}

function Orchestrator({ requests, phase, setPhase, sendRef }) {
  const { sendTransactionAsync } = useSendTransaction()
  const { signTypedDataAsync } = useSignTypedData()

  const handleSign = useCallback(
    async (req) => {
      setPhase({ phase: 'submitting', requestId: req.id })
      try {
        if (req.type === 'transaction') {
          // No `to` → contract-creation tx (deploy-mandate): the wallet sends
          // it with no recipient and treats `data` as the creation bytecode.
          const hash = await sendTransactionAsync({
            to: req.to ? req.to : undefined,
            data: req.data,
            value: req.value ? BigInt(req.value) : 0n,
            chainId: req.chainId,
          })
          setPhase({ phase: 'done', requestId: req.id, txHash: hash })
          sendRef.current?.({ type: 'signed', requestId: req.id, txHash: hash })
        } else {
          // typed-data: EIP-712 off-chain signature. Decimal-string fields
          // (stringified bigints) are parsed back to bigint before signing.
          const message = Object.fromEntries(
            Object.entries(req.typedData.message).map(([k, v]) => [
              k,
              typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v,
            ]),
          )
          const sig = await signTypedDataAsync({
            domain: req.typedData.domain,
            types: req.typedData.types,
            primaryType: req.typedData.primaryType,
            message,
          })
          setPhase({ phase: 'done', requestId: req.id, txHash: sig })
          sendRef.current?.({ type: 'signature', requestId: req.id, signature: sig })
        }
      } catch (err) {
        const messageText = err instanceof Error ? err.message : String(err)
        setPhase({ phase: 'error', requestId: req.id, message: messageText })
      }
    },
    [sendTransactionAsync, signTypedDataAsync, setPhase, sendRef],
  )

  const handleReject = useCallback(
    (id, reason) => {
      setPhase({ phase: 'idle' })
      sendRef.current?.({ type: 'rejected', requestId: id, reason })
    },
    [setPhase, sendRef],
  )

  return (
    <>
      {requests.map((req) => (
        <OperationCard
          key={req.id}
          request={req}
          phase={phase}
          onSign={handleSign}
          onReject={handleReject}
        />
      ))}
    </>
  )
}

function OperationCard({ request, phase, onSign, onReject }) {
  const { isConnected, chainId: walletChain } = useAccount()
  const { switchChain } = useSwitchChain()

  const mine = phase.requestId === request.id
  const submitting = mine && phase.phase === 'submitting'
  const done = mine && phase.phase === 'done'
  const hasError = mine && phase.phase === 'error'
  const wrongChain =
    isConnected && walletChain !== undefined && walletChain !== request.chainId

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <p className={styles.eyebrow}>{KIND_LABELS[request.kind] ?? request.kind}</p>
        <h2 className={styles.cardTitle}>{request.title}</h2>
        <p className={styles.cardDesc}>{request.description}</p>
      </div>

      <div className={styles.details}>
        {(request.details ?? []).map((d) => (
          <DetailRow key={d.label} label={d.label} value={d.value} />
        ))}
        <DetailRow label="Network" value={chainName(request.chainId)} mono={false} />
        {request.type === 'transaction' && request.to && (
          <DetailRow
            label={request.data && request.data !== '0x' ? 'Contract' : 'To'}
            value={request.to}
          />
        )}
        {request.type === 'transaction' && !request.to && (
          <DetailRow label="Action" value="Deploys a new contract" mono={false} />
        )}
      </div>

      {/* Arbitrary calldata: show the raw call so the owner can audit it before signing. */}
      {request.kind === 'arbitrary-tx' && request.type === 'transaction' && (
        <div className={styles.rawCall}>
          <div className={styles.rawCallHeader}>⚠️ Arbitrary Call — Review Carefully</div>
          <div className={styles.rawCallBody}>
            {request.to && (
              <div><strong>To:</strong> <code>{request.to}</code></div>
            )}
            <div><strong>Value:</strong> {request.value ?? '0'} wei</div>
            <div><strong>Data:</strong></div>
            <pre className={styles.calldata}>{request.data}</pre>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={() => navigator.clipboard?.writeText(request.data || '')}
            >
              Copy Calldata
            </button>
          </div>
        </div>
      )}

      {done && <div className={`${styles.banner} ${styles.ok}`}>Submitted — {shortHex(phase.txHash)}</div>}
      {hasError && <div className={`${styles.banner} ${styles.danger}`}>{phase.message}</div>}
      {wrongChain && (
        <div className={`${styles.banner} ${styles.warn}`}>
          Wallet is on {chainName(walletChain)}.{' '}
          <button type="button" className={styles.linkBtn} onClick={() => switchChain({ chainId: request.chainId })}>
            Switch to {chainName(request.chainId)}
          </button>{' '}
          to proceed.
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.reject}
          disabled={submitting || done}
          onClick={() => onReject(request.id)}
        >
          Reject
        </button>
        {!isConnected ? (
          <ConnectButton />
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={submitting || done || wrongChain}
            onClick={() => onSign(request)}
          >
            {submitting
              ? request.type === 'typed-data'
                ? 'Signing…'
                : 'Submitting…'
              : done
                ? 'Signed'
                : request.type === 'typed-data'
                  ? 'Sign Message'
                  : 'Sign & Submit'}
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
      {mono ? <code className={styles.detailValue}>{value}</code> : <span>{value}</span>}
    </div>
  )
}

function WaitingState({ status }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMascot} aria-hidden>
        <Sai size={56} animate={status === 'checking'} />
      </span>
      {status === 'checking' ? (
        <>
          <h2 className={styles.emptyTitle}>Looking for agent…</h2>
          <p className={styles.emptyBody}>
            Run <code>sailor onboard</code> or any command requiring your approval.
          </p>
        </>
      ) : (
        <>
          <h2 className={styles.emptyTitle}>Agent not running</h2>
          <p className={styles.emptyBody}>
            Start a <code>sailor</code> command in your terminal — this page reconnects
            automatically.
          </p>
        </>
      )}
      <button type="button" className={styles.ghostBtn} onClick={goToDashboard}>
        <ArrowLeftIcon />
        Back to dashboard
      </button>
    </div>
  )
}

function EmptyQueue() {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMascot} aria-hidden>
        <Sai size={56} animate />
      </span>
      <h2 className={styles.emptyTitle}>Agent is connected</h2>
      <p className={styles.emptyBody}>
        No approvals pending. The agent will push requests here as it builds your strategy.
      </p>
      <button type="button" className={styles.ghostBtn} onClick={goToDashboard}>
        <ArrowLeftIcon />
        Back to dashboard
      </button>
    </div>
  )
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 7H3M6 4 3 7l3 3" />
    </svg>
  )
}
