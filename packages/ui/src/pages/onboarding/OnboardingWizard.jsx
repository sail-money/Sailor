import { useEffect, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { getAddress } from 'viem'
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi'
import { FluidBackground, GlassCard, Sai, SailButton } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './OnboardingWizard.module.css'
import { useSigningSocket } from '../../hooks/useSigningSocket'

// topic0 of AccountRegistered(address indexed account, address indexed permissionSigner, address indexed manager)
const ACCOUNT_REGISTERED_TOPIC = '0x05f9a81a3b5e45d338f25347928e56b0aaaa0c65d4087a980c4e41370fcccfeb'

// live: chainIds with a deployed SailKernel
const LIVE_CHAIN_IDS = new Set([8453, 84532, 42161])

const SUPPORTED_NETWORKS = [
  // ── Mainnets ──
  { chainId: 8453,   name: 'Base',           group: 'mainnet', description: 'Fast, cheap Coinbase L2.', color: '#0052ff' },
  { chainId: 42161,  name: 'Arbitrum One',   group: 'mainnet', description: 'Low-fee Ethereum L2.', color: '#28a0f0' },
  { chainId: 1,      name: 'Ethereum',       group: 'mainnet', description: 'The original chain.', color: '#627eea' },
  { chainId: 130,    name: 'Unichain',       group: 'mainnet', description: 'Uniswap-native L2.', color: '#ff007a' },
  // ── Testnets ──
  { chainId: 84532,    name: 'Base Sepolia',     group: 'testnet', description: 'Free to experiment.', color: '#0052ff' },
  { chainId: 421614,   name: 'Arbitrum Sepolia', group: 'testnet', description: 'Arbitrum test network.', color: '#28a0f0' },
  { chainId: 11155111, name: 'Ethereum Sepolia', group: 'testnet', description: 'Ethereum test network.', color: '#627eea' },
  { chainId: 1301,     name: 'Unichain Sepolia', group: 'testnet', description: 'Unichain test network.', color: '#ff007a' },
]

const SETUP_STAGES = [
  {
    group: 'In this app',
    color: 'rgba(255,255,255,0.75)',
    items: [
      { n: 1, name: 'Choose your network',  detail: 'Base, Arbitrum, Ethereum, Unichain…' },
      { n: 2, name: 'Connect your wallet',  detail: 'Becomes the owner of your Safe' },
      { n: 3, name: 'Create agent key',     detail: 'Signs transactions on your behalf' },
      { n: 4, name: 'Deploy your Safe',     detail: 'One-time gas payment, permanent account' },
    ],
  },
  {
    group: 'In your terminal (with AI)',
    color: 'rgba(255,255,255,0.35)',
    items: [
      { n: 5, name: 'Configure RPC & API keys', detail: 'Add to .sail/.env.local' },
      { n: 6, name: 'Fund agent key',           detail: 'Small ETH for gas' },
      { n: 7, name: 'Set permissions',           detail: 'sailor mandate prepare → sign here' },
      { n: 8, name: 'Start agent',               detail: 'sailor run' },
    ],
  },
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
export default function OnboardingWizard({ onboardState, onComplete }) {
  const { isConnected, address } = useAccount()
  const [step, setStep] = useState('welcome')
  const [selectedChainId, setSelectedChainId] = useState(onboardState?.chainId ?? 8453)
  const [managerAddress, setManagerAddress] = useState(onboardState?.managerAddress ?? null)
  const [safeAddress, setSafeAddress] = useState(null)

  // Resume from the right step when the page refreshes with wallet still connected.
  useEffect(() => {
    if (!isConnected) return
    if (onboardState?.hasManagerKey) setStep('create-sma')
    else setStep('keygen')
  }, [isConnected, onboardState?.hasManagerKey])

  const progressIndex = PROGRESS_STEPS.indexOf(step)

  return (
    <div className={styles.shell}>
      <FluidBackground />
      <main className={styles.stage}>
        <div key={step} className={styles.stageInner}>
          {step === 'welcome' && (
            <WelcomeState onStart={() => setStep('network')} />
          )}
          {step === 'network' && (
            <NetworkStep
              selected={selectedChainId}
              onSelect={setSelectedChainId}
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
              onDone={(addr) => { setManagerAddress(addr); setStep('create-sma') }}
              progressIndex={progressIndex}
              progressTotal={PROGRESS_STEPS.length}
            />
          )}
          {step === 'create-sma' && (
            <CreateSmaStep
              owner={address}
              managerAddress={managerAddress ?? onboardState?.managerAddress}
              chainId={selectedChainId}
              onDone={(safe) => { setSafeAddress(safe); setStep('done') }}
              progressIndex={progressIndex}
              progressTotal={PROGRESS_STEPS.length}
            />
          )}
          {step === 'done' && (
            <DoneStep safeAddress={safeAddress} chainId={selectedChainId} onComplete={onComplete} />
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
function WelcomeState({ onStart }) {
  return (
    <GlassCard className={styles.welcomeCard}>
      <div className={styles.cardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.cardHeader}>
        <span className={styles.kicker}>WELCOME TO SAIL</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          Your AI agent, on-chain.
        </h1>
      </header>

      <div className={styles.stageList}>
        {SETUP_STAGES.map((group) => (
          <div key={group.group} className={styles.stageGroup}>
            <span className={styles.stageGroupLabel}>{group.group}</span>
            {group.items.map((item) => (
              <div key={item.n} className={styles.stageRow}>
                <span className={styles.stageNum} style={{ color: group.color }}>{item.n}</span>
                <span className={styles.stageBody}>
                  <span className={styles.stageName} style={{ color: group.color }}>{item.name}</span>
                  <span className={styles.stageDetail}>{item.detail}</span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={onStart}>Start setup →</SailButton>
      </div>
      <p className={styles.fineprint}>Self-custody. Sail never holds your keys.</p>
    </GlassCard>
  )
}

/* ── Step 1: Network selection ── */
function NetworkStep({ selected, onSelect, onBack, onDone, progressIndex, progressTotal }) {
  const mainnets = SUPPORTED_NETWORKS.filter(n => n.group === 'mainnet')
  const testnets = SUPPORTED_NETWORKS.filter(n => n.group === 'testnet')
  const selectedNet = SUPPORTED_NETWORKS.find(n => n.chainId === selected)

  return (
    <GlassCard className={styles.authCard}>
      <ProgressDots current={progressIndex} total={progressTotal} />
      <CardHeader
        kicker="STEP 1 OF 4"
        title="Choose your network"
        sub="Your agent will operate on this chain. You can add more chains later."
        onBack={onBack}
      />
      <div className={styles.networkSection}>
        <span className={styles.networkGroupLabel}>Mainnet</span>
        <div className={styles.networkGrid}>
          {mainnets.map(net => (
            <NetworkCard key={net.chainId} net={net} selected={selected === net.chainId} onSelect={onSelect} />
          ))}
        </div>
        <span className={styles.networkGroupLabel}>Testnet</span>
        <div className={styles.networkGrid}>
          {testnets.map(net => (
            <NetworkCard key={net.chainId} net={net} selected={selected === net.chainId} onSelect={onSelect} />
          ))}
        </div>
      </div>
      <SailButton fullWidth onClick={onDone} disabled={!selected}>
        Continue with {selectedNet?.name ?? '…'} →
      </SailButton>
    </GlassCard>
  )
}

function NetworkCard({ net, selected, onSelect }) {
  const live = LIVE_CHAIN_IDS.has(net.chainId)
  return (
    <button
      type="button"
      className={`${styles.networkCard} ${selected ? styles.networkCardSelected : ''} ${!live ? styles.networkCardSoon : ''}`}
      onClick={() => live && onSelect(net.chainId)}
      style={{ '--net-color': live ? net.color : 'rgba(255,255,255,0.18)' }}
      title={live ? undefined : 'Sail kernel coming soon'}
    >
      <span className={styles.networkDot} />
      <span className={styles.networkName}>{net.name}</span>
      <span className={styles.networkDesc}>{live ? net.description : 'Coming soon'}</span>
    </button>
  )
}

/* ── Step 2: Connect wallet ── */
function ConnectStep({ onBack, onDone, progressIndex, progressTotal }) {
  const { isConnected, address } = useAccount()
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
        sub="This wallet owns your Safe and signs mandates. It never executes trades."
        onBack={onBack}
      />
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
        <ConnectButton showBalance={false} />
      </div>
    </GlassCard>
  )
}

/* ── Step 3: Generate delegated signer key ── */
function KeygenStep({ existingAddress, onDone, progressIndex, progressTotal }) {
  const [passphrase, setPassphrase] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [generated, setGenerated] = useState(existingAddress ?? null)
  const [copied, setCopied] = useState(false)

  async function generate() {
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
        title="Create agent key"
        sub="A signing key your agent uses to execute trades. It never holds custody."
      />
      {!generated ? (
        <>
          <div className={styles.passphraseRow}>
            <label className={styles.passphraseLabel}>
              Passphrase <span style={{ opacity: 0.5 }}>(optional)</span>
            </label>
            <input
              type="password"
              className={styles.passphraseInput}
              placeholder="Encrypts the key on disk"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') generate() }}
            />
          </div>
          {error && <p style={{ color: '#ff6b6b', fontSize: 13, margin: '8px 0' }}>{error}</p>}
          <SailButton fullWidth onClick={generate} disabled={loading}>
            {loading ? 'Generating…' : 'Generate key'}
          </SailButton>
          <p className={styles.fineprint}>
            If set, save this passphrase — your agent needs it as <code>SAIL_PASSPHRASE</code>.
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
              <span style={{ opacity: 0.6, fontSize: 12 }}>Remember:</span>{' '}
              <code style={{ fontSize: 12 }}>SAIL_PASSPHRASE=&quot;{passphrase}&quot;</code>
            </div>
          )}
          <SailButton fullWidth onClick={() => onDone(generated)}>Continue →</SailButton>
        </>
      )}
    </GlassCard>
  )
}

/* ── Step 4: Create SMA on-chain ── */
function CreateSmaStep({ owner, managerAddress, chainId, onDone, progressIndex, progressTotal }) {
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState(undefined)
  const { sendTransactionAsync } = useSendTransaction()
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash, confirmations: 1 })
  const network = SUPPORTED_NETWORKS.find(n => n.chainId === chainId)

  useEffect(() => {
    if (!receipt) return
    const log = receipt.logs?.find((l) => l.topics?.[0] === ACCOUNT_REGISTERED_TOPIC)
    if (!log) { setError('AccountRegistered event not found — tx may have failed'); setPhase('error'); return }
    const safe = getAddress(`0x${log.topics[1].slice(26)}`)
    fetch('/api/onboard/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safe, owner, manager: managerAddress, txHash: receipt.transactionHash, chainId }),
    })
      .then(() => onDone(safe))
      .catch((err) => { setError(err.message); setPhase('error') })
  }, [receipt, owner, managerAddress, chainId, onDone])

  async function create() {
    setPhase('building')
    setError('')
    try {
      const buildRes = await fetch('/api/onboard/build-create-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, manager: managerAddress, chainId }),
      })
      const { to, data } = await buildRes.json()
      if (!buildRes.ok) throw new Error(data?.error ?? 'Build failed')
      setPhase('wallet')
      const hash = await sendTransactionAsync({ to, data })
      setTxHash(hash)
      setPhase('confirming')
    } catch (err) {
      setError(err?.shortMessage || err?.message || 'Transaction failed')
      setPhase('error')
    }
  }

  const phaseLabel = {
    idle: 'Deploy Safe', building: 'Building transaction…',
    wallet: 'Confirm in wallet…', confirming: 'Waiting for confirmation…', error: 'Retry',
  }[phase] ?? 'Deploy Safe'

  return (
    <GlassCard className={styles.authCard}>
      <ProgressDots current={progressIndex} total={progressTotal} />
      <CardHeader
        kicker="STEP 4 OF 4"
        title="Deploy your Safe"
        sub="A 1-of-1 Safe registered with SailKernel. Your wallet pays the deployment gas."
      />
      <div className={styles.smaDetails}>
        <Detail label="Network" value={network?.name ?? `Chain ${chainId}`} mono={false} />
        <Detail label="Owner" value={owner} />
        <Detail label="Agent key" value={managerAddress} />
      </div>
      {error && <p style={{ color: '#ff6b6b', fontSize: 13, margin: '8px 0' }}>{error}</p>}
      <SailButton fullWidth onClick={create} disabled={phase !== 'idle' && phase !== 'error'}>
        {phaseLabel}
      </SailButton>
      <p className={styles.fineprint}>
        One transaction — deploys a Safe and registers it with SailKernel.
      </p>
    </GlassCard>
  )
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
function DoneStep({ safeAddress, chainId, onComplete }) {
  const [copied, setCopied] = useState(false)
  const network = SUPPORTED_NETWORKS.find(n => n.chainId === chainId)
  const safeShort = safeAddress ? `${safeAddress.slice(0, 10)}…${safeAddress.slice(-6)}` : null

  const aiPrompt = [
    `My Sail SMA is deployed on ${network?.name ?? `chain ${chainId}`}.`,
    safeAddress ? `Safe address: ${safeAddress}` : null,
    '',
    'Please help me finish the setup — steps 5–8 from the Sail onboarding:',
    '',
    '5. Configure RPC & API keys',
    '   - Add RPC_URL for the network to .sail/.env.local',
    '   - Add SAIL_API_KEY=<your key from api.sail.money>',
    '',
    '6. Fund agent key',
    '   - Send a small amount of ETH to the agent address shown on the dashboard',
    '',
    '7. Set permissions (mandate)',
    '   - Run: sailor mandate prepare',
    '   - Then sign it at the Sail UI signing page',
    '',
    '8. Start the agent',
    '   - Run: sailor run',
  ].filter(l => l !== null).join('\n')

  function copy() {
    navigator?.clipboard?.writeText(aiPrompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <GlassCard className={styles.welcomeCard}>
      <div className={styles.cardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.cardHeader}>
        <span className={styles.kicker}>STEPS 1–4 COMPLETE</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          Safe deployed.
        </h1>
        <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
          {safeShort && <><code style={{ fontSize: 12 }}>{safeShort}</code>{' '}on {network?.name ?? `chain ${chainId}`}. </>}
          Continue in your terminal with AI.
        </p>
      </header>
      <div className={styles.doneNextSteps}>
        <span className={styles.doneNextLabel}>Remaining steps (5–8) — copy to your AI</span>
        <pre className={styles.donePromptText}>{aiPrompt}</pre>
        <button type="button" className={styles.doneCopyBtn} onClick={copy}>
          {copied ? '✓ Copied' : 'Copy prompt'}
        </button>
      </div>
      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={onComplete}>Go to dashboard →</SailButton>
      </div>
    </GlassCard>
  )
}

/* ── Shared atoms ── */
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
