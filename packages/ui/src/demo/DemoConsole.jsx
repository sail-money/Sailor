import { useEffect, useState } from 'react'
import { DEMO_GROUPS, buildIncomingUrl } from './demoStates'
import { useDemoState } from './useDemoState'
import styles from './DemoConsole.module.css'

const STORAGE_KEY = 'sail.demoConsole'

/**
 * Floating demo console — bottom-right.
 *
 * - Lists every reachable UI state as a preset.
 * - Click → navigates to that state via the hash router.
 * - Has a "Build URL for Claude" form for the incoming-mandate state.
 * - Dismissable (state persisted to localStorage) so it doesn't appear in
 *   screen recordings unless the user re-enables via ?demoConsole=1.
 */
export default function DemoConsole() {
  const current = useDemoState()
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(() => readHidden())
  const [tab, setTab] = useState('presets') // presets | builder

  // ?demoConsole=1 forces visible, ?demoConsole=0 forces hidden
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    if (params.get('demoConsole') === '1') {
      setHidden(false)
      writeHidden(false)
    } else if (params.get('demoConsole') === '0') {
      setHidden(true)
      writeHidden(true)
    }
  }, [])

  if (hidden) return null

  const dismiss = () => { setHidden(true); writeHidden(true); setOpen(false) }

  return (
    <>
      <button
        type="button"
        className={`${styles.fab} ${open ? styles.fabActive : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle demo console"
        aria-expanded={open}
      >
        <span className={styles.fabDot} aria-hidden />
        <span className={styles.fabLabel}>Demo</span>
      </button>

      {open && (
        <aside className={styles.panel} role="dialog" aria-label="Demo console">
          <header className={styles.head}>
            <span className={styles.headKicker}>SAIL DEMO</span>
            <button type="button" className={styles.close} onClick={dismiss} aria-label="Hide demo console">×</button>
          </header>

          <nav className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'presets' ? styles.tabActive : ''}`}
              onClick={() => setTab('presets')}
            >
              Presets
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'builder' ? styles.tabActive : ''}`}
              onClick={() => setTab('builder')}
            >
              Claude URL
            </button>
          </nav>

          {tab === 'presets' && (
            <div className={styles.body}>
              {DEMO_GROUPS.map((group) => (
                <section key={group.title} className={styles.group}>
                  <span className={styles.groupTitle}>{group.title}</span>
                  <ul className={styles.list}>
                    {group.presets.map((p) => {
                      const active =
                        (current.demo === p.id) ||
                        (group.title === 'New visitor' && !current.demo && window.location.hash.replace(/^#/, '').startsWith('/'))
                      return (
                        <li key={p.id} className={`${styles.preset} ${active ? styles.presetActive : ''}`}>
                          <button
                            type="button"
                            className={styles.presetMain}
                            onClick={() => { window.location.hash = p.url.replace(/^#/, '') }}
                          >
                            <span className={styles.presetLabel}>{p.label}</span>
                            <span className={styles.presetDescription}>{p.description}</span>
                          </button>
                          <button
                            type="button"
                            className={styles.copy}
                            onClick={(e) => {
                              e.stopPropagation()
                              copyToClipboard(absoluteUrl(p.url))
                            }}
                            aria-label="Copy link"
                            title="Copy full URL"
                          >
                            <CopyIcon />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {tab === 'builder' && <ClaudeBuilder />}

          <footer className={styles.foot}>
            <span>Press ⇧+D to toggle</span>
            <span>·</span>
            <span>{absoluteUrl('')}</span>
          </footer>
        </aside>
      )}
    </>
  )
}

function ClaudeBuilder() {
  const [draft, setDraft] = useState({
    ai: 'Claude',
    title: '$300 into Ethena sUSDe',
    summary: 'Move up to $300 of idle USDC into Ethena sUSDe for 14 days to capture stable yield.',
    cap: '$300 max',
    time: '14 days',
    net: 'Arbitrum',
    asset: 'USDC',
    acts: 'Deposit USDC into sUSDe\nClaim sUSDe rewards\nWithdraw on expiry',
  })

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
  const url = absoluteUrl(buildIncomingUrl({
    ...draft,
    acts: draft.acts.split('\n').map((s) => s.trim()).filter(Boolean),
  }))

  return (
    <div className={styles.builderBody}>
      <p className={styles.builderHint}>
        Paste this URL into a Claude chat — clicking it opens the dashboard with this mandate as a fresh draft.
      </p>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>AI provider</label>
        <select
          className={styles.fieldInput}
          value={draft.ai}
          onChange={(e) => set('ai', e.target.value)}
        >
          <option>Claude</option>
          <option>Cursor</option>
          <option>Codex</option>
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>Title</label>
        <input className={styles.fieldInput} value={draft.title} onChange={(e) => set('title', e.target.value)} />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>Summary (the AI's prompt)</label>
        <textarea className={styles.fieldArea} rows={2} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
      </div>

      <div className={styles.fieldGrid}>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Cap</label>
          <input className={styles.fieldInput} value={draft.cap} onChange={(e) => set('cap', e.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Time</label>
          <input className={styles.fieldInput} value={draft.time} onChange={(e) => set('time', e.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Network</label>
          <input className={styles.fieldInput} value={draft.net} onChange={(e) => set('net', e.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Asset</label>
          <input className={styles.fieldInput} value={draft.asset} onChange={(e) => set('asset', e.target.value)} />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>Actions (one per line)</label>
        <textarea className={styles.fieldArea} rows={3} value={draft.acts} onChange={(e) => set('acts', e.target.value)} />
      </div>

      <div className={styles.urlBox}>
        <code className={styles.url}>{url}</code>
        <div className={styles.urlActions}>
          <button type="button" className={styles.copyBig} onClick={() => copyToClipboard(url)}>
            <CopyIcon /> Copy URL
          </button>
          <button
            type="button"
            className={styles.openBig}
            onClick={() => { window.location.href = url }}
          >
            Open →
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── helpers ── */
function absoluteUrl(hashUrl) {
  if (typeof window === 'undefined') return hashUrl
  const base = `${window.location.origin}${window.location.pathname}`
  if (hashUrl.startsWith('#')) return base + hashUrl
  if (hashUrl.startsWith('/')) return base + hashUrl
  return base + hashUrl
}

function copyToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
  }
}

function readHidden() {
  if (typeof window === 'undefined') return false
  try { return localStorage.getItem(STORAGE_KEY) === 'hidden' } catch { return false }
}
function writeHidden(hidden) {
  try { localStorage.setItem(STORAGE_KEY, hidden ? 'hidden' : 'visible') } catch {}
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden>
      <rect x="2.2" y="2.2" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4 4V3.2a1 1 0 011-1h3.8a1 1 0 011 1V8a1 1 0 01-1 1H8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}
