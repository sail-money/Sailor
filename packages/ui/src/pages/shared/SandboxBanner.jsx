import { useEffect, useState } from 'react'
import ChainGlyph from './ChainGlyph'
import GlassCard from './GlassCard'
import SailButton from './SailButton'
import SandboxSettingsModal from './SandboxSettingsModal'
import styles from './SandboxBanner.module.css'

export const CHAIN_LABELS = {
  'base-sepolia': 'Base Sepolia',
  base: 'Base',
  arbitrum: 'Arbitrum',
  unichain: 'Unichain',
  ethereum: 'Ethereum',
  sepolia: 'Sepolia',
}

const STATUS_LABELS = {
  ready: 'Running',
  spawning: 'Starting…',
  failed: 'Failed',
  stopped: 'Stopped',
}

function chainLabel(fork) {
  return CHAIN_LABELS[fork?.chain] ?? fork?.chain ?? 'Unknown chain'
}

/**
 * Persistent top bar for any page served by the sandbox server process — the
 * one and only signal a sandbox page needs, since there is no other way for a
 * user to tell it apart from the live dashboard at a glance. `Exit` asks the
 * server to ensure the live server is running (starting it if needed) and
 * navigates there; it never touches this process's own state.
 *
 * Also the control surface for the forks themselves: each chain gets a
 * status chip (color = ready/spawning/failed/stopped) that opens a small
 * modal with its RPC details and Stop/Restart actions. An adopted fork (one
 * this sandbox found already running rather than started itself) still gets
 * clickable buttons — `adopted` is a point-in-time fact, not a permanent
 * one, so it's the server (which can actually re-check whether that process
 * is still there) that decides whether the action is refused, not this
 * component guessing from a flag that can go stale the moment the thing it
 * was shared with disappears.
 */
export default function SandboxBanner() {
  const [forks, setForks] = useState({})
  const [exiting, setExiting] = useState(false)
  const [selectedChainId, setSelectedChainId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  function load() {
    return fetch('/api/sandbox/forks', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { forks: {} }))
      .then((d) => setForks(d?.forks ?? {}))
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [])

  const entries = Object.entries(forks).sort(([a], [b]) => Number(a) - Number(b))
  const selectedFork = selectedChainId != null ? forks[String(selectedChainId)] : null

  async function handleExit() {
    setExiting(true)
    try {
      const res = await fetch('/api/sandbox/exit', { method: 'POST' })
      const data = await res.json()
      if (data?.port) {
        window.location.href = `http://localhost:${data.port}/#/dashboard`
        return
      }
    } catch { /* fall through to re-enable the button below */ }
    setExiting(false)
  }

  function openFork(chainId) {
    setSelectedChainId(chainId)
    setActionError('')
  }

  async function runAction(action) {
    if (selectedChainId == null) return
    setBusy(true)
    setActionError('')
    try {
      const res = await fetch(`/api/sandbox/forks/${selectedChainId}/${action}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Failed to ${action} this fork.`)
      await load()
    } catch (e) {
      setActionError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={styles.bar} role="status">
        <span className={styles.mark} aria-hidden>⚓</span>
        <span className={styles.copy}>
          Sandbox
          <span className={styles.copyMuted}> · nothing here is real</span>
        </span>

        {entries.length > 0 && (
          <div className={styles.forkChips}>
            {entries.map(([chainId, fork]) => (
              <button
                key={chainId}
                type="button"
                className={styles.forkChip}
                onClick={() => openFork(Number(chainId))}
                title={`${chainLabel(fork)} — ${STATUS_LABELS[fork.status] ?? fork.status ?? 'unknown'}`}
              >
                <ChainGlyph chainId={Number(chainId)} size={13} />
                <span className={styles.forkChipDot} data-status={fork.status ?? 'spawning'} aria-hidden />
                {chainLabel(fork)}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className={styles.settingsButton}
          onClick={() => setSettingsOpen(true)}
          aria-label="Sandbox settings"
          title="Sandbox settings"
        >
          ⚙
        </button>

        <button type="button" className={styles.exit} onClick={handleExit} disabled={exiting}>
          {exiting ? 'Opening live dashboard…' : 'Exit to live dashboard →'}
        </button>
      </div>

      <SandboxSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        forks={forks}
        onReset={load}
      />

      {selectedFork && (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label={`${chainLabel(selectedFork)} fork`}
          onClick={() => !busy && setSelectedChainId(null)}
        >
          <GlassCard className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setSelectedChainId(null)}
              disabled={busy}
              aria-label="Close"
            >
              ×
            </button>

            <div className={styles.modalHead}>
              <ChainGlyph chainId={selectedChainId} size={20} />
              <h3 className={styles.modalTitle}>{chainLabel(selectedFork)}</h3>
              <span className={styles.modalStatus}>
                <span className={styles.forkChipDot} data-status={selectedFork.status ?? 'spawning'} aria-hidden />
                {STATUS_LABELS[selectedFork.status] ?? selectedFork.status ?? 'Unknown'}
              </span>
            </div>

            <dl className={styles.modalMeta}>
              <div><dt>Chain ID</dt><dd>{selectedChainId}</dd></div>
              <div><dt>RPC</dt><dd>{selectedFork.rpcUrl ?? '—'}</dd></div>
              {selectedFork.port != null && <div><dt>Port</dt><dd>{selectedFork.port}</dd></div>}
            </dl>

            {selectedFork.adopted && (
              <p className={styles.modalNote}>
                This fork was already running before this sandbox started. If it's still shared with
                something else, stopping or restarting it here will be refused.
              </p>
            )}
            {selectedFork.error && <p className={styles.modalError}>{selectedFork.error}</p>}
            {actionError && <p className={styles.modalError}>{actionError}</p>}

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancel}
                onClick={() => runAction('stop')}
                disabled={busy || selectedFork.status === 'stopped'}
              >
                Stop
              </button>
              <SailButton
                onClick={() => runAction('restart')}
                disabled={busy}
              >
                {busy ? 'Working…' : selectedFork.status === 'stopped' ? 'Start' : 'Restart'}
              </SailButton>
            </div>
          </GlassCard>
        </div>
      )}
    </>
  )
}
