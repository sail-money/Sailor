import { useCallback, useEffect, useState } from 'react'

const POLL_MS = 5000

/**
 * Polls a JSON endpoint on an interval. Never throws: on network failure or a
 * non-OK response it falls back to `fallback` and surfaces the error so
 * callers can decide whether to show mock data instead.
 */
function usePolledJson(url, fallback, intervalMs = POLL_MS) {
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
  }, [url, intervalMs])

  return { data, loading, error }
}

/** The deployed SMA from `.sail/account.json`, or null if not yet deployed. */
export function useSailorAccount() {
  const { data, loading, error } = usePolledJson('/api/account', null)
  return { account: data, loading, error }
}

/** Decision-journal events from `.sail/activity.jsonl`, or []. */
export function useSailorActivity() {
  const { data, loading, error } = usePolledJson('/api/activity', [])
  return { events: Array.isArray(data) ? data : [], loading, error }
}

/** The signed mandate from `.sail/mandate.json`, or null. Polls every 10s. */
export function useSailorMandate() {
  const { data, loading, error } = usePolledJson('/api/mandate', null, 10000)
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
