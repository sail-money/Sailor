import { useEffect, useState } from 'react'
import styles from './SandboxBanner.module.css'

/**
 * Persistent top bar for any page served by the sandbox server process — the
 * one and only signal a sandbox page needs, since there is no other way for a
 * user to tell it apart from the live dashboard at a glance. `Exit` asks the
 * server to ensure the live server is running (starting it if needed) and
 * navigates there; it never touches this process's own state.
 */
export default function SandboxBanner() {
  const [chains, setChains] = useState([])
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/sandbox/forks', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { forks: {} }))
      .then((d) => {
        if (cancelled) return
        const names = Object.values(d?.forks ?? {})
          .filter((f) => f.status === 'ready')
          .map((f) => f.chain)
        setChains(names)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

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

  return (
    <div className={styles.bar} role="status">
      <span className={styles.mark} aria-hidden>⚓</span>
      <span className={styles.copy}>
        Sandbox{chains.length > 0 ? ` — ${chains.join(', ')} (local fork${chains.length > 1 ? 's' : ''})` : ''}
        <span className={styles.copyMuted}> · nothing here is real</span>
      </span>
      <button type="button" className={styles.exit} onClick={handleExit} disabled={exiting}>
        {exiting ? 'Opening live dashboard…' : 'Exit to live dashboard →'}
      </button>
    </div>
  )
}
