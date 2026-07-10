import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Shared WebSocket connection to the signing daemon.
 *
 * Both the signing page (which renders pending requests) and the onboarding
 * connect screen (which tells the CLI the owner's wallet connected) need a live,
 * authenticated socket to the daemon. The daemon gates that socket behind the
 * per-startup requestSecret, and only hands the secret to same-origin pages — so
 * the connection has to be made one of two ways depending on who served the page:
 *
 *   • Daemon-served (ports 3141–3150): /config is same-origin and embeds the
 *     secret, so connect directly to the daemon.
 *   • sailor-ui-served (port 3333): the daemon withholds the secret from a
 *     cross-origin /config, so route through the same-origin /api/station/ws
 *     proxy (server.js — the server's internal endpoint path, unrenamed), which
 *     holds the secret server-side. The proxy closes the socket if no daemon is
 *     running.
 *
 * This hook centralises that logic so the signing page and the connect screen
 * stay in lockstep — and so neither hand-rolls a raw `ws://host` socket that the
 * hardened daemon would reject with 1008.
 */

const POLL_INTERVAL_MS = 3_000

/** Optional `?server=<port>` override for pointing at a specific daemon (debug). */
const SERVER_OVERRIDE = (() => {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('server')
  if (!raw) return null
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  return port
})()

/** Same-origin WebSocket URL for the sailor-ui signing proxy. */
function proxyWsUrl() {
  if (typeof window === 'undefined') return null
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}/api/station/ws`
}

/**
 * Resolve a WebSocket URL for the signing daemon, preferring a direct
 * same-origin connection (with the embedded secret) and falling back to the
 * same-origin proxy. Returns `{ wsUrl }` or null.
 */
export async function discoverSigningServer() {
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

  // Daemon-served? A same-origin /config that carries the secret means we can
  // talk to the daemon directly without the proxy.
  try {
    const res = await fetch(`${window.location.origin}/config`, { signal: AbortSignal.timeout(500) })
    if (res.ok) {
      const cfg = await res.json()
      if (cfg?.wsUrl?.includes('secret=')) return cfg
    }
  } catch { /* not daemon-served — fall through to the proxy */ }

  // sailor-ui-served: the proxy discovers the daemon and authenticates for us.
  const proxy = proxyWsUrl()
  return proxy ? { wsUrl: proxy } : null
}

/**
 * Maintain an authenticated socket to the signing daemon.
 *
 * @param {object}   [opts]
 * @param {(msg: any) => void} [opts.onMessage] Called with each parsed server message.
 * @param {boolean}  [opts.enabled=true]        When false, no connection is attempted.
 * @returns {{ status: 'checking'|'connected'|'disconnected', send: (msg: any) => void }}
 */
export function useSigningSocket({ onMessage, enabled = true } = {}) {
  const [status, setStatus] = useState('checking')
  const wsRef = useRef(null)
  const sendRef = useRef(null)
  // Keep the latest onMessage without forcing the socket to reconnect when the
  // caller passes a new closure each render.
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
