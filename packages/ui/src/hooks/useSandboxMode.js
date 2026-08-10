import { useEffect, useState } from 'react'

/**
 * Whether THIS server process is a sandbox instance — fetched once from
 * `/api/mode`, which the server derives from how it was spawned, never from
 * anything the client sends. Cached at module scope so every caller (the
 * wizard, the dashboard banner, the wagmi bootstrap) shares one fetch instead
 * of racing three.
 */
let modePromise = null

function fetchMode() {
  if (!modePromise) {
    modePromise = fetch('/api/mode', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { mode: 'live' }))
      .catch(() => ({ mode: 'live' }))
  }
  return modePromise
}

/** Resolves once, outside React, for the pre-mount wagmi bootstrap in main.jsx. */
export function getSandboxMode() {
  return fetchMode().then((d) => d?.mode === 'sandbox')
}

export function useSandboxMode() {
  const [isSandbox, setIsSandbox] = useState(null) // null while loading
  useEffect(() => {
    let cancelled = false
    fetchMode().then((d) => { if (!cancelled) setIsSandbox(d?.mode === 'sandbox') })
    return () => { cancelled = true }
  }, [])
  return isSandbox
}
