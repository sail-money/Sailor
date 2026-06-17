import { useEffect, useRef, useState } from 'react'

/**
 * A small amber warning glyph (shown next to the header brand) that appears when
 * the installed Sailor package was upgraded under a running `sailor ui` — the
 * process keeps serving stale assets/code until restarted (audit #5). Clicking
 * it opens a compact yellow popover with the restart instruction. Subtle by
 * design: it doesn't cover the UI, so users can keep the dashboard open.
 */
export default function VersionWarning() {
  const [info, setInfo] = useState(null)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const res = await fetch('/api/version')
        if (!res.ok) return
        const json = await res.json()
        if (alive) setInfo(json)
      } catch {
        /* best-effort */
      }
    }
    check()
    const timer = setInterval(check, 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!info?.stale) return null

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Update available — ${info.installed}`}
        title="Update available"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          background: 'none',
          padding: 4,
          cursor: 'pointer',
          color: '#F5C518',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 3.2 1.8 20.8h20.4L12 3.2Z" fill="#F5C518" />
          <rect x="11" y="9.5" width="2" height="5.5" rx="1" fill="#1a1a1a" />
          <rect x="11" y="16.5" width="2" height="2" rx="1" fill="#1a1a1a" />
        </svg>
      </button>
      {open && (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 8,
            width: 248,
            zIndex: 9999,
            padding: '10px 12px',
            background: '#F5C518',
            color: '#1a1a1a',
            borderRadius: 2,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            font: '12px/1.5 ui-sans-serif, system-ui, sans-serif',
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4 }}>
            Update available — {info.installed}
          </strong>
          This dashboard is still running {info.running}. Restart it to update:
          <code
            style={{
              display: 'block',
              marginTop: 6,
              padding: '4px 6px',
              background: 'rgba(0,0,0,0.12)',
              borderRadius: 2,
              font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            sailor ui stop &amp;&amp; sailor ui start
          </code>
        </div>
      )}
    </div>
  )
}
