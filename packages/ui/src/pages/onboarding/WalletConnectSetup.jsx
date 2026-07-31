import { useEffect, useState } from 'react'
import styles from './WalletConnectSetup.module.css'
import { getWalletConfig, saveWalletConfig } from '../../data/sailorClient'

const REOWN_URL = 'https://cloud.reown.com'

// Same shape check the client config and the server both apply. Validating here
// too keeps the Save button honest instead of round-tripping a doomed value.
const PROJECT_ID_RE = /^[0-9a-f]{32}$/i

const REOWN_STEPS = [
  <>Open <a className={styles.inlineLink} href={REOWN_URL} target="_blank" rel="noreferrer">cloud.reown.com</a> and sign in — the free tier is enough.</>,
  'Create a project. Any name works; pick AppKit if it asks for a type.',
  'Copy the Project ID from the project’s dashboard — 32 hex characters.',
  'Paste it above and save. The id is a public app identifier, not a secret.',
]

const SAFE_STEPS = [
  'Save your Reown project id above — without it WalletConnect cannot pair.',
  'In your Safe at app.safe.global, open Apps and launch the WalletConnect app.',
  'Back here, choose Connect wallet → WalletConnect to get the pairing QR.',
  'Scan it from Safe’s WalletConnect app, or paste the copied URI there.',
  'Approve the connection in Safe. Requests then arrive as Safe transactions for your signers to confirm.',
]

/**
 * Subtle, collapsed-by-default WalletConnect setup on the welcome landing.
 *
 * It lives here because WalletConnect is a precondition for connecting a Safe
 * (or any non-extension wallet), and that decision is made before setup starts —
 * discovering it only at the connect modal is what made the missing project id
 * feel like a broken button.
 */
export default function WalletConnectSetup() {
  const [open, setOpen] = useState(false)
  const [howOpen, setHowOpen] = useState(false)
  const [safeOpen, setSafeOpen] = useState(false)
  const [cfg, setCfg] = useState(null)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getWalletConfig()
      .then((c) => {
        setCfg(c)
        setValue(c.walletConnectProjectId ?? '')
      })
      .catch(() => setCfg({ configured: false, walletConnectProjectId: '', managedByEnv: false }))
  }, [])

  const trimmed = value.trim()
  const canSave = PROJECT_ID_RE.test(trimmed) && trimmed !== (cfg?.walletConnectProjectId ?? '')

  async function onSave() {
    setSaving(true)
    setError('')
    try {
      await saveWalletConfig({ projectId: trimmed })
      // The wagmi config is built once at module load from the id injected into
      // index.html, so the new value only takes effect on a fresh document.
      window.location.reload()
    } catch (err) {
      setError(err.message ?? 'Could not save')
      setSaving(false)
    }
  }

  if (!cfg) return null

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`${styles.dot} ${cfg.configured ? styles.dotOn : ''}`} aria-hidden />
        <span className={styles.triggerText}>
          {cfg.configured ? 'WalletConnect ready' : 'Connecting a Safe or mobile wallet?'}
        </span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden>
          <ChevronDown />
        </span>
      </button>

      <div className={`${styles.panel} ${open ? styles.panelOpen : ''}`} aria-hidden={!open}>
        <div className={styles.panelInner}>
          <p className={styles.blurb}>
            Browser-extension wallets work out of the box. A Safe or a mobile wallet
            connects over WalletConnect, which needs a free Reown project id.
          </p>

          {cfg.managedByEnv ? (
            <p className={styles.note}>
              Set by the <code>WALLETCONNECT_PROJECT_ID</code> environment variable, which takes
              precedence over the project file — edit it where the server was started.
            </p>
          ) : (
            <>
              <label className={styles.label} htmlFor="wc-project-id">Reown project id</label>
              <div className={styles.field}>
                <input
                  id="wc-project-id"
                  type="text"
                  className={styles.input}
                  placeholder="32 hex characters"
                  value={value}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => { setValue(e.target.value); setError('') }}
                />
                {PROJECT_ID_RE.test(trimmed) && (
                  <span className={styles.ok} aria-hidden><MiniCheck /></span>
                )}
              </div>

              {/* Length is the tell for the common failure — a partial paste. */}
              {trimmed !== '' && !PROJECT_ID_RE.test(trimmed) && (
                <p className={styles.warn}>
                  Expected 32 hex characters, got {trimmed.length}.
                </p>
              )}
              {error && <p className={styles.warn}>{error}</p>}

              <div className={styles.actions}>
                <span className={styles.storedNote}>
                  Stored in <code>.sail/.env.local</code>. Never sent to Sail.
                </span>
                <button
                  type="button"
                  className={styles.saveBtn}
                  onClick={onSave}
                  disabled={saving || !canSave}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}

          <Disclosure
            label="Where do I get a Reown project id?"
            open={howOpen}
            onToggle={() => setHowOpen((v) => !v)}
            steps={REOWN_STEPS}
            link={{ href: REOWN_URL, label: 'Open Reown Cloud' }}
          />
          <Disclosure
            label="How do I connect my Safe?"
            open={safeOpen}
            onToggle={() => setSafeOpen((v) => !v)}
            steps={SAFE_STEPS}
            footer="Sail validates contract signatures on-chain (ERC-1271), so a Safe can own an SMA. If you instead run this dashboard as a Safe App, it connects through the Safe iframe and needs no project id."
          />
        </div>
      </div>
    </div>
  )
}

function Disclosure({ label, open, onToggle, steps, link, footer }) {
  return (
    <div className={styles.howBlock}>
      <button type="button" className={styles.howTrigger} onClick={onToggle} aria-expanded={open}>
        <span className={styles.howIcon} aria-hidden><InfoDot /></span>
        <span className={styles.howText}>{label}</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden>
          <ChevronDown />
        </span>
      </button>
      <div className={`${styles.howPanel} ${open ? styles.howPanelOpen : ''}`} aria-hidden={!open}>
        <div className={styles.howPanelInner}>
          <ol className={styles.steps}>
            {steps.map((s, i) => (
              <li key={i}>
                <span className={styles.stepNum}>{String(i + 1).padStart(2, '0')}</span>
                <span className={styles.stepText}>{s}</span>
              </li>
            ))}
          </ol>
          {footer && <p className={styles.howFooter}>{footer}</p>}
          {link && (
            <a className={styles.howLink} href={link.href} target="_blank" rel="noreferrer">
              {link.label}
              <ArrowOut />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 5l4 4 4-4" />
    </svg>
  )
}
function MiniCheck() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7.4l2.6 2.6L11 4.4" />
    </svg>
  )
}
function InfoDot() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.4" strokeLinecap="round" />
      <circle cx="8" cy="5.2" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}
function ArrowOut() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 9 L9 5" />
      <path d="M5.4 5 H9 V8.6" />
    </svg>
  )
}
