import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useSendTransaction, useSignTypedData, useSwitchChain } from 'wagmi'
import styles from './SigningStation.module.css'

/**
 * Signing Station — the browser side of the CLI ↔ UI signing handoff.
 *
 * Discovers the local signing daemon (started by `sailor station start`, or an
 * ephemeral per-command server) by port-probing 3141–3150 for /config, then
 * connects over WebSocket. The agent (CLI) pushes signing requests; the owner
 * approves them here with their wallet:
 *   - transaction requests (create-sma, deploy-mandate) are submitted via the
 *     wallet. A request with no `to` is a contract-creation tx (deploy-mandate).
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
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Signing Station</p>
          <h1 className={styles.title}>Pending Signatures</h1>
        </div>
        <ConnectButton />
      </header>

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
        {request.details.map((d) => (
          <DetailRow key={d.label} label={d.label} value={d.value} />
        ))}
        <DetailRow label="Network" value={chainName(request.chainId)} mono={false} />
        {request.type === 'transaction' && request.to && (
          <DetailRow label="Contract" value={request.to} />
        )}
        {request.type === 'transaction' && !request.to && (
          <DetailRow label="Action" value="Deploys a new contract" mono={false} />
        )}
      </div>

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
      {status === 'checking' ? (
        <>
          <h2>Looking for agent…</h2>
          <p>
            Run <code>sailor onboard</code> or any command requiring your approval.
          </p>
        </>
      ) : (
        <>
          <h2>Agent not running</h2>
          <p>
            Start a <code>sailor</code> command in your terminal — this page reconnects
            automatically.
          </p>
        </>
      )}
    </div>
  )
}

function EmptyQueue() {
  return (
    <div className={styles.empty}>
      <h2>Agent is connected</h2>
      <p>No approvals pending. The agent will push requests here as it builds your strategy.</p>
    </div>
  )
}
