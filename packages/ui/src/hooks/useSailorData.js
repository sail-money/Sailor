import { useEffect, useState } from 'react'

const POLL_MS = 5000

/**
 * Polls a JSON endpoint on an interval. Never throws: on network failure or a
 * non-OK response it falls back to `fallback` and surfaces the error so
 * callers can decide whether to show mock data instead.
 */
function usePolledJson(url, fallback, intervalMs = POLL_MS, trigger = 0, opts = {}) {
  const { fastWhile, fastMs = 1500 } = opts
  const [data, setData] = useState(fallback)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    let timer

    async function load() {
      let latest
      try {
        const res = await fetch(url)
        if (!res.ok) {
          if (alive) {
            setData(fallback)
            setError(null)
          }
        } else {
          const json = await res.json()
          latest = json
          if (alive) {
            setData(json)
            setError(null)
          }
        }
      } catch (err) {
        if (alive) setError(err)
      } finally {
        if (alive) setLoading(false)
      }
      if (!alive) return
      // Self-scheduling: poll fast while `fastWhile` holds (e.g. a cold-load
      // skeleton awaiting on-chain hydration), then back off to intervalMs.
      const delay = fastWhile && latest !== undefined && fastWhile(latest) ? fastMs : intervalMs
      timer = setTimeout(load, delay)
    }

    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, intervalMs, fastMs, trigger])

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
  const { data, loading, error } = usePolledJson('/api/overview', null, 15000, trigger, {
    // Cold load returns a disk-only skeleton (onchain:false) while the on-chain
    // refresh runs in the background. Poll fast until it hydrates so the
    // "Reading…" state clears within ~1.5s instead of waiting for the 15s tick.
    fastWhile: (d) => d != null && d.rpcConfigured === true && d.onchain !== true,
    fastMs: 1500,
  })
  return { overview: data, loading, error }
}

/** Decision-journal events from `.sail/activity.jsonl`, or []. */
export function useSailorActivity(trigger) {
  const { data, loading, error } = usePolledJson('/api/activity', [], POLL_MS, trigger)
  return { events: Array.isArray(data) ? data : [], loading, error }
}

/** The signed mandate from `.sail/mandate.json`, or null. Polls every 10s. */
export function useSailorMandate(trigger) {
  const { data, loading, error } = usePolledJson('/api/mandate', [], 10000, trigger)
  return { mandates: Array.isArray(data) ? data : (data ? [data] : []), loading, error }
}

/** Whether `sailor run` is currently running. Polls every 5s. */
export function useSailorAgentStatus() {
  const { data, loading } = usePolledJson('/api/agent-status', { running: false }, 5000)
  return {
    running: data?.running === true,
    pid: data?.pid ?? null,
    pids: Array.isArray(data?.pids) ? data.pids : [],
    source: data?.source ?? null,
    lastActivityMs: data?.lastActivityMs ?? null,
    githubActions: data?.githubActions ?? null,
    loading,
  }
}

/** Pending signing requests from the signing daemon, or []. Polls every 3s. */
export function useSailorPending() {
  const { data, loading } = usePolledJson('/api/station/pending', [], 3000)
  return { pending: Array.isArray(data) ? data : [], loading }
}

/** A mandate draft awaiting signature (from `sailor mandate prepare`), or null. Polls every 5s. */
export function useSailorMandateDraft() {
  const { data, loading, error } = usePolledJson('/api/mandate-draft', null, 5000)
  return { draft: data, loading, error }
}

/** Latest positions snapshot from state/positions-<chainId>.json. Polls every 15s. */
export function useSailorPositions(trigger) {
  const { data, loading, error } = usePolledJson('/api/positions', { positions: [], updatedAt: null }, 15000, trigger)
  return { positions: data?.positions ?? [], updatedAt: data?.updatedAt ?? null, loading, error }
}

/** Per-chain overviews for the active multi-chain SMA. Returns an array, one entry per deployed chain. */
export function useSailorOverviews(trigger) {
  const { data, loading, error } = usePolledJson('/api/overviews', [], 15000, trigger, {
    // Poll fast while any chain is still a disk-only skeleton (see useSailorOverview).
    fastWhile: (d) => Array.isArray(d) && d.some((o) => o?.rpcConfigured === true && o?.onchain !== true),
    fastMs: 1500,
  })
  return { overviews: Array.isArray(data) ? data : [], loading, error }
}
