import { useEffect, useState } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { getAddress } from 'viem'
import { useAccount, useDisconnect, useSendTransaction, useSignTypedData, useSwitchChain } from 'wagmi'
import { getAccount } from 'wagmi/actions'
import { wagmiConfig } from '../../wagmi'
// Import from subpaths, not the '@sail/sdk' barrel: the barrel re-exports the Node-only
// keyring (node:crypto scryptSync), which breaks the browser (vite) build. safe/eip712 are
// viem-only and browser-safe.
import { buildRegisterAccountTypedData } from '@sail/sdk/eip712'
import { buildRegisterAccountExecTransaction } from '@sail/sdk/safe'
import { sailDeployments } from '@sail/sdk/deployments'
import { defaultRpcUrls } from '@sail/sdk/chains'
import { ChainGlyph, GlassCard, InfoTip, Sai, SailButton } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './OnboardingWizard.module.css'
import { useSigningSocket } from '../../hooks/useSigningSocket'

// Set to true when the welcome "Already have an SMA? Connect wallet" link starts
// a connect flow, so we can route onward once the wallet connects.
let _welcomeConnectPending = false

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
  // Testnets (Base/Ethereum Sepolia) are intentionally not offered in the UI.
]

// Steps that show progress dots (excludes welcome + done).
const PROGRESS_STEPS = ['network', 'connect', 'keygen', 'create-sma']

/**
 * Browser-driven onboarding wizard.
 * Handles steps 1–4; generates an AI prompt for steps 5–8 on the done screen.
 * Renders embedded in the dashboard's main column — the dashboard sidebar
 * provides the persistent chrome.
 *
 * Props:
 *   onboardState  — result of GET /api/onboard/state (or null while loading)
 *   onComplete    — called when the user clicks "Go to dashboard" on the done step
 */
export default function OnboardingWizard({ onboardState, onComplete, onActiveDeployChange, requestedStep, additional, onCancel }) {
  const { address } = useAccount()
  // Additional-SMA mode (creating another SMA from the dashboard): the owner is
  // already connected and the agent key already exists, so skip welcome / connect
  // / keygen and run just network → deploy.
  const [step, setStep] = useState(additional ? 'network' : 'welcome')
  // Multi-chain: user selects one or more chains; default to Base
  const [selectedChainIds, setSelectedChainIds] = useState([onboardState?.chainId ?? 8453])
  const [managerAddress, setManagerAddress] = useState(onboardState?.managerAddress ?? null)
  const [deployedSafes, setDeployedSafes] = useState([]) // [{ chainId, safe }]
  // Deployed chains are recorded HERE (not just in the deploy step) the moment
  // each chain succeeds, so navigating Back after a partial deploy can never
  // forget a live deployment — on re-entry those chains show as done and are
  // skipped, instead of being re-deployed into a CREATE2 revert.
  const recordDeployed = (result) => {
    if (!result?.safe) return
    setDeployedSafes(prev => prev.some(p => p.chainId === result.chainId) ? prev : [...prev, result])
  }
  // Fixed salt so the same Safe address is produced on every chain via CREATE2
  const [saltNonce] = useState(() => String(Date.now()))

  // Safety net: whenever the wizard unmounts for any reason, release the parent's
  // deploy-active flag so the onboard-state poll can never stay permanently
  // blocked. The normal exit paths (onComplete / onSkip) already clear it; this
  // covers every other unmount. Scoped to the whole wizard, NOT CreateSmaStep —
  // that inner step unmounts on the create-sma → done transition, which must keep
  // the flag held so the poll doesn't eject the user off the "done" summary.
  useEffect(() => () => { onActiveDeployChange?.(false) }, [])

  // The dashboard's Create buttons route into the flow while onboarding is
  // active: each click bumps `requestedStep` and the wizard jumps to that step.
  // Never honored mid-deploy: yanking CreateSmaStep out while its loop runs
  // would keep firing wallet prompts with no progress UI, and the welcome
  // screen's "no SMA found" copy would be wrong seconds after a chain deployed.
  useEffect(() => {
    if (!requestedStep?.name) return
    setStep(prev => (prev === 'create-sma' ? prev : requestedStep.name))
  }, [requestedStep])


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

  // Progress steps in order. Additional-SMA mode runs a shorter flow (network →
  // deploy, no connect/keygen), so the "STEP n OF m" counter reflects it.
  // Both first-run and additional-SMA run the same four steps. Additional mode
  // just starts at 'network' (no welcome) and shows confirmation states on the
  // connect + keygen steps, since the wallet is connected and the agent key
  // already exists — the steps stay visible, they don't silently skip.
  const flowSteps = PROGRESS_STEPS
  const progressIndex = flowSteps.indexOf(step)
  const progressTotal = flowSteps.length

  const stepBody = (
    <div key={step} className={styles.embeddedStage}>
      {step === 'welcome' && (
            <WelcomeState
              onStart={() => setStep('network')}
              onConnected={onComplete}
            />
          )}
          {step === 'network' && (
            <NetworkStep
              selected={selectedChainIds}
              onToggle={toggleChain}
              onBack={additional ? onCancel : () => setStep('welcome')}
              onDone={() => setStep('connect')}
              progressIndex={progressIndex}
              progressTotal={progressTotal}
            />
          )}
          {step === 'connect' && (
            <ConnectStep
              onBack={() => setStep('network')}
              onDone={() => setStep('keygen')}
              progressIndex={progressIndex}
              progressTotal={progressTotal}
            />
          )}
          {step === 'keygen' && (
            <KeygenStep
              existingAddress={onboardState?.managerAddress}
              onBack={() => setStep('connect')}
              onDone={(addr) => { setManagerAddress(addr); setStep('create-sma') }}
              progressIndex={progressIndex}
              progressTotal={progressTotal}
            />
          )}
          {step === 'create-sma' && (
            <CreateSmaStep
              owner={address}
              managerAddress={managerAddress ?? onboardState?.managerAddress}
              chainIds={selectedChainIds}
              saltNonce={saltNonce}
              deployedSoFar={deployedSafes}
              onChainDeployed={recordDeployed}
              // Step back to keygen. Connect/keygen no longer auto-advance when
              // already satisfied (they show confirmation states), so back-nav
              // through them is safe — no bounce.
              onBack={() => setStep('keygen')}
              onDone={(safes) => { safes.forEach(recordDeployed); setStep('done') }}
              onRunningChange={onActiveDeployChange}
              onRemoveChain={toggleChain}
              progressIndex={progressIndex}
              progressTotal={progressTotal}
            />
          )}
          {step === 'done' && (
            <DoneStep deployedSafes={deployedSafes} onComplete={onComplete} additional={additional} />
          )}
    </div>
  )

  // The steps render directly in the dashboard's main column — left-aligned, no
  // shell, no background, no card surface (the sidebar provides the chrome).
  return <div className={styles.embeddedRoot}>{stepBody}</div>
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
function WelcomeState({ onStart, onConnected }) {
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()

  // Once the wallet connects (from the "Connect wallet" link below), continue to
  // the dashboard — the backend surfaces the SMAs this owner already has. This is
  // purely "connect and go", not an add-a-new-SMA step.
  useEffect(() => {
    if (isConnected && _welcomeConnectPending) {
      _welcomeConnectPending = false
      onConnected?.()
    }
  }, [isConnected, onConnected])
  // Disarm on unmount (only) so a dismissed connect modal can't leave the flag
  // set — otherwise a later visit to this step while connected would silently
  // fire onConnected and eject the user to the dashboard.
  useEffect(() => () => { _welcomeConnectPending = false }, [])

  function handleConnect() {
    if (isConnected) { onConnected?.(); return }
    _welcomeConnectPending = true
    openConnectModal?.()
  }

  return (
    <GlassCard className={styles.welcomeCard}>
      <div className={styles.cardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.cardHeader}>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          Welcome to the Sailor Dashboard
        </h1>
        <p className={styles.cardSub}>
          Set up your SMA, scope what your agent can do, and monitor every on-chain action — all from one place.
        </p>
      </header>

      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={onStart}>Start setup →</SailButton>
      </div>
      <p className={styles.fineprint}>Self-custody. Sail never holds your keys.</p>
      {/* "Already have an SMA?" is pure connect-and-go: connect the owner wallet
          and land in the dashboard — the backend surfaces the SMAs this owner
          already has. No address entry here (that lives in the SMA-list modal as
          a fallback). This step only renders when the project has no SMA loaded,
          so a still-connected wallet means none was found for this owner yet. */}
      {onConnected && (
        isConnected ? (
          <p className={styles.welcomeConnectedNote}>
            Wallet connected · no SMA loaded in this project yet.
          </p>
        ) : (
          <button className={styles.skipLink} onClick={handleConnect}>
            Already have an SMA? Connect wallet →
          </button>
        )
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
        kicker={`STEP ${progressIndex + 1} OF ${progressTotal}`}
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
        {testnets.length > 0 && (
          <>
            <span className={styles.networkGroupLabel}>Testnet</span>
            <div className={styles.networkGrid}>
              {testnets.map(net => (
                <NetworkCard key={net.chainId} net={net} selected={selected.includes(net.chainId)} onToggle={onToggle} />
              ))}
            </div>
          </>
        )}
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
  const { disconnect } = useDisconnect()
  const { status, send } = useSigningSocket()
  // Was a wallet already connected when this step opened? If so, DON'T
  // auto-advance — render a confirmation so the step stays visible and the user
  // can switch owner wallets. Only a fresh connect (during this step) advances.
  // Captured once at mount, so returning here via Back also shows the confirm
  // state (no bounce).
  const [preConnected] = useState(isConnected)

  useEffect(() => {
    if (preConnected) {
      // Already connected on arrival: tell the signing daemon, but wait for the
      // explicit Continue rather than skipping the step.
      if (isConnected && address && status === 'connected') send({ type: 'wallet-connected', address })
      return
    }
    if (!isConnected || !address) return
    if (status === 'connected') { send({ type: 'wallet-connected', address }); onDone?.() }
    else if (status === 'disconnected') { onDone?.() }
  }, [preConnected, isConnected, address, status, send, onDone])

  // Already-connected confirmation: name the owner wallet, offer a switch,
  // continue explicitly. Keeps the step visible instead of silently skipping.
  if (preConnected && isConnected && address) {
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`
    return (
      <GlassCard className={styles.authCard}>
        <ProgressDots current={progressIndex} total={progressTotal} />
        <CardHeader
          kicker={`STEP ${progressIndex + 1} OF ${progressTotal}`}
          title="Connect your wallet"
          sub="This wallet owns the SMA and signs its mandates. It's already connected — continue, or switch to a different owner wallet."
          onBack={onBack}
        />
        <ul className={styles.confirmRows}>
          <li className={styles.confirmRow}>
            <div className={styles.confirmRowMain}>
              <span className={styles.confirmRowLabel}>
                Owner wallet
                <InfoTip label="What is the owner wallet?">
                  The wallet that owns and controls the SMA — it signs the mandates that scope what
                  your agent may do. You stay in full custody; Sail never holds your keys.
                </InfoTip>
              </span>
              <span className={styles.confirmRowValue}>{short} <span className={styles.confirmRowState}>· connected</span></span>
            </div>
            <button type="button" className={styles.confirmSwitch} onClick={() => disconnect()}>Switch wallet</button>
          </li>
        </ul>
        <SailButton fullWidth onClick={onDone}>Continue →</SailButton>
        <p className={styles.fineprint}>Self-custody. Sail never holds your keys.</p>
      </GlassCard>
    )
  }

  return (
    <GlassCard className={styles.authCard}>
      <ProgressDots current={progressIndex} total={progressTotal} />
      <CardHeader
        kicker={`STEP ${progressIndex + 1} OF ${progressTotal}`}
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
  // The project already had an agent key when this step opened → this is a
  // reuse, not a fresh generation. Drives the "no new passphrase" confirmation
  // copy. Captured once so it survives the /api/onboard/state re-sync below.
  const [reused] = useState(Boolean(existingAddress))

  // Race guard: `existingAddress` comes from /api/onboard/state, which may
  // resolve *after* this step mounts (fast click-through). Without this
  // re-sync a returning user who already has a manager key would be walked
  // through generating a second one. Never overrides a key generated here.
  useEffect(() => {
    if (existingAddress) setGenerated((g) => g ?? existingAddress)
  }, [existingAddress])

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
    if (!navigator?.clipboard?.writeText) return // don't claim "copied" without a clipboard
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <GlassCard className={styles.authCard}>
      <ProgressDots current={progressIndex} total={progressTotal} />
      <CardHeader
        kicker={`STEP ${progressIndex + 1} OF ${progressTotal}`}
        title={reused ? 'Agent key' : 'Set a passphrase'}
        sub={reused ? (
          <>
            <span className={styles.cardSubLead}>This project already has an encrypted agent wallet.</span>
            Your new SMA reuses it — there's no new passphrase to set.
          </>
        ) : (
          <>
            <span className={styles.cardSubLead}>
              Sail generates your agent wallet and encrypts it on this device.
            </span>
            This passphrase unlocks it for every run — Sail never sees it.
          </>
        )}
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
            <span className={styles.generatedKeyLabel}>Agent address{reused ? ' · reused' : ''}</span>
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
          {reused ? (
            <div className={styles.passphraseReminder}>
              <span style={{ opacity: 0.6, fontSize: 12 }}>
                This agent wallet and its passphrase were set up when the project was created and live in{' '}
                <code>.sail/</code>. Your new SMA delegates to this same agent — nothing to re-enter.
              </span>
            </div>
          ) : passphrase && (
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
// Turn a raw deploy error into plain guidance + a category so the row can offer
// the right next step (fund gas, switch/unsupported, or just retry/remove).
function classifyDeployError(raw) {
  const m = (raw || '').toLowerCase()
  // Marker thrown by deployChain when the wallet verifiably stayed on the
  // wrong chain after a switch attempt (e.g. wallets without custom-network
  // support cannot reach HyperEVM). Checked first: the raw provider error in
  // that state is generic and would fall through to the useless default.
  if (m.startsWith('wallet-switch-failed:')) {
    const name = raw.slice('wallet-switch-failed:'.length).trim() || 'this network'
    return { kind: 'switch', message: `Your wallet couldn't switch to ${name}. Some wallets don't support this network. Connect a wallet that does, like Rabby or MetaMask, and deploy again, or remove this chain.` }
  }
  if (/insufficient funds|exceeds the balance|not enough|gas required exceeds/.test(m)) {
    return { kind: 'gas', message: 'Your wallet has no gas on this chain. Add funds on this network, then deploy again — or remove this chain and add it later.' }
  }
  // Rejection is checked BEFORE unsupported: wallets phrase chain-switch
  // rejections as e.g. "User denied request to switch chain", which would
  // otherwise match the unsupported branch and wrongly tell the user to
  // remove a chain they only need to re-sign.
  if (/user rejected|user denied|rejected the request|denied transaction/.test(m)) {
    return { kind: 'rejected', message: 'Signature declined. Deploy again to sign, or remove this chain.' }
  }
  if (/unsupported chain|does not support|chain .*not configured|unrecognized chain|add.* chain to.* wallet|failed to switch|switch(ing)? chain/.test(m)) {
    return { kind: 'unsupported', message: "Your wallet doesn't support this chain. Remove it — you can always add it later." }
  }
  return { kind: 'error', message: raw || 'Something went wrong. Try again, or remove this chain.' }
}

// Add-network reproduces the SMA's address on a new chain from its stored saltNonce +
// params. If the deployed address diverges, the params no longer match the original
// deploy (most often a rotated signer) — throw so we never record a wrong/phantom SMA.
function assertSameSafe(deployed, expected) {
  if (deployed.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      "This SMA's address couldn't be reproduced on that chain (the signer may have been rotated). " +
      'Add the network from the CLI instead: sailor account deploy-chain --chain <id>.'
    )
  }
}

export function CreateSmaStep({ owner, managerAddress, chainIds, saltNonce, existingSafe, deployedSoFar = [], onChainDeployed, onBack, onDone, onRunningChange, onRemoveChain, progressIndex, progressTotal, compact = false, title, sub, cta }) {
  const { sendTransactionAsync } = useSendTransaction()
  const { signTypedDataAsync } = useSignTypedData()
  const { switchChainAsync } = useSwitchChain()

  // Per-chain status: 'pending' | 'switching' | 'building' | 'wallet' | 'confirming' | 'done' | 'error'.
  // Chains the parent already recorded as deployed (e.g. the user went Back
  // after a partial run) seed as 'done' so they are never re-deployed — a
  // second CREATE2 deploy of the same salt would only revert.
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries(chainIds.map(id => [id, deployedSoFar.some(d => d.chainId === id) ? 'done' : 'pending']))
  )
  const [errors, setErrors] = useState({})
  const [running, setRunning] = useState(false)
  const [deployed, setDeployed] = useState(() => deployedSoFar.filter(d => chainIds.includes(d.chainId))) // [{ chainId, safe }]

  function setStatus(chainId, status) {
    setStatuses(prev => ({ ...prev, [chainId]: status }))
  }
  function setError(chainId, msg) {
    setErrors(prev => ({ ...prev, [chainId]: msg }))
  }

  async function deployChain(chainId) {
    setStatus(chainId, 'switching')
    try {
      await switchChainAsync({ chainId })
    } catch (switchErr) {
      // Some connectors throw here even when the wallet is already on the
      // target chain, so the throw alone isn't conclusive — verify where the
      // wallet actually landed. Proceeding blind sends the deploy tx against
      // the wrong chain, which surfaces as a generic provider error that
      // classifyDeployError can't read (seen with wallets that have no
      // custom-network support trying to reach HyperEVM).
      const sm = (switchErr?.shortMessage || switchErr?.message || '').toLowerCase()
      if (/user rejected|user denied|rejected the request|denied/.test(sm)) throw switchErr
      const liveChainId = getAccount(wagmiConfig).chainId
      if (liveChainId != null && liveChainId !== chainId) {
        const name = SUPPORTED_NETWORKS.find((n) => n.chainId === chainId)?.name ?? `chain ${chainId}`
        throw new Error(`wallet-switch-failed: ${name}`)
      }
    }

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

      // Add-network mode (existingSafe set): this is the SAME SMA on a new chain, not a
      // new account. If the reproduced address doesn't match, the deploy used different
      // params (e.g. a rotated signer) — refuse rather than mint a phantom SMA. On a
      // match, DON'T hit /api/onboard/complete (the create path); the caller appends the
      // chain to the selected SMA.
      if (existingSafe) {
        assertSameSafe(safe, existingSafe)
        setStatus(chainId, 'done')
        return { chainId, safe }
      }
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

    // Add-network mode: same SMA on a new chain — guard the address and skip the
    // create path (see the register-path branch above for the full rationale).
    if (existingSafe) {
      assertSameSafe(safe, existingSafe)
      setStatus(chainId, 'done')
      return { chainId, safe }
    }
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
    let errored = false
    for (const chainId of chainIds) {
      if (statuses[chainId] === 'done' || statuses[chainId] === 'skipped') continue
      try {
        const result = await deployChain(chainId)
        results.push(result)
        setDeployed(prev => [...prev, result])
        // Record upward immediately — the parent keeps deployments across
        // Back/re-entry, so a partial run is never forgotten.
        onChainDeployed?.(result)
      } catch (err) {
        const msg = err?.shortMessage || err?.message || 'Failed'
        // UntrustedFactory = kernel config issue, not user error — skip, don't retry
        if (msg.includes('UntrustedFactory')) {
          setError(chainId, 'Factory not approved on this chain yet')
          setStatus(chainId, 'skipped')
        } else {
          // Mark this chain and KEEP GOING — one chain that can't deploy (no gas,
          // unsupported wallet, declined signature) must never block the others.
          // The row shows the reason and a Remove control; the user is never
          // locked. onRunningChange stays held so the poll can't eject them.
          errored = true
          setError(chainId, classifyDeployError(msg).message)
          setStatus(chainId, 'error')
        }
      }
    }
    setRunning(false)
    const settled = [...deployed, ...results]
    // Auto-advance only on a clean run — every chain deployed or was auto-skipped.
    // If any chain errored (needs gas / unsupported / declined), stay put so the
    // user can retry it, remove it (add later), or continue with what deployed.
    if (settled.length === 0) return
    if (!errored) onDone(settled)
  }

  const allSettled = chainIds.every(id => statuses[id] === 'done' || statuses[id] === 'skipped' || statuses[id] === 'error')
  const hasRetryableError = chainIds.some(id => statuses[id] === 'error')
  const anyDeployed = chainIds.some(id => statuses[id] === 'done') || deployed.length > 0

  return (
    <GlassCard className={`${styles.authCard} ${compact ? styles.authCardCompact : ''}`}>
      {!compact && <ProgressDots current={progressIndex} total={progressTotal} />}
      <CardHeader
        kicker={compact ? 'ADD NETWORK' : `STEP ${progressIndex + 1} OF ${progressTotal}`}
        title={title ?? 'Deploy your SMAs'}
        sub={sub ?? 'Same SMA address on every chain. Some chains need 2 transactions — your wallet will prompt for each. You can always add another network later from your dashboard.'}
        onBack={running ? undefined : onBack}
      />
      <div className={styles.chainDeployList}>
        {chainIds.map(chainId => {
          const net = SUPPORTED_NETWORKS.find(n => n.chainId === chainId)
          const status = statuses[chainId]
          const err = errors[chainId]
          const needsAttention = status === 'error' || status === 'skipped'
          // Never trap: any chain that isn't mid-deploy or already done can be
          // dropped (kept while there's more than one, so you're left with at
          // least one to deploy). Removed chains can be added later.
          const canRemove = onRemoveChain && !running && chainIds.length > 1 &&
            (status === 'pending' || status === 'error' || status === 'skipped')
          return (
            <div key={chainId} className={styles.chainDeployItem}>
              <div className={styles.chainDeployRow}>
                <ChainGlyph chainId={chainId} size={18} />
                <span className={styles.chainDeployName}>{net?.name ?? `Chain ${chainId}`}</span>
                <span className={`${styles.chainDeployStatus} ${styles[`chainStatus_${status}`] ?? ''}`}>
                  {status === 'pending' && '—'}
                  {status === 'switching' && 'Switching…'}
                  {status === 'building' && 'Building…'}
                  {status === 'wallet' && 'Confirm in wallet'}
                  {status === 'confirming' && 'Confirming…'}
                  {status === 'done' && '✓ Deployed'}
                  {status === 'skipped' && '⚠ Skipped'}
                  {status === 'error' && '✗ Needs attention'}
                </span>
              </div>
              {(needsAttention && err) && (
                <div className={styles.chainDeployNote}>
                  <span className={styles.chainDeployNoteText}>{err}</span>
                  {canRemove && (
                    <button type="button" className={styles.chainRemoveBtn} onClick={() => onRemoveChain(chainId)}>
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <Detail label="Owner" value={owner} />
      <Detail label="Agent key" value={managerAddress} />
      {!allSettled && (
        <SailButton fullWidth onClick={deployAll} disabled={running} style={{ marginTop: 14 }}>
          {running ? 'Deploying…' : (cta ?? 'Deploy SMAs')}
        </SailButton>
      )}
      {allSettled && hasRetryableError && (
        <SailButton fullWidth onClick={deployAll} disabled={running} style={{ marginTop: 14 }}>
          Retry flagged chains
        </SailButton>
      )}
      {allSettled && anyDeployed && (
        <SailButton fullWidth onClick={() => onDone(deployed)} style={{ marginTop: 14 }}>
          Continue →
        </SailButton>
      )}
      {allSettled && !anyDeployed && (
        <p className={styles.chainDeployEmpty}>
          Nothing deployed yet. Add gas and retry, remove the flagged chains, or go back to pick a different network — you can always add a chain later.
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
function DoneStep({ deployedSafes, onComplete, additional }) {
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
        <span className={styles.kicker}>{additional ? 'SMA CREATED' : 'SETUP COMPLETE'}</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          {additional ? 'New SMA is live.' : 'You’re all set.'}
        </h1>
        <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
          {chains ? `Your SMA is live on ${chains}.` : 'Your SMA is live.'}
        </p>
      </header>
      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={onComplete}>{additional ? 'Back to dashboard →' : 'Go to dashboard →'}</SailButton>
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
