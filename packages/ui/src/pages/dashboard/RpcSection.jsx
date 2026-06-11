import { useEffect, useState } from 'react'
import styles from './RpcSection.module.css'
import { InfoTip } from '../shared'
import { getOnboardState, saveConfig } from '../../data/sailorClient'

const RPC_TIP = "An RPC is the connection your dashboard uses to read the blockchain and broadcast transactions — like a phone line to the network. Sail talks to the chain directly through it; there's no Sail server in between. A free Alchemy/Infura key (or a public endpoint) works."

const CHAINS = [
  { id: 8453,  name: 'Base',         kind: 'mainnet' },
  { id: 42161, name: 'Arbitrum',     kind: 'mainnet' },
  { id: 130,   name: 'Unichain',     kind: 'mainnet' },
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
      'Paste it above — one key works across every network.',
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
    id: 'custom', name: 'Custom / Public', needsKey: false,
    desc: 'Paste any RPC URL — a public endpoint, your own node, or a private provider.',
  },
]

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
  if (provider === 'infura') {
    const host = INFURA_HOST[chainId]
    return host ? `https://${host}/v3/${key}` : ''
  }
  if (provider === 'alchemy') {
    const host = ALCHEMY_HOST[chainId]
    return host ? `https://${host}/v2/${key}` : ''
  }
  return key // custom: key field holds the full URL
}

function inferProvider(url) {
  if (!url) return 'alchemy'
  if (/alchemy\.com/i.test(url)) return 'alchemy'
  if (/infura\.io/i.test(url)) return 'infura'
  return 'custom'
}

function maskRpcUrl(url) {
  if (!url) return ''
  const m = url.match(/^(https?:\/\/[^/]+)(\/.*\/)([^/]+)$/)
  if (!m) return url
  const [, origin, path, key] = m
  const shown = key.length > 6 ? `${key.slice(0, 4)}••••` : '••••'
  return `${origin}${path}${shown}`
}

function ChainRow({ chainId, rpcUrl, isActive, onSaved }) {
  const chain = CHAINS.find((c) => c.id === chainId)
  const [editing, setEditing] = useState(false)
  const [provider, setProvider] = useState('alchemy')
  const [apiKey, setApiKey] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [howOpen, setHowOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)

  function openEdit() {
    const p = inferProvider(rpcUrl)
    setProvider(p)
    setApiKey('')
    setCustomUrl(p === 'custom' ? (rpcUrl ?? '') : (PUBLIC_RPC[chainId] ?? ''))
    setHowOpen(false)
    setEditing(true)
  }

  async function onSave() {
    let url
    if (provider === 'custom') url = customUrl.trim()
    else if (provider === 'alchemy' && apiKey.trim()) url = composeRpcUrl('alchemy', chainId, apiKey.trim())
    else if (provider === 'infura' && apiKey.trim()) url = composeRpcUrl('infura', chainId, apiKey.trim())
    else url = rpcUrl
    if (!url) return
    setSaving(true)
    await saveConfig({ rpcUrl: url, chainId })
    setSaving(false)
    setSavedTick(true)
    setTimeout(() => setSavedTick(false), 1600)
    setEditing(false)
    onSaved?.()
  }

  const sel = RPC_PROVIDERS.find((p) => p.id === provider)
  const needsKey = sel?.needsKey ?? false
  const canSave = provider === 'custom'
    ? customUrl.trim().startsWith('http')
    : !needsKey || apiKey.trim().length >= 12 || Boolean(rpcUrl)

  return (
    <div className={`${styles.chainCard} ${isActive ? styles.chainCardActive : ''}`}>
      <div className={styles.chainCardHead}>
        <div className={styles.chainMeta}>
          <span className={styles.chainName}>
            {chain?.name ?? `Chain ${chainId}`}
            {chain?.kind === 'testnet' && <span className={styles.chainTag}>testnet</span>}
            {isActive && <span className={styles.chainTagActive}>active</span>}
          </span>
          {!editing && (
            <span className={styles.chainEndpoint}>
              {rpcUrl
                ? maskRpcUrl(rpcUrl)
                : <span className={styles.chainEndpointMissing}>Not configured</span>}
            </span>
          )}
        </div>
        {!editing && (
          <button type="button" className={styles.editBtn} onClick={openEdit}>
            {savedTick ? 'Saved ✓' : rpcUrl ? 'Edit' : 'Add'}
          </button>
        )}
      </div>

      {editing && (
        <div className={styles.edit}>
          <span className={styles.listLabel}>Provider</span>
          <ul className={styles.optionList}>
            {RPC_PROVIDERS.map((p) => {
              const active = provider === p.id
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`${styles.optionRow} ${active ? styles.optionRowActive : ''}`}
                    onClick={() => {
                      setProvider(p.id)
                      if (p.id === 'custom') setCustomUrl(rpcUrl ?? PUBLIC_RPC[chainId] ?? '')
                    }}
                    aria-pressed={active}
                  >
                    <span className={styles.optionBody}>
                      <span className={styles.optionNameRow}>
                        <span className={styles.optionName}>{p.name}</span>
                        {p.tag && <span className={styles.optionTag}>{p.tag}</span>}
                        {!p.needsKey && <span className={styles.optionTagMuted}>URL</span>}
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
              <label className={styles.fieldLabel} htmlFor={`rpc-key-${chainId}`}>{sel.name} API key</label>
              <div className={styles.field}>
                <span className={styles.fieldIcon} aria-hidden><KeyIcon /></span>
                <input
                  id={`rpc-key-${chainId}`}
                  type="text"
                  className={styles.fieldInput}
                  placeholder={rpcUrl && inferProvider(rpcUrl) === provider ? '•••••••••• (keep current)' : sel.keyHint}
                  value={apiKey}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setApiKey(e.target.value)}
                />
                {apiKey.trim().length >= 12 && <span className={styles.fieldOk} aria-hidden><MiniCheck /></span>}
              </div>
              <p className={styles.fieldNote}>
                Stored in <code>.sail/.env.local</code>. Never sent to Sail.
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
            <div className={styles.fieldBlock}>
              <label className={styles.fieldLabel} htmlFor={`rpc-url-${chainId}`}>RPC URL</label>
              <div className={styles.field}>
                <span className={styles.fieldIcon} aria-hidden><LinkIcon /></span>
                <input
                  id={`rpc-url-${chainId}`}
                  type="text"
                  className={styles.fieldInput}
                  placeholder={PUBLIC_RPC[chainId] ?? 'https://your-rpc-endpoint'}
                  value={customUrl}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
                {customUrl.trim().startsWith('http') && <span className={styles.fieldOk} aria-hidden><MiniCheck /></span>}
              </div>
              <p className={styles.fieldNote}>
                Stored in <code>.sail/.env.local</code> as <code>RPC_URL_{chainId}</code>.
              </p>
            </div>
          )}

          <div className={styles.editActions}>
            <button type="button" className={styles.cancelBtn} onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={styles.saveBtn} onClick={onSave} disabled={saving || !canSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RpcSection({ deployedChains }) {
  const [onboard, setOnboard] = useState(null)

  function load() {
    getOnboardState().then(setOnboard).catch(() => {})
  }

  useEffect(() => { load() }, [])

  if (!onboard) {
    return (
      <div className={styles.section}>
        <span className={styles.eyebrow}>RPC /</span>
        <span className={styles.loading}>Reading configuration…</span>
      </div>
    )
  }

  const rpcByChain = onboard.rpcByChain ?? {}
  const activeChainId = onboard.chainId ?? 8453
  const chainIds = deployedChains && deployedChains.length > 0 ? deployedChains : [activeChainId]
  const configuredCount = chainIds.filter((id) => rpcByChain[id]).length

  return (
    <div className={styles.section}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>
          RPC / <InfoTip label="What is an RPC?">{RPC_TIP}</InfoTip>
        </span>
        <span className={`${styles.health} ${configuredCount > 0 ? styles.healthOk : styles.healthWarn}`}>
          <span className={styles.healthDot} aria-hidden />
          {configuredCount > 0
            ? `${configuredCount} network${configuredCount > 1 ? 's' : ''} configured`
            : 'No networks configured'}
        </span>
      </div>

      <div className={styles.chainList}>
        {chainIds.map((id) => (
          <ChainRow
            key={id}
            chainId={id}
            rpcUrl={rpcByChain[id] ?? null}
            isActive={Boolean(rpcByChain[id])}
            onSaved={load}
          />
        ))}
      </div>
    </div>
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
function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l1.5-1.5a3.5 3.5 0 0 0-5-5L7.5 3.5" />
      <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0L3 8a3.5 3.5 0 0 0 5 5l.5-.5" />
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
