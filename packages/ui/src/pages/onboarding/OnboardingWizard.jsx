import { useEffect, useState } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { encodeFunctionData, getAddress } from 'viem'
import { useAccount, useSendTransaction, useSwitchChain } from 'wagmi'
import { sailDeployments } from '@sail/sdk/deployments'
import { FluidBackground, GlassCard, Sai, SailButton } from '../shared'
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
      { n: 2, name: 'Connect your wallet',  detail: 'Becomes the owner of your SMA' },
      { n: 3, name: 'Create agent key',     detail: 'Signs transactions on your behalf' },
      { n: 4, name: 'Deploy your SMA',      detail: 'One-time gas payment, permanent account' },
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

export default function OnboardingWizard({ onboardState, onComplete, onSkip }) {
  const { isConnected, address } = useAccount()
  const [step, setStep] = useState('welcome')
  // Multi-chain: user selects one or more chains; default to Base
  const [selectedChainIds, setSelectedChainIds] = useState([onboardState?.chainId ?? 8453])
  const [managerAddress, setManagerAddress] = useState(onboardState?.managerAddress ?? null)
  const [deployedSafes, setDeployedSafes] = useState([]) // [{ chainId, safe }]
  // Fixed salt so the same Safe address is produced on every chain via CREATE2
  const [saltNonce] = useState(() => String(Date.now()))


  // If the wallet is already connected when the user lands on welcome,
  // advance to network so they can pick their chains — but no further.
  useEffect(() => {
    if (step === 'welcome' && isConnected) setStep('network')
  }, [step, isConnected])

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
      <FluidBackground />
      <OnboardingHeader onSkip={onSkip ?? onComplete} />
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
  const names = selected.map(id => SUPPORTED_NETWORKS.find(n => n.chainId === id)?.name).filter(Boolean)

  return (
    <GlassCard className={styles.authCard}>
      <ProgressDots current={progressIndex} total={progressTotal} />
      <CardHeader
        kicker="STEP 1 OF 4"
        title="Choose your networks"
        sub="Same SMA address on every chain — deployed via CREATE2 with the same salt."
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
          : `Continue with ${names.join(' + ')} →`}
      </SailButton>
    </GlassCard>
  )
}

function NetworkCard({ net, selected, onToggle }) {
  const live = LIVE_CHAIN_IDS.has(net.chainId)
  return (
    <button
      type="button"
      className={`${styles.networkCard} ${selected ? styles.networkCardSelected : ''} ${!live ? styles.networkCardSoon : ''}`}
      onClick={() => live && onToggle(net.chainId)}
      style={{ '--net-color': live ? net.color : 'rgba(255,255,255,0.18)' }}
      title={live ? undefined : 'Sail kernel coming soon'}
    >
      <span className={styles.networkDot} />
      <span className={styles.networkName}>{net.name}</span>
      <span className={styles.networkDesc}>{live ? net.description : 'Coming soon'}</span>
      {live && (
        <span className={`${styles.networkCheck} ${selected ? styles.networkCheckOn : ''}`}>
          {selected ? '✓' : ''}
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
        sub="This wallet owns your SMA and signs mandates. It never executes trades."
        onBack={onBack}
      />
      <SailButton fullWidth onClick={openConnectModal}>Connect wallet →</SailButton>
    </GlassCard>
  )
}

/* ── Step 3: Generate delegated signer key ── */
function KeygenStep({ existingAddress, onBack, onDone, progressIndex, progressTotal }) {
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
        onBack={onBack}
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
            If set, it's saved to <code>.sail/.env.local</code> (mode 0600) so your agent can unlock the key unattended.
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
function CreateSmaStep({ owner, managerAddress, chainIds, saltNonce, onBack, onDone, progressIndex, progressTotal }) {
  const { sendTransactionAsync } = useSendTransaction()
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
      // The registerAccount function takes (permissionSigner, manager, feePolicy):
      //   permissionSigner = owner (user's wallet — signs mandates)
      //   manager = managerAddress (agent wallet — signs dispatches)
      //   feePolicy = address(0) (no fee policy)
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

      // Step 2: register with kernel.
      // registerAccount(address permissionSigner, address manager, address feePolicy)
      // permissionSigner = owner (NOT the safe address)
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
      const registerData = encodeFunctionData({
        abi: [{ name: 'registerAccount', type: 'function', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }], outputs: [] }],
        functionName: 'registerAccount',
        args: [owner, managerAddress, ZERO_ADDRESS],  // (permissionSigner, manager, feePolicy)
      })
      setStatus(chainId, 'wallet')
      const registerHash = await sendTransactionAsync({ to: path.kernel, data: registerData, chainId })
      setStatus(chainId, 'confirming')
      const registerReceipt = await waitForReceipt(registerHash, chainId)
      if (registerReceipt?.status === '0x0') throw new Error('registerAccount reverted — check the kernel address and try again.')

      const completeRes1 = await fetch('/api/onboard/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ safe, owner, manager: managerAddress, txHash: registerHash, chainId }),
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
      body: JSON.stringify({ safe, owner, manager: managerAddress, txHash: hash, chainId }),
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
          return // stop on real errors — user retries
        }
      }
    }
    setRunning(false)
    const allSettled = [...deployed, ...results]
    onDone(allSettled) // pass whatever succeeded
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
              <span className={styles.chainDeployDot} style={{ '--net-color': net?.color }} />
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

// Public RPC endpoints for simulation + receipt polling. RPC URLs are not part
// of the SDK deployment record, so this map must be kept in sync by hand: every
// chainId in LIVE_CHAIN_IDS (i.e. sailDeployments) needs an entry here.
const PUBLIC_RPC = {
  8453:   'https://mainnet.base.org',
  84532:  'https://sepolia.base.org',
  42161:  'https://arb1.arbitrum.io/rpc',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
  130:    'https://mainnet.unichain.org',
}

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
  const [copied, setCopied] = useState(false)
  const chainSummary = deployedSafes.map(({ chainId, safe }) => {
    const net = SUPPORTED_NETWORKS.find(n => n.chainId === chainId)
    return `${net?.name ?? `Chain ${chainId}`}: ${safe}`
  }).join('\n')
  const primaryNet = SUPPORTED_NETWORKS.find(n => n.chainId === deployedSafes[0]?.chainId)

  const aiPrompt = [
    `My Sail SMAs are deployed:`,
    chainSummary,
    '',
    'Please help me finish the setup — steps 5–8 from the Sail onboarding.',
    'The Sailor UI is running at http://localhost:3333 — keep it open,',
    'some steps require approving transactions there.',
    '',
    '5. Configure RPC & API keys',
    '   - Add to .sail/.env.local:',
    '     RPC_URL=<your RPC endpoint for ' + (primaryNet?.name ?? 'the network') + '>',
    '     SAIL_API_KEY=<your key from api.sail.money>',
    '',
    '6. Fund agent key',
    '   - The agent address is shown on the dashboard (http://localhost:3333)',
    '   - Send a small amount of ETH to it for gas',
    '',
    '7. Set permissions (mandate)',
    '   - Run: sailor mandate prepare',
    '   - Then open http://localhost:3333 — the signing flow will appear automatically',
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
          {deployedSafes.length === 1 ? 'SMA deployed.' : `${deployedSafes.length} SMAs deployed.`}
        </h1>
        <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
          {deployedSafes.map(({ chainId }) => SUPPORTED_NETWORKS.find(n => n.chainId === chainId)?.name).join(' + ')}.
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
