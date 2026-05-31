import { useCallback, useEffect, useState } from 'react'

const POLL_MS = 5000

/**
 * Polls a JSON endpoint on an interval. Never throws: on network failure or a
 * non-OK response it falls back to `fallback` and surfaces the error so
 * callers can decide whether to show mock data instead.
 */
function usePolledJson(url, fallback, intervalMs = POLL_MS, trigger = 0) {
  const [data, setData] = useState(fallback)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        const res = await fetch(url)
        if (!res.ok) {
          if (alive) {
            setData(fallback)
            setError(null)
          }
          return
        }
        const json = await res.json()
        if (alive) {
          setData(json)
          setError(null)
        }
      } catch (err) {
        if (alive) setError(err)
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    const timer = setInterval(load, intervalMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, intervalMs, trigger])

  return { data, loading, error }
}

/** The deployed SMA from `.sail/account.json`, or null if not yet deployed. */
export function useSailorAccount(trigger) {
  const { data, loading, error } = usePolledJson('/api/account', null, POLL_MS, trigger)
  return { account: data, loading, error }
}

export function useSailorAccounts(trigger) {
  const { data, loading, error } = usePolledJson('/api/accounts', [], POLL_MS, trigger)
  return { accounts: data ?? [], loading, error }
}

export async function switchSailorAccount(safe) {
  const res = await fetch('/api/account/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ safe }),
  })
  if (!res.ok) throw new Error(`Switch failed (${res.status})`)
  return res.json()
}

export async function renameSailorAccount(safe, name) {
  const res = await fetch('/api/account/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ safe, name }),
  })
  if (!res.ok) throw new Error(`Rename failed (${res.status})`)
  return res.json()
}

/**
 * The consolidated, local-first overview from `/api/overview`: the SMA
 * (confirmed on-chain), its currently-attached mandates, and the delegated
 * signer + owner with their native ETH balances and top-up status. Polls every
 * 15s — balances move slowly and each poll is several RPC reads. `null` until
 * an SMA exists locally.
 */
export function useSailorOverview(trigger) {
  const { data, loading, error } = usePolledJson('/api/overview', null, 15000, trigger)
  return { overview: data, loading, error }
}

/** Decision-journal events from `.sail/activity.jsonl`, or []. */
export function useSailorActivity(trigger) {
  const { data, loading, error } = usePolledJson('/api/activity', [], POLL_MS, trigger)
  return { events: Array.isArray(data) ? data : [], loading, error }
}

/** The signed mandate from `.sail/mandate.json`, or null. Polls every 10s. */
export function useSailorMandate(trigger) {
  const { data, loading, error } = usePolledJson('/api/mandate', null, 10000, trigger)
  return { mandate: data, loading, error }
}

/** Whether `sailor run` is currently running. Polls every 5s. */
export function useSailorAgentStatus() {
  const { data, loading } = usePolledJson('/api/agent-status', { running: false }, 5000)
  return { running: data?.running === true, pid: data?.pid ?? null, loading }
}

/** Pending signing requests from the station daemon, or []. Polls every 3s. */
export function useSailorPending() {
  const { data, loading } = usePolledJson('/api/station/pending', [], 3000)
  return { pending: Array.isArray(data) ? data : [], loading }
}

const SAFE_TX_SERVICE = {
  1:      'https://safe-transaction-mainnet.safe.global',
  10:     'https://safe-transaction-optimism.safe.global',
  56:     'https://safe-transaction-bsc.safe.global',
  100:    'https://safe-transaction-gnosis-chain.safe.global',
  137:    'https://safe-transaction-polygon.safe.global',
  8453:   'https://safe-transaction-base.safe.global',
  42161:  'https://safe-transaction-arbitrum.safe.global',
  43114:  'https://safe-transaction-avalanche.safe.global',
  59144:  'https://safe-transaction-linea.safe.global',
  84532:  'https://safe-transaction-base-sepolia.safe.global',
  421614: 'https://safe-transaction-arbitrum-sepolia.safe.global',
  11155111: 'https://safe-transaction-sepolia.safe.global',
}

/**
 * Scans the Safe Transaction Service for every Safe owned by `ownerAddress`
 * across all supported chains. Returns the full list — `[{ safe, chainId }]` —
 * so the import UI can let the user pick which one to adopt as their SMA,
 * rather than silently auto-importing the first match.
 *
 * Only fires when `enabled` is true (e.g. when the user opens the import flow),
 * so we never scan the network just to render the dashboard. Results stream in
 * per chain as each request resolves; `done` flips true once every chain has
 * been queried so the caller can distinguish "still scanning" from "none found".
 */
export function useDiscoverSafes(ownerAddress, enabled) {
  const [safes, setSafes] = useState([])
  const [scanning, setScanning] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!enabled || !ownerAddress) {
      setSafes([])
      setScanning(false)
      setDone(false)
      return
    }
    let alive = true
    setScanning(true)
    setDone(false)
    setSafes([])

    async function scan() {
      const found = []
      for (const [chainIdStr, base] of Object.entries(SAFE_TX_SERVICE)) {
        try {
          const res = await fetch(`${base}/api/v1/owners/${ownerAddress}/safes/`)
          if (!res.ok) continue
          const json = await res.json()
          for (const safe of json?.safes ?? []) {
            found.push({ safe, chainId: Number(chainIdStr) })
          }
          if (alive && found.length > 0) setSafes([...found])
        } catch { /* network error on this chain, try next */ }
      }
      if (alive) {
        setScanning(false)
        setDone(true)
      }
    }

    scan()
    return () => { alive = false }
  }, [ownerAddress, enabled])

  return { safes, scanning, done }
}

/** A mandate draft awaiting signature (from `sailor mandate prepare`), or null. Polls every 5s. */
export function useSailorMandateDraft() {
  const { data, loading, error } = usePolledJson('/api/mandate-draft', null, 5000)
  return { draft: data, loading, error }
}

/** Wizard progress from `.sail/.wizard-state.json`, with an updater. */
export function useWizardState() {
  const { data, loading } = usePolledJson('/api/wizard-state', null)

  const update = useCallback(
    async (patch) => {
      const next = { ...(data ?? {}), ...patch }
      try {
        await fetch('/api/wizard-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        })
        return next
      } catch {
        return null
      }
    },
    [data],
  )

  return { state: data, update, loading }
}
