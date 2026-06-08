import { useEffect, useState } from 'react'

/**
 * Play / Reset controls for a local simulation, rendered only when the project
 * is pointed at a local RPC (info.isLocal — see GET /api/network). They sit at
 * the right edge of the LocalRpcBanner.
 *
 *   ▶ Play   — captures a chain checkpoint (evm_snapshot) to rewind to later.
 *   ↺ Reset  — rewinds the chain to that checkpoint AND clears local onboarding
 *              state (account, manager key, wizard progress), then reloads so
 *              the onboarding wizard replays from a clean slate.
 *
 * Generic + local-only: every action goes through /api/sim/*, which refuses
 * against a public RPC — zero effect on production networks.
 */
export default function SimControls({ info }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(null) // 'checkpoint' | 'reset' | null

  const refresh = async () => {
    try {
      const r = await fetch('/api/sim/status', { cache: 'no-store' })
      const s = await r.json()
      setStatus(s)
      return s
    } catch {
      return null
    }
  }

  // On mount, load status and auto-capture a checkpoint if none exists yet, so
  // Reset works immediately without the operator pressing Play first.
  useEffect(() => {
    if (!info?.isLocal) return
    ;(async () => {
      const s = await refresh()
      if (s?.isLocal && !s.checkpoint) {
        try { await fetch('/api/sim/checkpoint', { method: 'POST' }) } catch { /* non-fatal */ }
        refresh()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.isLocal])

  if (!info?.isLocal) return null

  const capture = async () => {
    setBusy('checkpoint')
    try {
      await fetch('/api/sim/checkpoint', { method: 'POST' })
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const reset = async () => {
    const cp = status?.checkpoint
    const msg = cp
      ? 'Rewind to your last checkpoint?\n\n' +
        `Reverts the chain to block ${cp.block ?? '?'} and restores the onboarding ` +
        'state you had when you pressed Play (SMA, manager key, mandates, activity). ' +
        'Anything since then is discarded.'
      : 'Reset the simulation?\n\n' +
        'No checkpoint set, so this clears onboarding (account, manager key, ' +
        'wizard progress, activity) and replays the wizard from scratch. ' +
        'Press Play first to set a restore point.'
    const ok = window.confirm(msg)
    if (!ok) return
    setBusy('reset')
    try {
      const r = await fetch('/api/sim/reset', { method: 'POST' })
      const j = await r.json()
      if (!r.ok || j.error) {
        window.alert(`Reset failed: ${j.error || r.status}`)
        setBusy(null)
        return
      }
      // Reload so the dashboard re-checks onboarding state and shows the wizard.
      window.location.reload()
    } catch (e) {
      window.alert(`Reset failed: ${e}`)
      setBusy(null)
    }
  }

  const cp = status?.checkpoint
  const head = status?.currentBlock
  const ahead = cp?.block != null && head != null ? head - cp.block : null

  const btn = (disabled) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '2px 9px',
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: 0.2,
    color: '#ffd66b',
    background: 'rgba(0,0,0,0.28)',
    border: '1px solid rgba(255, 214, 107, 0.4)',
    borderRadius: 5,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  })

  return (
    <div
      style={{
        position: 'fixed',
        top: 3,
        right: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        // Above the banner (which is centered + pointer-events:none).
        zIndex: 2147483647,
        pointerEvents: 'auto',
        fontSize: 11,
        color: 'rgba(255, 214, 107, 0.85)',
      }}
    >
      <span title={cp ? `checkpoint @ block ${cp.block ?? '?'}` : 'no checkpoint yet'}>
        {cp
          ? `⏺ block ${cp.block ?? '?'}${ahead != null && ahead > 0 ? ` (+${ahead})` : ''}`
          : '⏺ no checkpoint'}
      </span>
      <button
        type="button"
        style={btn(busy != null)}
        disabled={busy != null}
        onClick={capture}
        title="Save a restore point — snapshots the chain AND your onboarding state (SMA, manager key, mandates, activity) to return to with Reset"
      >
        ▶ {busy === 'checkpoint' ? 'Saving…' : 'Play'}
      </button>
      <button
        type="button"
        style={btn(busy != null)}
        disabled={busy != null}
        onClick={reset}
        title="Rewind the chain and your onboarding state to the last Play checkpoint (or clear from scratch if none)"
      >
        ↺ {busy === 'reset' ? 'Resetting…' : 'Reset'}
      </button>
    </div>
  )
}
