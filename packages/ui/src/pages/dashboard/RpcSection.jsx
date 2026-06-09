import { useEffect, useState } from 'react'
import styles from './RpcSection.module.css'
import { InfoTip } from '../shared'
import { getOnboardState, saveConfig } from '../../data/sailorClient'

const RPC_TIP = "An RPC is the connection your dashboard uses to read the blockchain and broadcast transactions · like a phone line to the network. Sail talks to the chain directly through it; there's no Sail server in between. A free Alchemy/Infura key (or a public endpoint) works."

/**
 * RpcSection · the network/RPC config, living on the SMA hero card (moved out
 * of the Settings modal so the card is the single source of truth).
 *
 * Compact by default: endpoint + chain + a plain-language status pill
 * ("Connected · <chain>" when healthy; an actionable warning otherwise ·
 * no RPC/kernel jargon on the user surface). "Edit" expands the
 * onboarding-style provider picker (Alchemy / Infura / Public) + API key field
 * + the "where do I find my key" guide · the same surface as the setup wizard's
 * step 03, so first-run and durable editing look identical.
 *
 * Contract: reads GET /api/onboard/state, writes POST /api/onboard/save-config
 * { rpcUrl, sailApiKey, chainId } via src/data/sailorClient.js. The framework
 * persists the composed endpoint locally as RPC_URL in .sail/.env.local; the
 * provider picker is only a helper that builds that URL string.
 */

const CHAINS = [
  { id: 8453, name: 'Base', kind: 'mainnet' },
  { id: 42161, name: 'Arbitrum', kind: 'mainnet' },
  { id: 130, name: 'Unichain', kind: 'mainnet' },
  { id: 84532, name: 'Base Sepolia', kind: 'testnet' },
]

const RPC_PROVIDERS = [
  {
    id: 'alchemy', name: 'Alchemy', tag: 'Recommended', needsKey: true,
    desc: 'Free tier, reliable for automation. The Sailor default.',
    keyHint: 'Paste your Alchemy API key',
    url: 'https://dashboard.alchemy.com/apps', urlLabel: 'Open Alchemy dashboard',
    steps: [
      'Create a free account at alchemy.com.',
      'Click "Create new app" and pick this network.',
      'Open the app and copy the API key from the top of the page.',
      'Paste it above · one key works across every network.',
    ],
  },
  {
    id: 'infura', name: 'Infura', needsKey: true,
    desc: 'Free tier. A solid alternative to Alchemy.',
    keyHint: 'Paste your Infura project key',
    url: 'https://app.infura.io/dashboard', urlLabel: 'Open Infura dashboard',
    steps: [
      'Sign up free at infura.io.',
      'Open "API Keys" and click "Create new API key".',
      'Under Endpoints, enable this network.',
      'Copy the key and paste it above.',
    ],
  },
  {
    id: 'public', name: 'Public RPC', needsKey: false,
    desc: 'No key needed. Rate-limited, not for unattended runs.',
  },
]

/* Per-chain hostnames so the provider picker can compose a real RPC_URL ·
   exactly the string the framework persists. */
const ALCHEMY_HOST = {
  8453: 'base-mainnet.g.alchemy.com', 42161: 'arb-mainnet.g.alchemy.com',
  130: 'unichain-mainnet.g.alchemy.com', 84532: 'base-sepolia.g.alchemy.com',
}
const INFURA_HOST = {
  8453: 'base-mainnet.infura.io', 42161: 'arbitrum-mainnet.infura.io',
  130: 'unichain-mainnet.infura.io', 84532: 'base-sepolia.infura.io',
}
const PUBLIC_RPC = {
  8453: 'https://mainnet.base.org', 42161: 'https://arb1.arbitrum.io/rpc',
  130: 'https://mainnet.unichain.org', 84532: 'https://sepolia.base.org',
}

function composeRpcUrl(provider, chainId, key) {
  if (provider === 'public') return PUBLIC_RPC[chainId] ?? ''
  if (provider === 'infura') {
    const host = INFURA_HOST[chainId]
    return host ? `https://${host}/v3/${key}` : ''
  }
  const host = ALCHEMY_HOST[chainId]
  return host ? `https://${host}/v2/${key}` : ''
}

/* Best-effort provider inference from an existing endpoint, so opening Edit
   pre-selects what's already configured. */
function inferProvider(url) {
  if (!url) return 'alchemy'
  if (/alchemy\.com/i.test(url)) return 'alchemy'
  if (/infura\.io/i.test(url)) return 'infura'
  return 'public'
}

/* Mask the key segment of an endpoint for the compact readout. */
function maskRpcUrl(url) {
  if (!url) return ''
  const m = url.match(/^(https?:\/\/[^/]+)(\/.*\/)([^/]+)$/)
  if (!m) return url
  const [, origin, path, key] = m
  const shown = key.length > 6 ? `${key.slice(0, 4)}••••` : '••••'
  return `${origin}${path}${shown}`
}

export default function RpcSection() {
  const [onboard, setOnboard] = useState(null)
  const [editing, setEditing] = useState(false)
  const [provider, setProvider] = useState('alchemy')
  const [apiKey, setApiKey] = useState('')
  const [chainId, setChainId] = useState(42161)
  const [howOpen, setHowOpen] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)

  useEffect(() => {
    let alive = true
    getOnboardState().then((st) => {
      if (!alive) return
      setOnboard(st)
      setChainId(st.chainId ?? 42161)
      setProvider(inferProvider(st.rpcUrl))
    })
    return () => { alive = false }
  }, [])

  if (!onboard) {
    return (
      <div className={styles.section}>
        <span className={styles.eyebrow}>RPC /</span>
        <span className={styles.loading}>Reading configuration…</span>
      </div>
    )
  }

  const sel = RPC_PROVIDERS.find((p) => p.id === provider)
  const needsKey = !!sel?.needsKey
  const keyValid = !needsKey || apiKey.trim().length >= 12
  const rpcReachable = Boolean(onboard.rpcUrl)
  const kernelDetected = Boolean(onboard.kernel)
  const currentChain = CHAINS.find((c) => c.id === onboard.chainId)

  function openEdit() {
    setProvider(inferProvider(onboard.rpcUrl))
    setChainId(onboard.chainId ?? 42161)
    setApiKey('')
    setHowOpen(true)
    setEditing(true)
  }

  async function onSave() {
    // Public RPC needs no key; keyed providers compose origin/path/key. If the
    // key field is left blank on a keyed provider but the chain is unchanged,
    // keep the existing endpoint (the user is only re-confirming).
    let rpcUrl
    if (!needsKey) rpcUrl = composeRpcUrl('public', chainId)
    else if (apiKey.trim()) rpcUrl = composeRpcUrl(provider, chainId, apiKey.trim())
    else rpcUrl = onboard.rpcUrl

    setSaving(true)
    await saveConfig({ rpcUrl, chainId })
    const st = await getOnboardState()
    setOnboard(st)
    setApiKey('')
    setSaving(false)
    setSavedTick(true)
    setTimeout(() => setSavedTick(false), 1600)
    setEditing(false)
  }

  return (
    <div className={styles.section}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>RPC / <InfoTip label="What is an RPC?">{RPC_TIP}</InfoTip></span>
        {/* Human-language status: a calm "Connected · <chain>" when all is
            well; a plain, actionable message only when something's wrong.
            No "RPC"/"kernel" jargon on the user surface. */}
        <span className={`${styles.health} ${rpcReachable && kernelDetected ? styles.healthOk : styles.healthWarn}`}>
          <span className={styles.healthDot} aria-hidden />
          {rpcReachable && kernelDetected
            ? `Connected · ${currentChain?.name ?? 'network'}`
            : !rpcReachable
              ? 'No network configured'
              : `Sail not available on ${currentChain?.name ?? 'this network'}`}
        </span>
      </div>

      {!editing ? (
        /* ── Compact readout ── */
        <div className={styles.compact}>
          <div className={styles.compactMain}>
            <span className={styles.endpoint}>{maskRpcUrl(onboard.rpcUrl) || 'Not configured'}</span>
            <span className={styles.compactMeta}>
              <span className={styles.chainChipStatic}>{currentChain?.name ?? `Chain ${onboard.chainId}`}</span>
              <span className={styles.compactSep} aria-hidden>·</span>
              <span className={styles.providerName}>{RPC_PROVIDERS.find((p) => p.id === inferProvider(onboard.rpcUrl))?.name}</span>
            </span>
          </div>
          <button type="button" className={styles.editBtn} onClick={openEdit}>
            {savedTick ? 'Saved ✓' : 'Edit'}
          </button>
        </div>
      ) : (
        /* ── Edit · onboarding-style provider picker ── */
        <div className={styles.edit}>
          <span className={styles.listLabel}>Network</span>
          <div className={styles.chainRow}>
            {CHAINS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.chainChip} ${chainId === c.id ? styles.chainChipActive : ''}`}
                onClick={() => setChainId(c.id)}
              >
                {c.name}
                {c.kind === 'testnet' && <span className={styles.chainTag}>testnet</span>}
              </button>
            ))}
          </div>

          <span className={styles.listLabel}>Commonly used</span>
          <ul className={styles.optionList}>
            {RPC_PROVIDERS.map((p) => {
              const active = provider === p.id
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`${styles.optionRow} ${active ? styles.optionRowActive : ''}`}
                    onClick={() => setProvider(p.id)}
                    aria-pressed={active}
                  >
                    <span className={styles.optionBody}>
                      <span className={styles.optionNameRow}>
                        <span className={styles.optionName}>{p.name}</span>
                        {p.tag && <span className={styles.optionTag}>{p.tag}</span>}
                        {!p.needsKey && <span className={styles.optionTagMuted}>No key</span>}
                      </span>
                      <span className={styles.optionSub}>{p.desc}</span>
                    </span>
                    <span className={`${styles.optionRadio} ${active ? styles.optionRadioOn : ''}`} aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>

          {needsKey && (
            <div className={styles.fieldBlock}>
              <label className={styles.fieldLabel} htmlFor="rpc-card-key">{sel.name} API key</label>
              <div className={styles.field}>
                <span className={styles.fieldIcon} aria-hidden><KeyIcon /></span>
                <input
                  id="rpc-card-key"
                  type="text"
                  className={styles.fieldInput}
                  placeholder={onboard.rpcUrl && inferProvider(onboard.rpcUrl) === provider ? '•••••••••• (keep current)' : sel.keyHint}
                  value={apiKey}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setApiKey(e.target.value)}
                />
                {keyValid && apiKey && <span className={styles.fieldOk} aria-hidden><MiniCheck /></span>}
              </div>
              <p className={styles.fieldNote}>
                Stored locally in <code>.sail/.env.local</code> as <code>RPC_URL</code>. Never sent to Sail.
              </p>

              <div className={styles.howBlock}>
                <button
                  type="button"
                  className={styles.howTrigger}
                  onClick={() => setHowOpen((v) => !v)}
                  aria-expanded={howOpen}
                >
                  <span className={styles.howTriggerIcon} aria-hidden><InfoDot /></span>
                  <span className={styles.howTriggerText}>Where do I find my {sel.name} key?</span>
                  <span className={`${styles.howChevron} ${howOpen ? styles.howChevronOpen : ''}`} aria-hidden><ChevronDown /></span>
                </button>
                <div className={`${styles.howPanel} ${howOpen ? styles.howPanelOpen : ''}`} aria-hidden={!howOpen}>
                  <div className={styles.howPanelInner}>
                    <ol className={styles.howSteps}>
                      {sel.steps.map((s, i) => (
                        <li key={i}>
                          <span className={styles.howStepNum}>{String(i + 1).padStart(2, '0')}</span>
                          <span className={styles.howStepText}>{s}</span>
                        </li>
                      ))}
                    </ol>
                    <a className={styles.howLink} href={sel.url} target="_blank" rel="noreferrer">
                      {sel.urlLabel}
                      <ArrowOut />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!needsKey && (
            <p className={styles.fieldNote}>
              Uses <code>{PUBLIC_RPC[chainId]}</code>. Fine for a look around; switch to a keyed
              provider before letting the agent run unattended.
            </p>
          )}

          <div className={styles.editActions}>
            <button type="button" className={styles.cancelBtn} onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={styles.saveBtn} onClick={onSave} disabled={saving || (needsKey && !!apiKey && !keyValid)}>
              {saving ? 'Saving…' : 'Save RPC config'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ────────── Icons ────────── */
function RpcGlyph({ id }) {
  if (id === 'public') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <circle cx="8" cy="8" r="6" />
        <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" strokeWidth="1.2" />
      </svg>
    )
  }
  if (id === 'infura') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <circle cx="8" cy="3.2" r="1.6" />
        <circle cx="3.4" cy="11.4" r="1.6" />
        <circle cx="12.6" cy="11.4" r="1.6" />
        <path d="M8 4.8l-4.6 6.6M8 4.8l4.6 6.6M4.6 11.4h6.8" strokeWidth="1.1" />
      </svg>
    )
  }
  // alchemy · hex node
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M8 1.6l5.5 3.2v6.4L8 14.4 2.5 11.2V4.8z" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}
function KeyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="5.5" cy="5.5" r="3" />
      <path d="M7.6 7.6l5 5M11 11l1.4-1.4M9.4 9.4l1.4-1.4" />
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
function ChevronDown() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 5l4 4 4-4" />
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
