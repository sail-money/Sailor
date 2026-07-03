import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { getChain } from '@sail/sdk/chains'
import { sailDeployments } from '@sail/sdk/deployments'
import { zeroAddress } from 'viem'
import { useAccount, usePublicClient, useSignTypedData, useSwitchChain } from 'wagmi'
import { HorizonBackground, GlassCard, Sai, RevealCalldata, SailButton, BadgeRow } from '../shared'
import PageHeader from '../shared/PageHeader'
import shared from '../shared/shared.module.css'
import styles from './Signing.module.css'
import { useSailorMandateDraft } from '../../hooks/useSailorData'
import { explorerCodeUrl } from '../../lib/explorer'

/**
 * Sign-in & onboarding flow.
 *
 * welcome → connect → dashboard
 *
 * The SMA is no longer created in this flow. The wallet is the
 * identity; landing on the dashboard with no SMA is a first-class
 * state, and SMA creation happens later — bundled into the
 * "create your first mandate" moment, where the user can see the
 * value of the SMA before paying gas to deploy it.
 *
 * The legacy `deploy` and `confirming` states are retained so demo
 * console preset URLs keep working, but they are no longer reached
 * by the normal sign-in flow.
 */
/**
 * Top-level router for the signing page. When a mandate draft is present
 * (written by `sailor mandate prepare`), the page becomes the mandate review +
 * MetaMask signing flow. Otherwise it shows the wallet-connect onboarding.
 * Each branch is its own component so hook order stays stable.
 */
export default function Signing() {
  const { draft } = useSailorMandateDraft()

  if (draft) return <MandateSigningFlow draft={draft} />
  return <NoPendingFlow />
}

function NoPendingFlow() {
  return (
    <div className={styles.shell}>
      <HorizonBackground />
      <HeaderBar state="welcome" />
      <main className={styles.stage}>
        <div className={styles.stageInner}>
          <GlassCard className={styles.welcomeCard}>
            <div className={styles.cardSai} aria-hidden>
              <Sai size={64} animate />
            </div>
            <header className={styles.cardHeader}>
              <span className={styles.kicker}>SIGNING STATION</span>
              <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
                No pending signatures.
              </h1>
              <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
                Run <code style={{ fontSize: 13, opacity: 0.8 }}>sailor mandate prepare</code> to queue a mandate for signing.
              </p>
            </header>
            <div className={styles.welcomeCta}>
              <SailButton fullWidth onClick={() => { window.location.hash = '#/dashboard' }}>
                Go to dashboard
              </SailButton>
            </div>
          </GlassCard>
        </div>
      </main>
    </div>
  )
}

// topic0 of AccountRegistered(address indexed account, address indexed permissionSigner, address indexed manager)
const ACCOUNT_REGISTERED_TOPIC = '0x05f9a81a3b5e45d338f25347928e56b0aaaa0c65d4087a980c4e41370fcccfeb'

// live: chainIds with a deployed SailKernel (getSailDeployment returns a result).
// Derived from the SDK deployment registry so it can never drift from @sail/sdk.
const LIVE_CHAIN_IDS = new Set(Object.keys(sailDeployments).map(Number))

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

// Steps that show progress dots (excludes welcome + done).
const PROGRESS_STEPS = ['network', 'connect', 'keygen', 'create-sma']

function OnboardingFlow({ onboardState, addingNetwork }) {
  const { isConnected, address } = useAccount()
  const [step, setStep] = useState(addingNetwork ? 'network' : 'welcome')
  const [selectedChainId, setSelectedChainId] = useState(onboardState?.chainId ?? 8453)
  const [managerAddress, setManagerAddress] = useState(onboardState?.managerAddress ?? null)
  const [safeAddress, setSafeAddress] = useState(null)

  // Resume from the right step when page refreshes with wallet still connected (first-time flow only).
  useEffect(() => {
    if (addingNetwork || !isConnected) return
    if (onboardState?.hasManagerKey) setStep('create-sma')
    else setStep('keygen')
  }, [addingNetwork, isConnected, onboardState?.hasManagerKey])

  const progressIndex = PROGRESS_STEPS.indexOf(step)

  return (
    <div className={styles.shell}>
      <HorizonBackground />
      <HeaderBar state="welcome" />
      <main className={styles.stage}>
        <div key={step} className={styles.stageInner}>
          {step === 'welcome' && (
            <WelcomeState onStart={() => setStep('network')} />
          )}
          {step === 'network' && (
            <NetworkStep
              selected={selectedChainId}
              onSelect={setSelectedChainId}
              onBack={addingNetwork ? null : () => setStep('welcome')}
              onDone={() => setStep(addingNetwork ? 'create-sma' : 'connect')}
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
            <DoneStep safeAddress={safeAddress} chainId={selectedChainId} />
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

/* ── Network selection step ── */
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
    // status === 'checking': wait for socket to resolve, re-runs on status change
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

/* ── Step 3: Create agent wallet ── */
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
  const [phase, setPhase] = useState('idle') // idle | building | wallet | confirming | error
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
      // Pass the target chainId so wagmi resolves the configured viem chain object and
      // switches the wallet if needed. Without it, viem's sendTransaction sees
      // `chain: undefined` for the active chain (e.g. Base Sepolia 84532) and throws
      // "Cannot read properties of undefined (reading 'length')". Mirrors FundGasModal. (F1)
      const hash = await sendTransactionAsync({ to, data, chainId })
      setTxHash(hash)
      setPhase('confirming')
    } catch (err) {
      setError(err?.shortMessage || err?.message || 'Transaction failed')
      setPhase('error')
    }
  }

  const phaseLabel = {
    idle:       'Deploy Safe',
    building:   'Building transaction…',
    wallet:     'Confirm in wallet…',
    confirming: 'Waiting for confirmation…',
    error:      'Retry',
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
        <Detail label="Agent wallet" value={managerAddress} />
      </div>
      {error && <p style={{ color: '#ff6b6b', fontSize: 13, margin: '8px 0' }}>{error}</p>}
      <SailButton
        fullWidth
        onClick={create}
        disabled={phase !== 'idle' && phase !== 'error'}
      >
        {phaseLabel}
      </SailButton>
      <p className={styles.fineprint}>
        One transaction — deploys a Safe and registers it with SailKernel. No custody transfer.
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
function DoneStep({ safeAddress, chainId }) {
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
          Now continue in your terminal with AI.
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
        <SailButton fullWidth onClick={() => { window.location.hash = '#/dashboard' }}>
          Go to dashboard
        </SailButton>
      </div>
    </GlassCard>
  )
}

/* ─────────── Mandate signing (MetaMask) ───────────
   Driven by a .sail/mandate-draft.json written by `sailor mandate prepare`.
   Flow: connect wallet → review permissions → sign the EIP-712
   RegisterPermissions message with the connected wallet → POST the signature
   to /api/mandate-submit → confirmation. No local key is ever created. */
const SIGNER_NONCES_ABI = [
  {
    type: 'function',
    name: 'signerNonces',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

function ExplanationPanel({ ex }) {
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--glass-border)' }}>
      <BadgeRow items={[ex.protocol, ex.chain, ex.version]} />
      {ex.enforced?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5dde8b', marginBottom: 5 }}>
            Enforced on-chain
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {ex.enforced.map((b, i) => (
              <li key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', paddingLeft: 12, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0, color: '#5dde8b' }}>·</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ex.notEnforced?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 5 }}>
            Agent code — not enforced on-chain
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {ex.notEnforced.map((b, i) => (
              <li key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', paddingLeft: 12, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0 }}>·</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function PermissionRow({ item, chainId }) {
  const [open, setOpen] = useState(false)
  const ex = item.permExplanation
  // Link to the permission contract's verified source on the chain's explorer
  // (Basescan/Etherscan/…) so the owner can read the code they're authorizing.
  const codeUrl = item.address ? explorerCodeUrl(chainId, item.address) : null

  return (
    <li style={{
      borderRadius: 2,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => ex && setOpen(o => !o)}
        style={{
          padding: '10px 12px',
          cursor: ex ? 'pointer' : 'default',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
            {item.explanation}
          </div>
          {item.address && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{item.address.slice(0, 6)}…{item.address.slice(-4)}</span>
              {codeUrl && (
                <a
                  href={codeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: '#7eb8f7', textDecoration: 'none' }}
                >
                  View code on scanner ↗
                </a>
              )}
            </div>
          )}
        </div>
        {ex && (
          <span style={{
            flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 8px', borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.12)',
            background: open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
            fontSize: 11, color: 'rgba(255,255,255,0.5)',
            fontWeight: 500, whiteSpace: 'nowrap',
            transition: 'background 0.15s, color 0.15s',
            userSelect: 'none',
          }}>
            Details
            <span style={{
              fontSize: 8, display: 'inline-block',
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
              opacity: 0.6,
            }}>▾</span>
          </span>
        )}
      </div>
      {open && ex && (
        <div style={{ padding: '0 12px 12px' }}>
          <ExplanationPanel ex={ex} />
        </div>
      )}
    </li>
  )
}

function RegistrationFeeNote({ fee }) {
  const symbol = fee.symbol ?? 'ETH'
  return (
    <div style={{
      marginTop: 4,
      marginBottom: 4,
      padding: '10px 12px',
      borderRadius: 2,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 8,
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Registration fee</span>
      <span style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 14, color: 'var(--text-primary, #fff)', fontWeight: 600 }}>
          {fee.totalEth} {symbol}
        </span>
        {fee.permissionCount > 1 && fee.perPermissionEth && (
          <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            {fee.permissionCount} permissions × {fee.perPermissionEth} {symbol}
          </span>
        )}
        {fee.permissionCount > 1 && !fee.perPermissionEth && (
          <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            for {fee.permissionCount} permissions
          </span>
        )}
      </span>
    </div>
  )
}

export function MandateSigningFlow({ draft, embedded = false }) {
  const { isConnected, chainId: walletChainId } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const { switchChainAsync } = useSwitchChain()
  const publicClient = usePublicClient()
  const [phase, setPhase] = useState('review') // review | signing | done
  const [errorMsg, setErrorMsg] = useState('')

  // Normalise both draft formats:
  // - CLI format: { permissions: [{address, label, explanation?}] }
  // - Legacy format: { items: [{template, explanation}] }
  const items = (draft.items ?? []).length > 0
    ? draft.items
    : (draft.permissions ?? []).map((p) => ({
        template: p.address,
        explanation: p.label,
        address: p.address,
        permExplanation: p.explanation ?? null,
      }))

  // The kernel address (EIP-712 verifyingContract) comes from the draft's
  // chainId via @sail/chains. Falls back to the zero address when the chain
  // is not yet configured, so the flow stays demoable.
  const kernel = (() => {
    try {
      return getChain(draft.chainId).kernel
    } catch {
      return zeroAddress
    }
  })()

  const wrongChain = isConnected && walletChainId !== draft.chainId

  async function onReject() {
    await fetch('/api/mandate-draft', { method: 'DELETE' }).catch(() => {})
    window.location.hash = '#/dashboard'
  }

  async function onSwitchChain() {
    try {
      await switchChainAsync({ chainId: draft.chainId })
    } catch (err) {
      setErrorMsg(err?.shortMessage || err?.message || 'Could not switch network')
    }
  }

  async function onSign() {
    if (phase === 'signing') return
    setErrorMsg('')
    setPhase('signing')
    try {
      const permissions = items.map((it) => it.template)

      // Read the current signer nonce from the kernel; default to 0 if the
      // kernel is unreachable or not yet deployed.
      let nonce = 0n
      try {
        if (publicClient && kernel !== zeroAddress) {
          nonce = await publicClient.readContract({
            address: kernel,
            abi: SIGNER_NONCES_ABI,
            functionName: 'signerNonces',
            args: [draft.account],
          })
        }
      } catch {
        nonce = 0n
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const signature = await signTypedDataAsync({
        domain: {
          name: 'SailKernel',
          version: '1',
          chainId: draft.chainId,
          verifyingContract: kernel,
        },
        types: {
          RegisterPermissions: [
            { name: 'account', type: 'address' },
            { name: 'permissions', type: 'address[]' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'RegisterPermissions',
        message: { account: draft.account, permissions, nonce, deadline },
      })

      const res = await fetch('/api/mandate-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send the exact signed permissions (in order) + deadline so the server
        // can submit registerPermissions on-chain with the matching message.
        body: JSON.stringify({
          signature,
          signedAt: new Date().toISOString(),
          permissions,
          deadline: deadline.toString(),
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.error || `Submit failed (${res.status})`)
      }

      setPhase('done')
    } catch (err) {
      setErrorMsg(err?.shortMessage || err?.message || 'Signing failed')
      setPhase('review')
    }
  }

  const content = phase === 'done' ? (
    <MandateSignedCard draft={draft} />
  ) : (
    <GlassCard className={styles.authCard}>
      <CardHeader
        kicker="REVIEW MANDATE"
        title="Authorize your agent"
        sub="Sign with your wallet — Sail never holds your keys."
      />

      {!isConnected ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
          <ConnectButton showBalance={false} />
        </div>
      ) : (
        <>
          <MandatePreviewSummary draft={draft} items={items} />
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '12px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {items.map((it, i) => (
              <PermissionRow key={i} item={it} chainId={draft.chainId} />
            ))}
          </ul>

          {draft.registrationFee && <RegistrationFeeNote fee={draft.registrationFee} />}

          {errorMsg && (
            <p style={{ color: '#ff6b6b', fontSize: 13, margin: '8px 0' }}>{errorMsg}</p>
          )}

          {wrongChain ? (
            <>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '0 0 10px' }}>
                Your wallet is on a different network. Switch to sign this mandate.
              </p>
              <div className={styles.actionRow}>
                <SailButton fullWidth onClick={onSwitchChain}>
                  Switch to {(() => { try { return getChain(draft.chainId).name } catch { return `Chain ${draft.chainId}` } })()}
                </SailButton>
                <button type="button" className={styles.rejectBtn} onClick={onReject}>Reject</button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.actionRow}>
                <SailButton fullWidth onClick={onSign} disabled={phase === 'signing'}>
                  {phase === 'signing' ? 'Waiting for wallet…' : 'Sign mandate'}
                </SailButton>
                <button type="button" className={styles.rejectBtn} onClick={onReject} disabled={phase === 'signing'}>Reject</button>
              </div>
              <p className={styles.fineprint}>
                Revocable on-chain at any time from your dashboard.
              </p>
            </>
          )}
        </>
      )}
    </GlassCard>
  )

  if (embedded) {
    return <div className={styles.embeddedFlow}>{content}</div>
  }

  return (
    <div className={styles.shell}>
      <HorizonBackground />
      <HeaderBar state={phase === 'done' ? 'confirming' : 'review'} />
      <main className={styles.stage}>
        <div className={styles.stageInner}>
          {content}
        </div>
      </main>
    </div>
  )
}

/* ─────────── Mandate preview summary (F10) ───────────
   A plain-language header shown before signing so the user — especially when an
   LLM authored the setup — knows what they are authorizing: how many action
   types, on which account/network, and the guarantees that bound it. The
   permission rows below carry the per-permission detail; this is the recital. */
function MandatePreviewSummary({ draft, items }) {
  const networkName = (() => {
    try { return getChain(draft.chainId).name } catch { return `Chain ${draft.chainId}` }
  })()
  const n = items.length
  const acct = draft.account
    ? `${draft.account.slice(0, 6)}…${draft.account.slice(-4)}`
    : '—'

  const factStyle = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }
  const dtStyle = { color: 'rgba(255,255,255,0.45)' }
  const ddStyle = { color: 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }

  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '12px 14px',
        margin: '4px 0 12px',
        background: 'rgba(255,255,255,0.02)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,0.92)' }}>
        You're authorizing your agent to perform{' '}
        <strong>{n} bounded action type{n === 1 ? '' : 's'}</strong> on{' '}
        <strong>{networkName}</strong>. Each is constrained by the rules below.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={factStyle}><span style={dtStyle}>Account (SMA)</span><span style={ddStyle}>{acct}</span></div>
        <div style={factStyle}><span style={dtStyle}>Network</span><span style={ddStyle}>{networkName}</span></div>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li style={{ fontSize: 12.5, color: 'rgba(120,220,160,0.95)' }}>✓ Revocable on-chain anytime from your dashboard</li>
        <li style={{ fontSize: 12.5, color: 'rgba(120,220,160,0.95)' }}>✓ Sail never holds your keys or funds — you sign every authorization</li>
        <li style={{ fontSize: 12.5, color: 'rgba(255,180,120,0.95)' }}>✗ The agent cannot act outside the permissions listed below</li>
      </ul>
    </div>
  )
}

/* ─────────── Header bar ─────────── */
function HeaderBar({ state }) {
  return (
    <PageHeader
      eyebrow="Signing"
      title={state === 'confirming' ? 'Signed' : 'Sail never sees your keys'}
      backTo="#/dashboard"
    />
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

/* ── Mandate signed: contextual done state ── */
function MandateSignedCard({ draft }) {
  const [copied, setCopied] = useState(false)
  const permCount = (draft?.items ?? draft?.permissions ?? []).length
  const safeShort = draft?.account ? `${draft.account.slice(0, 10)}…${draft.account.slice(-6)}` : null
  const prompt = `My mandate is signed on Safe ${draft?.account ?? 'my Safe'}. ${permCount} permission${permCount === 1 ? '' : 's'} registered. Now deploy and start the agent — use SAIL_PASSPHRASE from my config and run sailor run.`

  function copy() {
    navigator?.clipboard?.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <GlassCard className={styles.welcomeCard}>
      <div className={styles.cardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.cardHeader}>
        <span className={styles.kicker}>MANDATE SIGNED</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          Permissions registered.
        </h1>
        <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
          {permCount} permission{permCount === 1 ? '' : 's'} authorized
          {safeShort ? ` on ${safeShort}` : ''}.
          Tell your AI to start the agent.
        </p>
      </header>
      <div className={styles.mandateSignedPrompt}>
        <span className={styles.mandateSignedPromptLabel}>Copy prompt for your AI</span>
        <p className={styles.mandateSignedPromptText}>"{prompt}"</p>
        <button type="button" className={styles.mandateSignedCopyBtn} onClick={copy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={() => { window.location.hash = '#/dashboard' }}>
          Go to dashboard
        </SailButton>
      </div>
    </GlassCard>
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
