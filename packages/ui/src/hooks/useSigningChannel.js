'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { _mockResolvePending } from '../data/sailorClient'

/**
 * Signing channel — mock seam mirroring Sailor's `useSigningSocket`
 * (Sailor/packages/ui/src/hooks/useSigningSocket.js) and the wire protocol in
 * @sail/sdk/signing.ts.
 *
 * This is the bridge between the agent/CLI and the Owner's wallet. The standalone
 * signing-station PAGE is gone; this channel powers the dashboard banner instead.
 *
 * Protocol (must not drift from the SDK):
 *   server → UI : { type:'pending', requests } | { type:'request', request } | { type:'request-resolved', requestId }
 *   UI → server : { type:'signed', requestId, txHash } | { type:'signature', requestId, signature }
 *               | { type:'rejected', requestId, reason? } | { type:'wallet-connected', address } | { type:'wallet-disconnected' }
 *
 * LIVE swap: replace the body with the real `useSigningSocket({ onMessage })`
 * which connects to the same-origin `/api/station/ws` proxy (server.js holds the
 * daemon secret server-side). Keep the SAME return shape ({ status, send }) so
 * PendingModal / banner code is unchanged. NEVER open a raw ws:// — always go
 * through /api/station/ws.
 */

export function useSigningChannel({ onMessage } = {}) {
  // Mock is always "connected"; live status is 'checking'|'connected'|'disconnected'.
  const [status] = useState('connected')
  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage })

  const send = useCallback((msg) => {
    // LIVE: ws.send(JSON.stringify(msg)) over /api/station/ws.
    if (!msg) return
    if (msg.type === 'wallet-connected' || msg.type === 'wallet-disconnected') {
      // The daemon needs the Owner's connected address (sailor owner connect).
      // Mock: nothing to relay; just acknowledge.
      return
    }
    if (msg.type === 'signed' || msg.type === 'signature' || msg.type === 'rejected') {
      // Mock the daemon resolving the request: drop it from the queue and echo
      // the same `request-resolved` the real daemon broadcasts.
      _mockResolvePending(msg.requestId)
      setTimeout(() => onMessageRef.current?.({ type: 'request-resolved', requestId: msg.requestId }), 150)
    }
  }, [])

  return { status, send }
}
