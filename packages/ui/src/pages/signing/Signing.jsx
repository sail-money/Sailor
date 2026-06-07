'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  FluidBackground,
  GlassCard,
  Sai,
  RevealCalldata,
  SailButton,
} from '../shared'
import shared from '../shared/shared.module.css'
import styles from './Signing.module.css'
import { mockDeploy } from './mockData'
import { useDemoState } from '../../demo/useDemoState'

// Legacy login/signup URLs route to the unified 'connect' state so old
// demo-console links keep working.
const STATE_ALIASES = { login: 'connect', signup: 'connect' }
const VALID_DEMO_STATES = new Set([
  'welcome', 'connect', 'network', 'rpc', 'password', 'deploy', 'confirming',
])

/* ── Setup data (from the Sailor framework) ──
   Supported chains are the verified SailKernel deployments bundled in
   @sail/sdk: Base, Arbitrum, Unichain (mainnet) + Base Sepolia (testnet). */
const NETWORKS = [
  { id: 'base',         name: 'Base',         chainId: 8453,  kind: 'mainnet', recommended: true,
    desc: 'Low fees, deep liquidity. The default home for a Sail SMA.' },
  { id: 'arbitrum',     name: 'Arbitrum',     chainId: 42161, kind: 'mainnet',
    desc: 'Mature DeFi venues, the broadest yield surface.' },
  { id: 'unichain',     name: 'Unichain',     chainId: 130,   kind: 'mainnet',
    desc: 'Uniswap-native L2 tuned for low-latency swaps.' },
  { id: 'base-sepolia', name: 'Base Sepolia', chainId: 84532, kind: 'testnet',
    desc: 'Free testnet. Rehearse the full flow with no real funds.' },
]

/* RPC providers. A keyed provider (Alchemy / Infura) builds the RPC_URL
   from the API key; the public endpoint needs no key but is rate-limited
   and not meant for unattended automation. */
const RPC_PROVIDERS = [
  { id: 'alchemy', name: 'Alchemy', tag: 'Recommended', needsKey: true,
    desc: 'Free tier, reliable for automation. The Sailor default.',
    keyHint: 'Paste your Alchemy API key', keyLen: 20,
    url: 'https://dashboard.alchemy.com/apps', urlLabel: 'Open Alchemy dashboard',
    steps: [
      'Create a free account at alchemy.com.',
      'Click "Create new app" and pick a network you selected (Base, Arbitrum…).',
      'Open the app and copy the API key from the top of the page.',
      'Paste it above. One key works across every network you chose.',
    ] },
  { id: 'infura',  name: 'Infura',  needsKey: true,
    desc: 'Free tier. A solid alternative to Alchemy.',
    keyHint: 'Paste your Infura project key', keyLen: 20,
    url: 'https://app.infura.io/dashboard', urlLabel: 'Open Infura dashboard',
    steps: [
      'Sign up free at infura.io.',
      'Open "API Keys" and click "Create new API key".',
      'Under Endpoints, enable the networks you selected (Base, Arbitrum…).',
      'Copy the key and paste it above.',
    ] },
  { id: 'public',  name: 'Public RPC', needsKey: false,
    desc: 'No key needed. Rate-limited, not for unattended runs.' },
]

/**
 * Sign-in & account-setup flow.
 *
 *   welcome → connect → network → rpc → password → deploy → confirming → dashboard
 *
 * Mirrors the Sailor setup wizard: choose the chain, point at an RPC,
 * set a password that encrypts the agent's signing key on this device,
 * then sign the deployment. The wallet is the identity; Sail never sees
 * the keys.
 */
export default function Signing() {
  const router = useRouter()
  const demo = useDemoState()
  const aliased = STATE_ALIASES[demo.demo] ?? demo.demo
  const initialState = VALID_DEMO_STATES.has(aliased) ? aliased : 'welcome'
  const [state, setState] = useState(initialState)
  const [progress, setProgress] = useState('idle')

  // Setup selections carried across steps. Networks is multi-select —
  // Sail deploys one SMA per chain, so an operator can stand several up
  // in a single pass.
  const [networks, setNetworks] = useState(['base'])
  const [provider, setProvider] = useState('alchemy')
  const [apiKey, setApiKey] = useState('')

  function toggleNetwork(id) {
    setNetworks((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  useEffect(() => {
    if (state !== 'confirming') return
    setProgress('waiting')
    // Success state dwells for ~2.4s after it lands — long enough for
    // the user to read "Account deployed." and feel the moment.
    const t1 = setTimeout(() => setProgress('confirmed'), 1700)
    const t2 = setTimeout(() => {
      router.push('/dashboard')
    }, 4100)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [state, router])

  function go(next) {
    setState(next)
  }

  const selectedNetworks = NETWORKS.filter((n) => networks.includes(n.id))

  return (
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <FluidBackground />

      <HeaderBar onLogo={() => go('welcome')} state={state} />

      <main className={styles.stage}>
        <Stepper state={state} />

        <div key={state} className={styles.stageInner}>
          {state === 'welcome' && (
            <WelcomeState onConnect={() => go('connect')} />
          )}
          {state === 'connect' && (
            <ConnectState
              onBack={() => go('welcome')}
              onAuthed={() => go('network')}
            />
          )}
          {state === 'network' && (
            <NetworkState
              selected={networks}
              onToggle={toggleNetwork}
              onBack={() => go('connect')}
              onNext={() => go('rpc')}
            />
          )}
          {state === 'rpc' && (
            <RpcState
              networks={selectedNetworks}
              provider={provider}
              apiKey={apiKey}
              onSelectProvider={setProvider}
              onApiKey={setApiKey}
              onBack={() => go('network')}
              onNext={() => go('password')}
            />
          )}
          {state === 'password' && (
            <PasswordState
              onBack={() => go('rpc')}
              onNext={() => go('deploy')}
            />
          )}
          {state === 'deploy' && (
            <DeployState
              networks={selectedNetworks}
              onBack={() => go('password')}
              onSign={() => go('confirming')}
            />
          )}
          {state === 'confirming' && <ConfirmState progress={progress} />}
        </div>
      </main>
    </div>
  )
}

/* ─────────── Header bar ─────────── */
function HeaderBar({ onLogo, state }) {
  return (
    <header className={styles.headerBar}>
      <button
        type="button"
        className={styles.logoBtn}
        onClick={onLogo}
        aria-label="Sail home"
      >
        <Sai size={56} animate />
      </button>
      {state !== 'confirming' && (
        <span className={styles.headerHint}>
          Sail never sees your keys
        </span>
      )}
    </header>
  )
}

/* ─────────── Stepper — the five setup phases ─────────── */
const SIGNING_STEPS = [
  { id: 'connect',  label: 'Connect' },
  { id: 'network',  label: 'Network' },
  { id: 'rpc',      label: 'RPC' },
  { id: 'password', label: 'Secure' },
  { id: 'deploy',   label: 'Deploy' },
]

const STEP_INDEX = {
  connect: 0, network: 1, rpc: 2, password: 3, deploy: 4, confirming: 4,
}

function Stepper({ state }) {
  const currentIdx = STEP_INDEX[state] ?? -1
  if (currentIdx < 0) return null
  const allDone = state === 'confirming'

  return (
    <nav className={styles.stepper} aria-label="Setup progress">
      {SIGNING_STEPS.map((s, i) => {
        const status =
          allDone || i < currentIdx ? 'done' :
          i === currentIdx ? 'current' : 'upcoming'
        return (
          <span key={s.id} className={styles.stepGroup}>
            <span className={`${styles.step} ${styles[`step_${status}`]}`}>
              <span className={styles.stepCircle} aria-hidden>
                {status === 'done' ? (
                  <svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7.5l2.6 2.6L11 4" />
                  </svg>
                ) : (
                  String(i + 1).padStart(2, '0')
                )}
              </span>
              <span className={styles.stepLabel}>{s.label}</span>
            </span>
            {i < SIGNING_STEPS.length - 1 && (
              <span
                className={`${styles.stepLine} ${(allDone || i < currentIdx) ? styles.stepLineDone : ''}`}
                aria-hidden
              />
            )}
          </span>
        )
      })}
    </nav>
  )
}

/* ─────────── Welcome — single Connect CTA ─────────── */
function WelcomeState({ onConnect }) {
  return (
    <GlassCard className={styles.welcomeCard}>
      <div className={styles.cardSai} aria-hidden>
        <Sai size={64} animate />
      </div>

      <header className={styles.cardHeader}>
        <span className={styles.kicker}>WELCOME TO SAIL</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          Separately Managed Accounts.
        </h1>
        <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
          Enforced by code, run by agents.
        </p>
      </header>

      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={onConnect}>
          Connect wallet
        </SailButton>
      </div>

      <p className={styles.fineprint}>
        Wallet connection by RainbowKit. Sail never holds your keys.
      </p>
    </GlassCard>
  )
}

/* ─────────── Connect wallet — RainbowKit-style picker ───────────
   No separate paths for new vs returning users: the wallet itself is
   the identity. Connection is handled by RainbowKit; this is the
   in-brand wallet picker that fronts it. */
function ConnectState({ onBack, onAuthed }) {
  return (
    <GlassCard className={styles.authCard}>
      <CardHeader
        kicker="CONNECT A WALLET"
        title="Choose a wallet"
        sub="Sail is self-custody. Connect the wallet that will own your SMA."
        onBack={onBack}
      />
      <WalletGrid onPick={onAuthed} />
      <a
        className={styles.walletHelp}
        href="https://learn.rainbow.me/understanding-web3"
        target="_blank"
        rel="noreferrer"
      >
        <span className={styles.walletHelpIcon} aria-hidden><InfoDot /></span>
        New to wallets? Learn what a wallet is
        <span className={styles.walletHelpArrow} aria-hidden><ArrowRight /></span>
      </a>
    </GlassCard>
  )
}

/* ─────────── Wallet grid (EOA only) ─────────── */
const WALLETS = [
  { id: 'metamask',      label: 'MetaMask',      tone: 'orange' },
  { id: 'rabby',         label: 'Rabby',         tone: 'blue' },
  { id: 'phantom',       label: 'Phantom',       tone: 'purple' },
  { id: 'coinbase',      label: 'Coinbase',      tone: 'blue' },
  { id: 'rainbow',       label: 'Rainbow',       tone: 'rainbow' },
  { id: 'ledger',        label: 'Ledger',        tone: 'mono' },
  { id: 'trust',         label: 'Trust',         tone: 'blue' },
  { id: 'walletconnect', label: 'WalletConnect', tone: 'blue' },
]

function WalletGrid({ onPick }) {
  return (
    <div className={styles.walletGrid}>
      {WALLETS.map((w) => (
        <button
          key={w.id}
          type="button"
          className={styles.walletTile}
          onClick={() => onPick?.(w.id)}
        >
          <span className={`${styles.walletIcon} ${styles[`walletIcon_${w.tone}`]}`} aria-hidden>
            <WalletGlyph id={w.id} />
          </span>
          <span className={styles.walletLabel}>{w.label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Tiny brand-evocative SVG glyphs. Wallet brand logos are tradmarked;
 * these are abstract marks tinted in each wallet's signature color.
 */
function WalletGlyph({ id }) {
  const common = { width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (id) {
    case 'metamask':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M3 5l6 5-2 4 5 1 5-1-2-4 6-5-5 1-4-2-4 2-5-1z" />
          <circle cx="9" cy="13" r=".8" fill="currentColor" stroke="none" />
          <circle cx="15" cy="13" r=".8" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'rabby':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M5 13c0-4 3-7 7-7s7 3 7 7v3c0 1.1-.9 2-2 2H7a2 2 0 01-2-2v-3z" />
          <circle cx="9.5" cy="13" r=".9" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="13" r=".9" fill="currentColor" stroke="none" />
          <path d="M11 17h2" />
        </svg>
      )
    case 'phantom':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M5 11a7 7 0 0114 0v7l-3-2-3 2-3-2-3 2-2-1.5V11z" />
          <circle cx="10" cy="11" r=".9" fill="currentColor" stroke="none" />
          <circle cx="15" cy="11" r=".9" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'coinbase':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="8" />
          <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'rainbow':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M3 18a9 9 0 0118 0" />
          <path d="M6 18a6 6 0 0112 0" />
          <path d="M9 18a3 3 0 016 0" />
          <circle cx="12" cy="18" r=".9" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'ledger':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M9 10v5M15 10v5M12 9v7" />
        </svg>
      )
    case 'trust':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M12 4l7 3v6c0 4-3 6-7 7-4-1-7-3-7-7V7l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      )
    case 'walletconnect':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M5 11a9 9 0 0114 0" />
          <path d="M8 14a5 5 0 018 0" />
          <circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" />
        </svg>
      )
    default:
      return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="6" /></svg>
  }
}

/* ═══════════ Setup wizard atoms ═══════════ */
function SetupHeader({ index, kicker, title, sub }) {
  return (
    <header className={styles.setupHeader}>
      <span className={styles.setupKicker}>
        {index && <span className={styles.setupKickerIndex}>{index}</span>}
        {kicker}
      </span>
      <h1 className={`${shared.displayHeadline} ${styles.setupTitle}`}>{title}</h1>
      {sub && <p className={styles.setupSub}>{sub}</p>}
    </header>
  )
}

function BackFloat({ onBack }) {
  return (
    <button type="button" className={styles.backBtnFloat} onClick={onBack} aria-label="Back">
      <ChevronLeft />
    </button>
  )
}

function SetupFooter({ onNext, nextLabel = 'Continue', disabled, hint }) {
  return (
    <div className={styles.setupFooter}>
      {hint && <p className={styles.setupHint}>{hint}</p>}
      <SailButton fullWidth onClick={onNext} disabled={disabled}>
        {nextLabel}
        <ArrowRight />
      </SailButton>
    </div>
  )
}

/* ─────────── Step 2 · Choose networks (multi-select) ─────────── */
function NetworkState({ selected, onToggle, onBack, onNext }) {
  const count = selected.length
  return (
    <GlassCard className={styles.setupCard}>
      <BackFloat onBack={onBack} />
      <SetupHeader
        index="02 /"
        kicker="SELECT NETWORKS"
        title="Where will your SMAs live?"
        sub="Sail deploys an account on every network you select. Pick one or more, and add chains later too."
      />

      <div className={styles.listLabelRow}>
        <span className={styles.listLabel}>Commonly used</span>
        <span className={styles.listCount}>
          {count} selected
        </span>
      </div>
      <ul className={styles.optionList}>
        {NETWORKS.map((n) => {
          const active = selected.includes(n.id)
          return (
            <li key={n.id}>
              <button
                type="button"
                className={`${styles.optionRow} ${active ? styles.optionRowActive : ''}`}
                onClick={() => onToggle(n.id)}
                aria-pressed={active}
              >
                <span className={styles.optionTile} aria-hidden>
                  <ChainGlyph id={n.id} />
                </span>
                <span className={styles.optionBody}>
                  <span className={styles.optionNameRow}>
                    <span className={styles.optionName}>{n.name}</span>
                    {n.recommended && <span className={styles.optionTag}>Recommended</span>}
                    {n.kind === 'testnet' && <span className={styles.optionTagMuted}>Testnet</span>}
                  </span>
                  <span className={styles.optionSub}>{n.desc}</span>
                </span>
                <span className={styles.optionMeta}>chain {n.chainId}</span>
                <span className={styles.optionCheck} aria-hidden>
                  <MiniCheck />
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <SetupFooter
        onNext={onNext}
        nextLabel={count > 1 ? `Continue with ${count} networks` : 'Continue'}
        disabled={count === 0}
      />
    </GlassCard>
  )
}

/* ─────────── Step 3 · RPC endpoint + API key ─────────── */
function RpcState({ networks, provider, apiKey, onSelectProvider, onApiKey, onBack, onNext }) {
  const sel = RPC_PROVIDERS.find((p) => p.id === provider)
  const needsKey = !!sel?.needsKey
  const keyValid = !needsKey || apiKey.trim().length >= 12
  const netList = formatNetworkList(networks)
  const multi = networks.length > 1
  // The "where do I find my key" guide opens by default for keyed
  // providers so the steps are right there, and the user can collapse
  // it. The content swaps to whichever provider is selected.
  const [howOpen, setHowOpen] = useState(true)
  return (
    <GlassCard className={styles.setupCard}>
      <BackFloat onBack={onBack} />
      <SetupHeader
        index="03 /"
        kicker="RPC ENDPOINT"
        title="Connect to the chain"
        sub={`Your agent reads balances and submits transactions on ${netList} through an RPC endpoint. Pick a provider and paste its key${multi ? ' — one key covers every network you chose.' : '.'}`}
      />

      <span className={styles.listLabel}>Commonly used</span>
      <ul className={styles.optionList}>
        {RPC_PROVIDERS.map((p) => {
          const active = provider === p.id
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`${styles.optionRow} ${active ? styles.optionRowActive : ''}`}
                onClick={() => onSelectProvider(p.id)}
                aria-pressed={active}
              >
                <span className={styles.optionTile} aria-hidden>
                  <RpcGlyph id={p.id} />
                </span>
                <span className={styles.optionBody}>
                  <span className={styles.optionNameRow}>
                    <span className={styles.optionName}>{p.name}</span>
                    {p.tag && <span className={styles.optionTag}>{p.tag}</span>}
                    {!p.needsKey && <span className={styles.optionTagMuted}>No key</span>}
                  </span>
                  <span className={styles.optionSub}>{p.desc}</span>
                </span>
                <span className={styles.optionRadio} aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>

      {needsKey && (
        <>
          <div className={styles.fieldBlock}>
            <label className={styles.fieldLabel} htmlFor="rpc-key">
              {sel.name} API key
            </label>
            <div className={styles.field}>
              <span className={styles.fieldIcon} aria-hidden><KeyIcon /></span>
              <input
                id="rpc-key"
                type="text"
                className={styles.fieldInput}
                placeholder={sel.keyHint}
                value={apiKey}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => onApiKey(e.target.value)}
              />
              {keyValid && apiKey && (
                <span className={styles.fieldOk} aria-hidden><MiniCheck /></span>
              )}
            </div>
            <p className={styles.fieldNote}>
              Stored locally in <code>.sail/.env.local</code> as <code>RPC_URL</code>. Never sent to Sail.
            </p>
          </div>

          {/* Provider-specific "how to get your key" guide. Opens by
              default; collapsible. Swaps content per selected provider. */}
          <div className={styles.howBlock}>
            <button
              type="button"
              className={styles.howTrigger}
              onClick={() => setHowOpen((v) => !v)}
              aria-expanded={howOpen}
            >
              <span className={styles.howTriggerIcon} aria-hidden><InfoDot /></span>
              <span className={styles.howTriggerText}>
                Where do I find my {sel.name} key?
              </span>
              <span className={`${styles.howChevron} ${howOpen ? styles.howChevronOpen : ''}`} aria-hidden>
                <ChevronDown />
              </span>
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
                <a
                  className={styles.howLink}
                  href={sel.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {sel.urlLabel}
                  <ArrowUpRight />
                </a>
              </div>
            </div>
          </div>
        </>
      )}

      <SetupFooter
        onNext={onNext}
        disabled={!keyValid}
        hint={needsKey ? undefined : 'Public endpoints are rate-limited. Fine to start, swap in a keyed provider before automating.'}
      />
    </GlassCard>
  )
}

/* ─────────── Step 4 · Set password (double-entry) ─────────── */
function PasswordState({ onBack, onNext }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)

  const strength = scorePassword(pw)
  const longEnough = pw.length >= 8
  const matches = confirm.length > 0 && pw === confirm
  const mismatch = confirm.length > 0 && pw !== confirm
  const valid = longEnough && matches

  return (
    <GlassCard className={styles.setupCard}>
      <BackFloat onBack={onBack} />
      <SetupHeader
        index="04 /"
        kicker="SECURE YOUR AGENT KEY"
        title="Set a password"
        sub="Sail generates your agent's signing key and encrypts it on this device. This password unlocks it for every run. Sail never sees it."
      />

      <div className={styles.fieldBlock}>
        <label className={styles.fieldLabel} htmlFor="pw">Password</label>
        <div className={styles.field}>
          <span className={styles.fieldIcon} aria-hidden><LockIcon /></span>
          <input
            id="pw"
            type={show ? 'text' : 'password'}
            className={styles.fieldInput}
            placeholder="At least 8 characters"
            value={pw}
            autoComplete="new-password"
            onChange={(e) => setPw(e.target.value)}
          />
          <button
            type="button"
            className={styles.fieldToggle}
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff /> : <Eye />}
          </button>
        </div>

        {pw.length > 0 && (
          <div className={styles.strengthRow} aria-hidden>
            <span className={styles.strengthTrack}>
              <span
                className={`${styles.strengthFill} ${styles[`strength_${strength.level}`]}`}
                style={{ width: `${strength.pct}%` }}
              />
            </span>
            <span className={`${styles.strengthLabel} ${styles[`strengthText_${strength.level}`]}`}>
              {strength.label}
            </span>
          </div>
        )}
      </div>

      <div className={styles.fieldBlock}>
        <label className={styles.fieldLabel} htmlFor="pw-confirm">Confirm password</label>
        <div className={`${styles.field} ${mismatch ? styles.fieldError : matches ? styles.fieldValid : ''}`}>
          <span className={styles.fieldIcon} aria-hidden><LockIcon /></span>
          <input
            id="pw-confirm"
            type={show ? 'text' : 'password'}
            className={styles.fieldInput}
            placeholder="Re-enter your password"
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
          {matches && <span className={styles.fieldOk} aria-hidden><MiniCheck /></span>}
        </div>
        {mismatch && (
          <p className={styles.fieldErrorNote}>Passwords don&rsquo;t match yet.</p>
        )}
      </div>

      <ul className={styles.pwHints}>
        <li className={longEnough ? styles.pwHintOk : ''}>
          <MiniCheck /> 8 characters or more
        </li>
        <li className={matches ? styles.pwHintOk : ''}>
          <MiniCheck /> Both entries match
        </li>
        <li>
          <InfoDot /> No recovery. Store it in your password manager
        </li>
      </ul>

      <SetupFooter onNext={onNext} nextLabel="Encrypt &amp; continue" disabled={!valid} />
    </GlassCard>
  )
}

/* "Base", "Base and Arbitrum", "Base, Arbitrum, and Unichain" */
function formatNetworkList(nets) {
  const names = nets.map((n) => n.name)
  if (names.length === 0) return 'your network'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function scorePassword(pw) {
  if (!pw) return { level: 'weak', pct: 0, label: '' }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { level: 'weak', pct: 28, label: 'Weak' }
  if (score <= 3) return { level: 'fair', pct: 64, label: 'Fair' }
  return { level: 'strong', pct: 100, label: 'Strong' }
}

/* ─────────── Deploy review ─────────── */
function DeployState({ onSign, onBack, networks }) {
  const nets = networks?.length ? networks : [{ id: 'base', name: mockDeploy.network }]
  const multi = nets.length > 1
  return (
    <GlassCard className={styles.deployCard}>
      <button
        type="button"
        className={styles.backBtnFloat}
        onClick={onBack}
        aria-label="Back"
      >
        <ChevronLeft />
      </button>

      <div className={styles.deploySai} aria-hidden>
        <span className={styles.deploySaiHalo} />
        <Sai size={52} animate />
      </div>

      <header className={styles.deployHeader}>
        <span className={styles.kicker}>{multi ? 'DEPLOY YOUR ACCOUNTS' : 'DEPLOY YOUR ACCOUNT'}</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          {multi ? `Sign to create ${nets.length} SMAs` : 'Sign to create your SMA'}
        </h1>
        <p className={styles.cardSub}>
          {multi
            ? <>One signature per network creates your self-custody accounts.<br />No AI has access yet.</>
            : <>One signature creates a self-custody smart account.<br />No AI has access yet.</>}
        </p>
      </header>

      <span className={styles.softDivider} aria-hidden />

      <ul className={styles.deployPoints}>
        <li style={{ '--i': 0 }}>
          <Check />
          <div>
            <span className={styles.pointTitle}>You own this account</span>
            <span className={styles.pointSub}>Not Sail. Not the AI. Only you.</span>
          </div>
        </li>
        <li style={{ '--i': 1 }}>
          <Check />
          <div>
            <span className={styles.pointTitle}>Bounded delegation</span>
            <span className={styles.pointSub}>You set every constraint onchain.</span>
          </div>
        </li>
        <li style={{ '--i': 2 }}>
          <Check />
          <div>
            <span className={styles.pointTitle}>Revoke instantly</span>
            <span className={styles.pointSub}>One-tap revocation, always.</span>
          </div>
        </li>
      </ul>

      <div className={styles.txPanel}>
        <header className={styles.txPanelHeader}>
          <span className={styles.txPanelKicker}>What you are signing</span>
          <span className={styles.txPanelBadge}>
            {multi ? `${nets.length} networks` : nets[0].name}
          </span>
        </header>
        <dl className={styles.txDetails}>
          <Row k="Transaction" v={multi ? `Safe deployment ×${nets.length}` : mockDeploy.type} />
          <div className={styles.txRow}>
            <dt>{multi ? 'Networks' : 'Network'}</dt>
            <dd>
              <span className={styles.txNetChips}>
                {nets.map((n) => (
                  <span key={n.id} className={styles.txNetChip}>{n.name}</span>
                ))}
              </span>
            </dd>
          </div>
          <Row k="Gas estimate" v={mockDeploy.gasEstimate} accent />
        </dl>
        <div className={styles.txPanelFooter}>
          <RevealCalldata
            calldata={mockDeploy.calldata}
            label="View calldata"
            caption="The exact deployment payload."
          />
        </div>
      </div>

      <SailButton fullWidth onClick={onSign}>
        Sign &amp; deploy
      </SailButton>
      <p className={styles.fineprint}>
        Gas is paid from your connected wallet. You can revoke this account at any time.
      </p>
    </GlassCard>
  )
}

function Row({ k, v, accent }) {
  return (
    <div className={styles.txRow}>
      <dt>{k}</dt>
      <dd className={accent ? styles.gas : ''}>{v}</dd>
    </div>
  )
}

/* ─────────── Confirming ─────────── */
function ConfirmState({ progress }) {
  const confirmed = progress === 'confirmed'
  return (
    <GlassCard className={styles.confirmCard}>
      <div className={`${styles.confirmIndicator} ${confirmed ? styles.confirmDone : ''}`}>
        {confirmed ? (
          <svg viewBox="0 0 32 32" width="48" height="48" aria-hidden>
            <circle cx="16" cy="16" r="14" fill="none" stroke="var(--accent-blue)" strokeWidth="2" />
            <path
              d="M9 16.5l4.5 4.5L23 11"
              fill="none"
              stroke="var(--accent-blue)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span className={styles.pulse} />
        )}
      </div>
      <h2 className={`${shared.displayHeadline} ${styles.confirmHeadline}`}>
        {confirmed ? 'Account deployed.' : 'Waiting for your signature…'}
      </h2>
      <p className={styles.confirmSub}>
        {confirmed
          ? 'Taking you to your dashboard…'
          : 'Approve the deployment in your wallet to continue.'}
      </p>
    </GlassCard>
  )
}

/* ─────────── Shared atoms ─────────── */
function CardHeader({ kicker, title, sub, onBack }) {
  return (
    <header className={styles.cardHeader}>
      {onBack && (
        <button
          type="button"
          className={styles.backBtn}
          onClick={onBack}
          aria-label="Back"
        >
          <ChevronLeft />
        </button>
      )}
      <span className={styles.kicker}>{kicker}</span>
      <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>{title}</h1>
      {sub && <p className={styles.cardSub}>{sub}</p>}
    </header>
  )
}

function AuthButton({ variant, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.authBtn} ${styles[`authBtn_${variant}`]}`}
    >
      <span className={styles.authBtnIcon}>
        {variant === 'google' ? <GoogleIcon /> : <WalletIcon />}
      </span>
      <span>{children}</span>
    </button>
  )
}

function Divider({ label }) {
  return (
    <div className={styles.divider} role="separator" aria-orientation="horizontal">
      <span className={styles.dividerLine} />
      <span className={styles.dividerLabel}>{label}</span>
      <span className={styles.dividerLine} />
    </div>
  )
}

function FooterSwitch({ question, action, onClick }) {
  return (
    <p className={styles.footerSwitch}>
      <span className={styles.footerQuestion}>{question}</span>{' '}
      <button type="button" className={styles.footerAction} onClick={onClick}>
        {action}
      </button>
    </p>
  )
}

/* ─────────── Inline icons ─────────── */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.96h5.52c-.24 1.44-1.68 4.2-5.52 4.2-3.32 0-6.04-2.74-6.04-6.12s2.72-6.12 6.04-6.12c1.9 0 3.16.8 3.88 1.48l2.64-2.56C16.74 3.56 14.6 2.6 12 2.6c-5.16 0-9.36 4.2-9.36 9.36s4.2 9.36 9.36 9.36c5.4 0 8.98-3.8 8.98-9.16 0-.62-.06-1.08-.16-1.56H12z"/>
      <path fill="#FBBC05" d="M2.64 11.96l3.32 2.44c.46-1.44 1.7-2.4 3.04-2.84V8.62C6.16 9.16 3.48 11.2 2.64 11.96z" opacity=".0"/>
    </svg>
  )
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="14" r="4" />
      <path d="M11 12l9-7-2 4 2 1.5-2 2" />
    </svg>
  )
}

/* Monoline chain marks — abstract, brand-evocative, rendered white on
   the blueprint tile (no provider colours leak in). */
function ChainGlyph({ id }) {
  const c = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  switch (id) {
    case 'base':
      return <svg {...c}><circle cx="12" cy="12" r="8.2" /><path d="M12 6.5a5.5 5.5 0 100 11" /></svg>
    case 'arbitrum':
      return <svg {...c}><path d="M12 3.4l7.4 4.3v8.6L12 20.6l-7.4-4.3V7.7z" /><path d="M9 16l3-7 3 7M10 13.4h4" /></svg>
    case 'unichain':
      return <svg {...c}><circle cx="12" cy="12" r="8.2" /><path d="M12 5.5v8a3 3 0 003 3M12 18.5v-8a3 3 0 00-3-3" /></svg>
    case 'base-sepolia':
      return <svg {...c}><circle cx="12" cy="12" r="8.2" strokeDasharray="2.6 2.6" /><path d="M9 12l2 2 4-4.5" /></svg>
    default:
      return <svg {...c}><circle cx="12" cy="12" r="8" /></svg>
  }
}

/* Monoline RPC-provider marks. */
function RpcGlyph({ id }) {
  const c = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  switch (id) {
    case 'alchemy':
      return <svg {...c}><path d="M12 3.5l7 4v9l-7 4-7-4v-9z" /><path d="M12 8.5l3.4 2v3l-3.4 2-3.4-2v-3z" /></svg>
    case 'infura':
      return <svg {...c}><circle cx="12" cy="6.5" r="2" /><circle cx="6.5" cy="16" r="2" /><circle cx="17.5" cy="16" r="2" /><path d="M11 8.2l-3.6 6M13 8.2l3.6 6M8.5 16h7" /></svg>
    case 'public':
      return <svg {...c}><circle cx="12" cy="12" r="8.2" /><path d="M3.8 12h16.4M12 3.8c2.4 2.2 3.6 5 3.6 8.2s-1.2 6-3.6 8.2c-2.4-2.2-3.6-5-3.6-8.2S9.6 6 12 3.8z" /></svg>
    default:
      return <svg {...c}><circle cx="12" cy="12" r="8" /></svg>
  }
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
      <circle cx="12" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function Eye() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 4l16 16" />
      <path d="M9.8 5.8A9.3 9.3 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-2.6 3.3M6.6 7.6A16 16 0 002.5 12S6 18.5 12 18.5a9 9 0 003.2-.6" />
      <path d="M9.9 9.9a2.6 2.6 0 003.6 3.6" />
    </svg>
  )
}

function MiniCheck() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7.5l2.6 2.6L11 4" />
    </svg>
  )
}

function InfoDot() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7" cy="7" r="5.4" />
      <path d="M7 6.4v3.2M7 4.5v.1" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 5l3.5 3.5L10.5 5" />
    </svg>
  )
}

function ArrowUpRight() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 9 L9 5" />
      <path d="M5.4 5 H9 V8.6" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
    </svg>
  )
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

function Check() {
  return (
    <span className={styles.checkBubble} aria-hidden>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l5 5L20 7" />
      </svg>
    </span>
  )
}
