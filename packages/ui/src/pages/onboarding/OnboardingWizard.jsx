import { useEffect, useState } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { getAddress } from 'viem'
import { useAccount, useSendTransaction, useSignTypedData, useSwitchChain } from 'wagmi'
// Import from subpaths, not the '@sail/sdk' barrel: the barrel re-exports the Node-only
// keyring (node:crypto scryptSync), which breaks the browser (vite) build. safe/eip712 are
// viem-only and browser-safe.
import { buildRegisterAccountTypedData } from '@sail/sdk/eip712'
import { buildRegisterAccountExecTransaction } from '@sail/sdk/safe'
import { sailDeployments } from '@sail/sdk/deployments'
import { defaultRpcUrls } from '@sail/sdk/chains'
import { ChainGlyph, GlassCard, InfoTip, Sai, SailButton } from '../shared'
import SailBackground from '../shared/SailBackground'
import shared from '../shared/shared.module.css'
import styles from './OnboardingWizard.module.css'
import dashStyles from '../dashboard/Dashboard.module.css'
import { useSigningSocket } from '../../hooks/useSigningSocket'

function truncateAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''
}

// Set to true when the onboarding header avatar button initiates a connect flow.
// Module-level so it survives component re-renders and re-mounts.
let _headerConnectPending = false
// Set to true when "Already have an SMA?" initiates a connect flow.
let _skipConnectPending = false

// topic0 of AccountRegistered(address indexed account, address indexed permissionSigner, address indexed manager)
const ACCOUNT_REGISTERED_TOPIC = '0x05f9a81a3b5e45d338f25347928e56b0aaaa0c65d4087a980c4e41370fcccfeb'

// live: chainIds with a deployed SailKernel — derived from the SDK deployment
// registry so it can never drift from getSailDeployment / @sail/sdk.
const LIVE_CHAIN_IDS = new Set(Object.keys(sailDeployments).map(Number))

const SUPPORTED_NETWORKS = [
  // ── Mainnets ──
  { chainId: 8453,   name: 'Base',           group: 'mainnet', description: 'Fast, cheap Coinbase L2.', color: '#0052ff' },
  { chainId: 42161,  name: 'Arbitrum One',   group: 'mainnet', description: 'Low-fee Ethereum L2.', color: '#28a0f0' },
  { chainId: 1,      name: 'Ethereum',       group: 'mainnet', description: 'The original chain.', color: '#627eea' },
  { chainId: 130,    name: 'Unichain',       group: 'mainnet', description: 'Uniswap-native L2.', color: '#ff007a' },
  { chainId: 10,     name: 'Optimism',       group: 'mainnet', description: 'OP Stack L2.', color: '#ff0420' },
  { chainId: 56,     name: 'BNB Smart Chain', group: 'mainnet', description: 'High-throughput BNB chain.', color: '#f3ba2f' },
  { chainId: 480,    name: 'World Chain',    group: 'mainnet', description: 'Worldcoin L2.', color: '#dfe3e8' },
  { chainId: 999,    name: 'HyperEVM',       group: 'mainnet', description: 'Hyperliquid EVM.', color: '#50d2c1' },
  { chainId: 4326,   name: 'MegaETH',        group: 'mainnet', description: 'Real-time EVM.', color: '#ffffff' },
  // ── Testnets ──
  { chainId: 84532,    name: 'Base Sepolia',     group: 'testnet', description: 'Free to experiment.', color: '#0052ff' },
  { chainId: 11155111, name: 'Ethereum Sepolia', group: 'testnet', description: 'Ethereum test network.', color: '#627eea' },
]

// Steps that show progress dots (excludes welcome + done).
const PROGRESS_STEPS = ['network', 'connect', 'keygen', 'create-sma']

/**
 * Browser-driven onboarding wizard.
 * Handles steps 1–4; generates an AI prompt for steps 5–8 on the done screen.
 *
 * Props:
 *   onboardState  — result of GET /api/onboard/state (or null while loading)
 *   onComplete    — called when the user clicks "Go to dashboard" on the done step
 */
function OnboardingHeader({ onSkip }) {
  const { isConnected, address } = useAccount()
  const { openConnectModal } = useConnectModal()

  useEffect(() => {
    if (isConnected && _headerConnectPending) {
      _headerConnectPending = false
      onSkip?.()
    }
  }, [isConnected, onSkip])

  function handleClick() {
    if (isConnected) {
      onSkip?.()
    } else {
      _headerConnectPending = true
      openConnectModal?.()
    }
  }

  return (
    <header className={dashStyles.header}>
      <button
        type="button"
        className={dashStyles.brand}
        aria-label="Sail"
      >
        <Sai size={48} animate />
      </button>
      <div className={dashStyles.topActionsPill}>
        <button
          type="button"
          className={dashStyles.avatarBtn}
          onClick={handleClick}
          aria-label={isConnected && address ? `Connected (${truncateAddr(address)})` : 'Connect wallet'}
          title={isConnected && address ? address : undefined}
        >
          <span className={dashStyles.avatarBtnMonogram} aria-hidden>
            {isConnected && address ? address.slice(2, 4).toUpperCase() : '—'}
          </span>
          <span className={dashStyles.avatarBtnAddr}>
            {isConnected && address ? truncateAddr(address) : 'Not connected'}
          </span>
        </button>
      </div>
    </header>
  )
}

export default function OnboardingWizard({ onboardState, onComplete, onSkip, onActiveDeployChange }) {
  const { address } = useAccount()
  const [step, setStep] = useState('welcome')
  // Multi-chain: user selects one or more chains; default to Base
  const [selectedChainIds, setSelectedChainIds] = useState([onboardState?.chainId ?? 8453])
  const [managerAddress, setManagerAddress] = useState(onboardState?.managerAddress ?? null)
  const [deployedSafes, setDeployedSafes] = useState([]) // [{ chainId, safe }]
  // Fixed salt so the same Safe address is produced on every chain via CREATE2
  const [saltNonce] = useState(() => String(Date.now()))

  // Safety net: whenever the wizard unmounts for any reason, release the parent's
  // deploy-active flag so the onboard-state poll can never stay permanently
  // blocked. The normal exit paths (onComplete / onSkip) already clear it; this
  // covers every other unmount. Scoped to the whole wizard, NOT CreateSmaStep —
  // that inner step unmounts on the create-sma → done transition, which must keep
  // the flag held so the poll doesn't eject the user off the "done" summary.
  useEffect(() => () => { onActiveDeployChange?.(false) }, [])


  // Note: we intentionally do NOT auto-advance past the welcome screen when a
  // wallet is already connected. The welcome screen is where the user chooses
  // between the three entry paths (start setup / import / connect-to-dashboard);
  // auto-advancing would force a connected user into the create flow and rob
  // them of the import choice. Connected users still skip the connect *action*
  // at the connect step (ConnectStep auto-continues when already connected).

  function toggleChain(chainId) {
    setSelectedChainIds(prev =>
      prev.includes(chainId)
        ? prev.filter(id => id !== chainId)
        : [...prev, chainId]
    )
  }

  const progressIndex = PROGRESS_STEPS.indexOf(step)

  return (
    <div className={styles.shell}>
      <SailBackground />
      {/* The header's connect-and-leave shortcut is one of the three welcome-screen
          entry points. Once the user has chosen "Start setup" (any step past
          welcome), the header must NOT navigate away — connecting the wallet is
          part of the flow and has to keep them in the wizard. So skip is only
          wired on the welcome step. */}
      <OnboardingHeader onSkip={step === 'welcome' ? (onSkip ?? onComplete) : undefined} />
      <main className={styles.stage}>
        <div key={step} className={styles.stageInner}>
          {step === 'welcome' && (
            <WelcomeState onStart={() => setStep('network')} onSkip={onSkip ?? onComplete} />
          )}
          {step === 'network' && (
            <NetworkStep
              selected={selectedChainIds}
              onToggle={toggleChain}
              onBack={() => setStep('welcome')}
              onDone={() => setStep('connect')}
              progressIndex={progressIndex}
              progressTotal={PROGRESS_STEPS.length}
            />
          )}
          {step === 'connect' && (
            <ConnectStep
              onBack={() => setStep('network')}
              onDone={() => setStep(onboardState?.hasManagerKey ? 'create-sma' : 'keygen')}
              progressIndex={progressIndex}
              progressTotal={PROGRESS_STEPS.length}
            />
          )}
          {step === 'keygen' && (
            <KeygenStep
              existingAddress={onboardState?.managerAddress}
              onBack={() => setStep('network')}
              onDone={(addr) => { setManagerAddress(addr); setStep('create-sma') }}
              progressIndex={progressIndex}
              progressTotal={PROGRESS_STEPS.length}
            />
          )}
          {step === 'create-sma' && (
            <CreateSmaStep
              owner={address}
              managerAddress={managerAddress ?? onboardState?.managerAddress}
              chainIds={selectedChainIds}
              saltNonce={saltNonce}
              onBack={() => setStep(onboardState?.hasManagerKey ? 'connect' : 'keygen')}
              onDone={(safes) => { setDeployedSafes(safes); setStep('done') }}
              onRunningChange={onActiveDeployChange}
              progressIndex={progressIndex}
              progressTotal={PROGRESS_STEPS.length}
            />
          )}
          {step === 'done' && (
            <DoneStep deployedSafes={deployedSafes} onComplete={onComplete} />
          )}
        </div>
      </main>
    </div>
  )
}

/* ── Progress dots ── */
function ProgressDots({ current, total }) {
  return (
    <div className={styles.progressDots}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`${styles.progressDot} ${i < current ? styles.progressDotDone : i === current ? styles.progressDotActive : ''}`}
        />
      ))}
    </div>
  )
}

/* ── Step 0: Welcome / setup overview ── */
function WelcomeState({ onStart, onSkip }) {
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()

  useEffect(() => {
    if (isConnected && _skipConnectPending) {
      _skipConnectPending = false
      onSkip?.()
    }
  }, [isConnected, onSkip])

  function handleSkip() {
    if (isConnected) {
      onSkip?.()
    } else {
      _skipConnectPending = true
      openConnectModal?.()
    }
  }

  return (
    <GlassCard className={styles.welcomeCard}>
      <div className={styles.cardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.cardHeader}>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          Welcome to the Sail Dashboard
        </h1>
        <p className={styles.cardSub}>
          Set up your SMA, scope what your agent can do, and monitor every on-chain action — all from one place.
        </p>
      </header>

      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={onStart}>Start setup →</SailButton>
      </div>
      <p className={styles.fineprint}>Self-custody. Sail never holds your keys.</p>
      {onSkip && (
        <button className={styles.skipLink} onClick={handleSkip}>
          Already have an SMA? Skip to dashboard →
        </button>
      )}
    </GlassCard>
  )
}

/* ── Step 1: Network selection (multi-select) ── */
function NetworkStep({ selected, onToggle, onBack, onDone, progressIndex, progressTotal }) {
  const mainnets = SUPPORTED_NETWORKS.filter(n => n.group === 'mainnet')
  const testnets = SUPPORTED_NETWORKS.filter(n => n.group === 'testnet')

  return (
    <GlassCard className={`${styles.authCard} ${styles.networkStepCard}`}>
      <ProgressDots current={progressIndex} total={progressTotal} />
      <CardHeader
        kicker="STEP 1 OF 4"
        title="Choose your networks"
        sub={
          <>
            <span className={styles.cardSubLead}>
              Same SMA address on every chain.{' '}
              <InfoTip label="What is an SMA?">
                Separately Managed Account — a self-custodial Safe that holds your capital. You stay
                the owner; the agent can only act within the mandate you set.
              </InfoTip>
            </span>
            Deployed at a deterministic address, so it’s identical everywhere.
          </>
        }
        onBack={onBack}
      />
      <div className={styles.networkSection}>
        <span className={styles.networkGroupLabel}>Mainnet</span>
        <div className={styles.networkGrid}>
          {mainnets.map(net => (
            <NetworkCard key={net.chainId} net={net} selected={selected.includes(net.chainId)} onToggle={onToggle} />
          ))}
        </div>
        <span className={styles.networkGroupLabel}>Testnet</span>
        <div className={styles.networkGrid}>
          {testnets.map(net => (
            <NetworkCard key={net.chainId} net={net} selected={selected.includes(net.chainId)} onToggle={onToggle} />
          ))}
        </div>
      </div>
      <SailButton fullWidth onClick={onDone} disabled={selected.length === 0}>
        {selected.length === 0
          ? 'Select at least one network'
          : 'Continue →'}
      </SailButton>
    </GlassCard>
  )
}

// Pick a check-mark ink that stays legible on the chain's brand colour: dark
// ink on light brands (white World/MegaETH, gold BNB), white on dark ones.
function checkInk(hex) {
  if (typeof hex !== 'string' || hex[0] !== '#') return '#fff'
  let h = hex.slice(1)
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#04060b' : '#fff'
}

// Sharp, square-capped check — the "precise · dark · electric" selection mark,
// a deliberate replacement for the soft Unicode tick.
function BrandCheck() {
  return (
    <svg viewBox="0 0 14 14" width="9" height="9" fill="none" aria-hidden>
      <path d="M2.5 7.4 L5.7 10.5 L11.5 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  )
}

// Square-shouldered padlock — the field glyph on the password inputs.
function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="1" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

// Show / hide password toggle glyph.
function EyeGlyph({ off }) {
  return off ? (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

// Local, display-only password-strength heuristic for the meter. It never leaves
// the browser and makes no security guarantee — it only drives the visual bar.
// level: 0 (empty) · 1 Weak · 2 Fair · 3 Good · 4 Strong.
function passwordStrength(pw) {
  if (!pw) return { level: 0, label: '' }
  let points = 0
  if (pw.length >= 8) points++
  if (pw.length >= 12) points++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points++
  if (/\d/.test(pw)) points++
  if (/[^A-Za-z0-9]/.test(pw)) points++
  const level = Math.min(4, Math.max(1, points))
  return { level, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][level] }
}

function NetworkCard({ net, selected, onToggle }) {
  const live = LIVE_CHAIN_IDS.has(net.chainId)
  return (
    <button
      type="button"
      className={`${styles.networkCard} ${selected ? styles.networkCardSelected : ''} ${!live ? styles.networkCardSoon : ''}`}
      onClick={() => live && onToggle(net.chainId)}
      style={{ '--net-color': live ? net.color : 'rgba(255,255,255,0.18)', '--net-ink': live ? checkInk(net.color) : '#fff' }}
      title={live ? undefined : 'Sail kernel coming soon'}
    >
      <span className={styles.networkLogo}>
        <ChainGlyph chainId={net.chainId} size={20} color={live ? undefined : 'rgba(255,255,255,0.25)'} />
      </span>
      <span className={styles.networkName}>{net.name}</span>
      <span className={styles.networkDesc}>{live ? net.description : 'Coming soon'}</span>
      {live && (
        <span className={`${styles.networkCheck} ${selected ? styles.networkCheckOn : ''}`}>
          {selected && <BrandCheck />}
        </span>
      )}
    </button>
  )
}

/* ── Step 2: Connect wallet ── */
function ConnectStep({ onBack, onDone, progressIndex, progressTotal }) {
  const { isConnected, address } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { status, send } = useSigningSocket()

  useEffect(() => {
    if (!isConnected || !address) return
    if (status === 'connected') {
      send({ type: 'wallet-connected', address })
      onDone?.()
    } else if (status === 'disconnected') {
      onDone?.()
    }
  }, [isConnected, address, status, send, onDone])

  return (
    <GlassCard className={styles.authCard}>
      <ProgressDots current={progressIndex} total={progressTotal} />
      <CardHeader
        kicker="STEP 2 OF 4"
        title="Connect your wallet"
        sub="This wallet sits at the center of your setup."
        onBack={onBack}
      />
      <ul className={styles.connectPoints}>
        <li className={styles.connectPoint}>
          <span className={styles.connectGlyph} aria-hidden />
          <span className={styles.connectBody}>
            <span className={styles.connectName}>
              Owns your{' '}
              <Term word="SMA">
                Separately Managed Account — the self-custodial Safe that holds your capital; you
                remain the owner.
              </Term>
            </span>
            <span className={styles.connectDetail}>The Safe that holds your funds — you stay the owner.</span>
          </span>
        </li>
        <li className={styles.connectPoint}>
          <span className={styles.connectGlyph} aria-hidden />
          <span className={styles.connectBody}>
            <span className={styles.connectName}>
              Governs your agent{' '}
              <InfoTip label="What is a mandate?">
                A mandate is the on-chain set of permission contracts registered to your account that
                define what the agent may do. Revocable anytime from your dashboard.
              </InfoTip>
            </span>
            <span className={styles.connectDetail}>Signs the mandates that scope what it can do.</span>
          </span>
        </li>
        <li className={styles.connectPoint}>
          <span className={styles.connectGlyph} aria-hidden />
          <span className={styles.connectBody}>
            <span className={styles.connectName}>Never trades for you</span>
            <span className={styles.connectDetail}>The agent does the trading — always within the mandate you set.</span>
          </span>
        </li>
      </ul>
      <SailButton fullWidth onClick={openConnectModal}>
        Connect wallet →
      </SailButton>
      <p className={styles.fineprint}>Self-custody. Sail never holds your keys.</p>
    </GlassCard>
  )
}

/* ── Step 3: Set a passphrase, then generate the delegated signer key ── */
function KeygenStep({ existingAddress, onBack, onDone, progressIndex, progressTotal }) {
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [reveal, setReveal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [generated, setGenerated] = useState(existingAddress ?? null)
  const [copied, setCopied] = useState(false)

  const strength = passwordStrength(passphrase)
  const meets8 = passphrase.length >= 8
  const matches = passphrase.length > 0 && passphrase === confirm
  const canSubmit = meets8 && matches

  async function generate() {
    if (!canSubmit) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/onboard/generate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setGenerated(data.address)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function copy(text) {
    navigator?.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <GlassCard className={styles.authCard}>
      <ProgressDots current={progressIndex} total={progressTotal} />
      <CardHeader
        kicker="STEP 3 OF 4"
        title="Set a passphrase"
        sub={
          <>
            <span className={styles.cardSubLead}>
              Sail generates your agent wallet and encrypts it on this device.
            </span>
            This passphrase unlocks it for every run — Sail never sees it.
          </>
        }
        onBack={onBack}
      />
      {!generated ? (
        <>
          <div className={styles.pwField}>
            <span className={styles.fieldLabel}>Passphrase</span>
            <div className={styles.inputWrap}>
              <span className={styles.inputIcon} aria-hidden><LockGlyph /></span>
              <input
                type={reveal ? 'text' : 'password'}
                className={styles.pwInput}
                placeholder="Enter a passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') generate() }}
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                className={styles.revealBtn}
                onClick={() => setReveal(v => !v)}
                aria-label={reveal ? 'Hide passphrase' : 'Show passphrase'}
              >
                <EyeGlyph off={reveal} />
              </button>
            </div>
            <div className={styles.strengthRow} data-level={strength.level}>
              <span className={styles.strengthTrack}>
                <span className={styles.strengthFill} style={{ width: `${(strength.level / 4) * 100}%` }} />
              </span>
              <span className={styles.strengthLabel}>{strength.label}</span>
            </div>
          </div>

          <div className={styles.pwField}>
            <span className={styles.fieldLabel}>Confirm passphrase</span>
            <div className={styles.inputWrap}>
              <span className={styles.inputIcon} aria-hidden><LockGlyph /></span>
              <input
                type={reveal ? 'text' : 'password'}
                className={styles.pwInput}
                placeholder="Re-enter your passphrase"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') generate() }}
                autoComplete="new-password"
              />
            </div>
          </div>

          <ul className={styles.reqList}>
            <li className={`${styles.reqItem} ${meets8 ? styles.reqMet : ''}`}>
              <span className={styles.reqIcon} aria-hidden><BrandCheck /></span>
              8 characters or more
            </li>
            <li className={`${styles.reqItem} ${matches ? styles.reqMet : ''}`}>
              <span className={styles.reqIcon} aria-hidden><BrandCheck /></span>
              Both entries match
            </li>
          </ul>

          {error && <p className={styles.pwError}>{error}</p>}
          <SailButton
            fullWidth
            onClick={generate}
            disabled={loading || !canSubmit}
          >
            {loading ? 'Encrypting…' : 'Encrypt & continue →'}
          </SailButton>
          <p className={`${styles.fineprint} ${styles.keygenNote}`}>
            It's saved to <code>.sail/.env.local</code> (mode 0600) so your agent can unlock the key unattended.
          </p>
        </>
      ) : (
        <>
          <div className={styles.generatedKey}>
            <span className={styles.generatedKeyLabel}>Agent address</span>
            <button
              type="button"
              className={styles.generatedKeyAddr}
              onClick={() => copy(generated)}
              title="Copy address"
            >
              <code>{generated}</code>
              <span className={styles.copyHint}>{copied ? '✓' : 'copy'}</span>
            </button>
          </div>
          {passphrase && (
            <div className={styles.passphraseReminder}>
              <span style={{ opacity: 0.6, fontSize: 12 }}>
                Saved locally to <code>.sail/.env.local</code> (0600, gitignored). For CI, add this same
                value as the <code>SAIL_PASSPHRASE</code> GitHub Actions secret — don't commit{' '}
                <code>.env.local</code>.
              </span>
            </div>
          )}
          <SailButton fullWidth onClick={() => onDone(generated)}>Continue →</SailButton>
        </>
      )}
    </GlassCard>
  )
}

/* ── Step 4: Deploy SMAs — one per selected chain ── */
function CreateSmaStep({ owner, managerAddress, chainIds, saltNonce, onBack, onDone, onRunningChange, progressIndex, progressTotal }) {
  const { sendTransactionAsync } = useSendTransaction()
  const { signTypedDataAsync } = useSignTypedData()
  const { switchChainAsync } = useSwitchChain()

  // Per-chain status: 'pending' | 'switching' | 'building' | 'wallet' | 'confirming' | 'done' | 'error'
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries(chainIds.map(id => [id, 'pending']))
  )
  const [errors, setErrors] = useState({})
  const [running, setRunning] = useState(false)
  const [deployed, setDeployed] = useState([]) // [{ chainId, safe }]

  function setStatus(chainId, status) {
    setStatuses(prev => ({ ...prev, [chainId]: status }))
  }
  function setError(chainId, msg) {
    setErrors(prev => ({ ...prev, [chainId]: msg }))
  }

  async function deployChain(chainId) {
    setStatus(chainId, 'switching')
    try { await switchChainAsync({ chainId }) } catch { /* user may already be on this chain */ }

    setStatus(chainId, 'building')
    const buildRes = await fetch('/api/onboard/build-create-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner, manager: managerAddress, chainId, saltNonce }),
    })
    const body = await buildRes.json()
    if (!buildRes.ok) throw new Error(body?.error ?? 'Build failed')

    // Simulate before sending. Any revert (not just UntrustedFactory) means the
    // kernel.createAccount path won't work → fall back to the two-step register path.
    // This handles both "factory not trusted" (UntrustedFactory error) and any other
    // revert the selective kernel might produce with this factory on this chain.
    const rpc = PUBLIC_RPC[chainId]
    let useRegisterPath = false
    if (rpc) {
      const sim = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ from: owner, to: body.to, data: body.data }, 'latest'] }),
      }).then(r => r.json()).catch(() => null)

      // Fall back to register path for ANY simulation revert — not just UntrustedFactory.
      // On Arbitrum (selective kernel), the factory may be untrusted with a different
      // error encoding than Base, or createAccount may have a different failure mode.
      if (sim?.error) {
        useRegisterPath = true
      }
    }

    if (useRegisterPath) {
      // Two-step path: deploy Safe directly via factory, then registerAccount on kernel.
      // Post-Protocol #53 registerAccount is 6-arg and requires (a) msg.sender == the Safe
      // and (b) a Safe owner signature over the RegisterAccount EIP-712 digest. So the owner
      // signs the digest, then submits registerAccount wrapped in the Safe's execTransaction
      // (msg.sender == Safe), rather than calling the kernel directly from their EOA.
      //   permissionSigner = owner (user's wallet — signs mandates)
      //   manager = managerAddress (agent wallet — signs dispatches)
      //   feePolicy / feeAsset = address(0)
      setStatus(chainId, 'building')
      const pathRes = await fetch('/api/onboard/build-register-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, manager: managerAddress, chainId, saltNonce }),
      })
      const path = await pathRes.json()
      if (!pathRes.ok) throw new Error(path?.error ?? 'Build failed')

      // Step 1: deploy Safe directly via factory
      setStatus(chainId, 'wallet')
      const deployHash = await sendTransactionAsync({ to: path.deployTx.to, data: path.deployTx.data, chainId })
      setStatus(chainId, 'confirming')
      const deployReceipt = await waitForReceipt(deployHash, chainId)

      // Parse the Safe address from ProxyCreation event (topic[1] = proxy address, indexed)
      // ProxyCreation(address indexed proxy, address singleton) — factory emits this
      const proxyLog = deployReceipt?.logs?.find(
        l => l.address?.toLowerCase() === path.deployTx.to.toLowerCase() && l.topics?.length >= 2
      )
      if (!proxyLog) throw new Error('ProxyCreation event not found in deploy receipt')
      const safe = getAddress(`0x${proxyLog.topics[1].slice(26)}`)

      // Step 2: register with the kernel via the Safe (post-#53 two-step path).
      // permissionSigner = owner (NOT the safe address); feePolicy/feeAsset = address(0).
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

      // 2a. Owner signs the RegisterAccount EIP-712 digest (a real ECDSA sig — #69 forbids
      //     the Safe approved-hash shortcut for this ownerSig). The same `deadline` is bound
      //     into both the signed digest and the on-chain call below.
      setStatus(chainId, 'wallet')
      const td = buildRegisterAccountTypedData({
        chainId,
        kernel: path.kernel,
        account: safe,
        permissionSigner: owner,
        manager: managerAddress,
        feePolicy: ZERO_ADDRESS,
        feeAsset: ZERO_ADDRESS,
        deadline,
      })
      const ownerSig = await signTypedDataAsync({
        domain: td.domain,
        types: td.types,
        primaryType: td.primaryType,
        // buildRegisterAccountTypedData emits JSON-safe values (uint256 as decimal strings).
        // Re-parse deadline to BigInt so the signing payload matches the numeric type across
        // signTypedData implementations (same convention as the SigningPage).
        message: { ...td.message, deadline: BigInt(td.message.deadline) },
      })

      // 2b. Wrap registerAccount(...) in the Safe's execTransaction so msg.sender == the Safe.
      //     The execTransaction is authorised by the sole-owner pre-validated signature.
      const exec = buildRegisterAccountExecTransaction({
        safe,
        kernel: path.kernel,
        permissionSigner: owner,
        manager: managerAddress,
        feePolicy: ZERO_ADDRESS,
        feeAsset: ZERO_ADDRESS,
        deadline,
        ownerSig,
        owner,
      })
      setStatus(chainId, 'wallet')
      const registerHash = await sendTransactionAsync({ to: exec.to, data: exec.data, chainId })
      setStatus(chainId, 'confirming')
      const registerReceipt = await waitForReceipt(registerHash, chainId)
      if (registerReceipt?.status === '0x0') throw new Error('registerAccount reverted — check the kernel address and try again.')

      const completeRes1 = await fetch('/api/onboard/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ safe, owner, manager: managerAddress, txHash: registerHash, chainId, saltNonce }),
      })
      const completeData1 = await completeRes1.json()
      if (completeData1?.account) {
        try { localStorage.setItem('sail.account', JSON.stringify(completeData1.account)) } catch {}
      }
      setStatus(chainId, 'done')
      return { chainId, safe }
    }

    // Direct path: kernel.createAccount (conjunctive kernels / chains where factory is trusted)
    setStatus(chainId, 'wallet')
    const hash = await sendTransactionAsync({ to: body.to, data: body.data, chainId })

    setStatus(chainId, 'confirming')
    const receipt = await waitForReceipt(hash, chainId)
    // Check tx status before looking for the event — a reverted tx has no logs.
    if (receipt?.status === '0x0') {
      throw new Error('createAccount transaction reverted. The Safe factory may not be supported on this chain — try again and the wizard will use the register path.')
    }
    const log = receipt?.logs?.find(l => l.topics?.[0] === ACCOUNT_REGISTERED_TOPIC)
    if (!log) throw new Error('AccountRegistered event not found in receipt. This may be a kernel version mismatch — please report this.')
    const safe = getAddress(`0x${log.topics[1].slice(26)}`)

    const completeRes2 = await fetch('/api/onboard/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safe, owner, manager: managerAddress, txHash: hash, chainId, saltNonce }),
    })
    const completeData2 = await completeRes2.json()
    if (completeData2?.account) {
      try { localStorage.setItem('sail.account', JSON.stringify(completeData2.account)) } catch {}
    }
    setStatus(chainId, 'done')
    return { chainId, safe }
  }

  async function deployAll() {
    setRunning(true)
    // Suppress the parent's onboard-state poll for the rest of the wizard's life:
    // account.json is written per-chain, so from the first success onward the poll
    // would otherwise detect an account and eject the user. The parent releases
    // this on the real exit paths (Go to dashboard / Skip) and on wizard unmount —
    // NOT at loop end, so the error/retry and "done" screens stay visible.
    onRunningChange?.(true)
    const results = []
    for (const chainId of chainIds) {
      if (statuses[chainId] === 'done' || statuses[chainId] === 'skipped') continue
      try {
        const result = await deployChain(chainId)
        results.push(result)
        setDeployed(prev => [...prev, result])
      } catch (err) {
        const msg = err?.shortMessage || err?.message || 'Failed'
        // UntrustedFactory = kernel config issue, not user error — skip, don't retry
        if (msg.includes('UntrustedFactory')) {
          setError(chainId, 'Factory not approved on this chain yet')
          setStatus(chainId, 'skipped')
          // Continue to next chain rather than stopping
        } else {
          setError(chainId, msg)
          setStatus(chainId, 'error')
          setRunning(false)
          // Do NOT release onRunningChange here: the wizard stays on this step
          // showing "Retry failed chains", and the parent's poll must remain
          // suppressed so it doesn't unmount the wizard before the user retries.
          return // stop on real errors — user retries
        }
      }
    }
    setRunning(false)
    const settled = [...deployed, ...results]
    // Every chain was skipped (e.g. UntrustedFactory everywhere): nothing was
    // deployed and no account.json was written. Do NOT navigate to the "done"
    // summary — it would falsely claim "Your SMA is live". Stay on this step so
    // the in-place "No chains deployed successfully" branch shows the reasons.
    // onRunningChange stays held; the wizard-unmount safety net releases it.
    if (settled.length === 0) return
    onDone(settled) // pass whatever succeeded
  }

  const allSettled = chainIds.every(id => statuses[id] === 'done' || statuses[id] === 'skipped' || statuses[id] === 'error')
  const hasRetryableError = chainIds.some(id => statuses[id] === 'error')
  const anyDeployed = chainIds.some(id => statuses[id] === 'done') || deployed.length > 0

  return (
    <GlassCard className={styles.authCard}>
      <ProgressDots current={progressIndex} total={progressTotal} />
      <CardHeader
        kicker="STEP 4 OF 4"
        title="Deploy your SMAs"
        sub="Same SMA address on every chain. Some chains need 2 transactions — your wallet will prompt for each."
        onBack={running ? undefined : onBack}
      />
      <div className={styles.chainDeployList}>
        {chainIds.map(chainId => {
          const net = SUPPORTED_NETWORKS.find(n => n.chainId === chainId)
          const status = statuses[chainId]
          const err = errors[chainId]
          return (
            <div key={chainId} className={styles.chainDeployRow}>
              <ChainGlyph chainId={chainId} size={18} />
              <span className={styles.chainDeployName}>{net?.name ?? `Chain ${chainId}`}</span>
              <span className={`${styles.chainDeployStatus} ${styles[`chainStatus_${status}`]}`}>
                {status === 'pending' && '—'}
                {status === 'switching' && 'Switching…'}
                {status === 'building' && 'Building…'}
                {status === 'wallet' && 'Confirm in wallet'}
                {status === 'confirming' && 'Confirming…'}
                {status === 'done' && '✓ Deployed'}
                {status === 'skipped' && `⚠ ${err ?? 'Skipped'}`}
                {status === 'error' && `✗ ${err ?? 'Error'}`}
              </span>
            </div>
          )
        })}
      </div>
      <Detail label="Owner" value={owner} />
      <Detail label="Agent key" value={managerAddress} />
      {!allSettled && (
        <SailButton fullWidth onClick={deployAll} disabled={running} style={{ marginTop: 14 }}>
          {running ? 'Deploying…' : 'Deploy SMAs'}
        </SailButton>
      )}
      {allSettled && hasRetryableError && (
        <SailButton fullWidth onClick={deployAll} disabled={running} style={{ marginTop: 14 }}>
          Retry failed chains
        </SailButton>
      )}
      {allSettled && anyDeployed && (
        <SailButton fullWidth onClick={() => onDone(deployed)} style={{ marginTop: 14 }}>
          Continue →
        </SailButton>
      )}
      {allSettled && !anyDeployed && (
        <p style={{ color: '#f87171', fontSize: 13, margin: '14px 0 0', textAlign: 'center' }}>
          No chains deployed successfully. Go back and select a supported network.
        </p>
      )}
      <p className={styles.fineprint}>
        Same address on all chains — deterministic CREATE2 deployment with a fixed salt.
      </p>
    </GlassCard>
  )
}

// Public RPC endpoints for simulation + receipt polling, sourced from the SDK
// chain registry (single source of truth) so this can never drift from
// getSailDeployment / @sail/sdk. Covers exactly LIVE_CHAIN_IDS.
const PUBLIC_RPC = defaultRpcUrls

// Poll for a transaction receipt (public client not available as hook here).
async function waitForReceipt(hash, chainId) {
  const rpc = PUBLIC_RPC[chainId]
  if (!rpc) throw new Error(`No public RPC for chain ${chainId}`)
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
      })
      const { result } = await res.json()
      if (result) return result
    } catch { /* retry */ }
  }
  throw new Error('Receipt timeout')
}

function Detail({ label, value, mono = true }) {
  const display = mono && value && value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : (value || '—')
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      {mono
        ? <code className={styles.detailValue}>{display}</code>
        : <span className={styles.detailValue}>{display}</span>}
    </div>
  )
}

/* ── Step 5: Done ── */
function DoneStep({ deployedSafes, onComplete }) {
  const chains = deployedSafes
    .map(({ chainId }) => SUPPORTED_NETWORKS.find(n => n.chainId === chainId)?.name)
    .filter(Boolean)
    .join(' + ')

  return (
    <GlassCard className={styles.welcomeCard}>
      <div className={styles.cardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.cardHeader}>
        <span className={styles.kicker}>SETUP COMPLETE</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          You’re all set.
        </h1>
        <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
          {chains ? `Your SMA is live on ${chains}.` : 'Your SMA is live.'}
        </p>
      </header>
      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={onComplete}>Go to dashboard →</SailButton>
      </div>
      <p className={styles.fineprint}>Manage your agent, mandates and RPCs from your dashboard.</p>
    </GlassCard>
  )
}

/* ── Shared atoms ── */
/* Inline glossary term (F13): the word followed by an InfoTip whose tooltip
   defines it in plain language — lowers the DeFi-knowledge barrier without
   cluttering the copy. */
function Term({ word, children }) {
  return (
    <>
      {word}
      <InfoTip label={word}>{children}</InfoTip>
    </>
  )
}

function CardHeader({ kicker, title, sub, onBack }) {
  return (
    <header className={styles.cardHeader}>
      {onBack && (
        <button type="button" className={styles.backBtn} onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      )}
      <span className={styles.kicker}>{kicker}</span>
      <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>{title}</h1>
      {sub && <p className={styles.cardSub}>{sub}</p>}
    </header>
  )
}
