import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSandbox } from '../../sandboxContext'
import { ChainGlyph } from '../shared'
import { CHAIN_LABELS } from '../shared/SandboxBanner'
import styles from './SmaForkControls.module.css'

/**
 * Per-SMA fork controls for the sandbox dashboard's Overview. Each chain this
 * SMA is live on runs its own local anvil fork; this row shows which of those
 * forks are actually running and lets the user turn them on/off — the "adjust
 * the number of active forks for this SMA" surface, bounded by the sandbox's
 * chain cap (changed from Sandbox settings).
 *
 * Toggling ON a stopped fork hits the same per-chain restart the banner uses;
 * toggling OFF hits stop. Starting is blocked (and the server refuses with 409)
 * once the live set is at the cap — the readout says why. Only rendered in
 * sandbox mode; a no-op in the live dashboard where there are no forks.
 */
export default function SmaForkControls({ chains }) {
  const { isSandbox, maxChains } = useSandbox()
  const [forks, setForks] = useState({})
  const [busyChainId, setBusyChainId] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return fetch('/api/sandbox/forks', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { forks: {} }))
      .then((d) => setForks(d?.forks ?? {}))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isSandbox) return undefined
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [isSandbox, load])

  // The cap is global across every fork this sandbox runs, not just this SMA's
  // chains — so count all ready forks, not only the ones shown here.
  const activeCount = useMemo(
    () => Object.values(forks).filter((f) => f.status === 'ready').length,
    [forks],
  )
  const atCap = activeCount >= maxChains

  if (!isSandbox || !chains?.length) return null

  async function toggle(chainId, running) {
    setBusyChainId(chainId)
    setError('')
    try {
      const action = running ? 'stop' : 'restart'
      const res = await fetch(`/api/sandbox/forks/${chainId}/${action}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Could not ${running ? 'stop' : 'start'} this fork.`)
      await load()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusyChainId(null)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>Sandbox forks</span>
        <span className={styles.count} data-at-cap={atCap ? 'true' : undefined}>
          {activeCount} of {maxChains} running
        </span>
      </div>
      <ul className={styles.list}>
        {chains.map((chain) => {
          const fork = forks[String(chain.id)]
          const running = fork?.status === 'ready'
          const spawning = fork?.status === 'spawning'
          const startBlocked = !running && atCap
          const busy = busyChainId === chain.id
          const label = chain.name || CHAIN_LABELS[fork?.chain] || `Chain ${chain.id}`
          return (
            <li key={chain.id} className={styles.item}>
              <span className={styles.chainName}>
                <ChainGlyph chainId={chain.id} size={15} />
                {label}
              </span>
              <span className={styles.status} data-status={fork?.status ?? 'stopped'}>
                <span className={styles.dot} data-status={fork?.status ?? 'stopped'} aria-hidden />
                {running ? 'Running' : spawning ? 'Starting…' : fork?.status === 'failed' ? 'Failed' : 'Stopped'}
              </span>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => toggle(chain.id, running)}
                disabled={busy || spawning || (startBlocked)}
                title={startBlocked ? `At the ${maxChains}-fork limit — stop another or raise the limit in Sandbox settings` : undefined}
              >
                {busy ? '…' : running ? 'Stop' : 'Start'}
              </button>
            </li>
          )
        })}
      </ul>
      {atCap && (
        <p className={styles.hint}>
          At the {maxChains}-fork limit. Stop one to start another, or raise the limit in Sandbox settings (⚙, top bar).
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
