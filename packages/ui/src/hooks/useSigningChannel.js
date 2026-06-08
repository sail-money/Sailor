import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Signing channel — LIVE WebSocket to the signing daemon.
 *
 * This is the bridge between the agent/CLI and the Owner's wallet. The CLI
 * (`sailor mandate deploy`, onboarding, etc.) pushes signing requests to the
 * daemon; this socket receives them and relays the Owner's signed result back
 * so the CLI can broadcast/continue.
 *
 * Wire protocol (must not drift from @sail/sdk/signing.ts):
 *   server → UI : { type:'pending', requests } | { type:'request', request } | { type:'request-resolved', requestId }
 *   UI → server : { type:'signed', requestId, txHash } | { type:'signature', requestId, signature }
 *               | { type:'rejected', requestId, reason? } | { type:'wallet-connected', address } | { type:'wallet-disconnected' }
 *
 * Connection strategy (the daemon gates its socket behind a per-startup secret
 * and only hands it to same-origin pages):
 *   • Daemon-served (ports 3141–3150): /config is same-origin and embeds the
 *     secret → connect directly to the daemon.
 *   • sailor-ui / dev-served: route through the same-origin /api/station/ws
 *     proxy (server.js holds the secret server-side).
 * Never open a raw ws://host socket — the hardened daemon rejects it (1008).
 */

const POLL_INTERVAL_MS = 3_000

const SERVER_OVERRIDE = (() => {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('server')
  if (!raw) return null
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  return port
})()

function proxyWsUrl() {
  if (typeof window === 'undefined') return null
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}/api/station/ws`
}

async function discoverSigningServer() {
  if (SERVER_OVERRIDE) {
    try {
      const res = await fetch(`http://localhost:${SERVER_OVERRIDE}/config`, { signal: AbortSignal.timeout(1_500) })
      if (res.ok) {
        const cfg = await res.json()
        if (cfg?.wsUrl?.includes('secret=')) return cfg
      }
    } catch { /* fall through to proxy */ }
    const proxy = proxyWsUrl()
    return proxy ? { wsUrl: proxy } : null
  }

  // Daemon-served? same-origin /config carrying the secret → talk directly.
  try {
    const res = await fetch(`${window.location.origin}/config`, { signal: AbortSignal.timeout(500) })
    if (res.ok) {
      const cfg = await res.json()
      if (cfg?.wsUrl?.includes('secret=')) return cfg
    }
  } catch { /* not daemon-served — fall through to the proxy */ }

  const proxy = proxyWsUrl()
  return proxy ? { wsUrl: proxy } : null
}

export function useSigningChannel({ onMessage, enabled = true } = {}) {
  const [status, setStatus] = useState('checking')
  const wsRef = useRef(null)
  const sendRef = useRef(null)
  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage })

  const connectWs = useCallback((wsUrl) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    sendRef.current = (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)) }
    ws.onopen = () => setStatus('connected')
    ws.onmessage = (evt) => {
      try { onMessageRef.current?.(JSON.parse(evt.data)) } catch { /* ignore malformed */ }
    }
    ws.onclose = () => { setStatus('disconnected'); wsRef.current = null }
    ws.onerror = () => { setStatus('disconnected'); wsRef.current = null }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const poll = async () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return
      const cfg = await discoverSigningServer()
      if (cancelled) return
      if (cfg) connectWs(cfg.wsUrl)
      else setStatus((s) => (s === 'checking' ? 'disconnected' : s))
    }
    poll()
    const t = setInterval(poll, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [enabled, connectWs])

  const send = useCallback((msg) => { sendRef.current?.(msg) }, [])
  return { status, send }
}
