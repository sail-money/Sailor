import { useEffect, useState } from 'react'
import { useAccount, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt } from 'wagmi'
import { encodeFunctionData, parseEventLogs, zeroAddress } from 'viem'
import { SAFE_V141, buildSafeSetupInitializer, gnosisSafeAbi } from '@sail/sdk/safe'
import { getSailDeployment } from '@sail/sdk/deployments'
import { SailKernelAbi } from '@sail/sdk/abis'
import { GlassCard, Sai, SailButton, RevealCalldata } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './CreateSMAModal.module.css'

const PROXY_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createProxyWithNonce',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'singleton', type: 'address' },
      { name: 'initializer', type: 'bytes' },
      { name: 'saltNonce', type: 'uint256' },
    ],
    outputs: [{ name: 'proxy', type: 'address' }],
  },
]

const PROXY_CREATION_TOPIC = '0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235'

/**
 * Recover the deployed Safe address from a receipt, regardless of which path
 * created it.
 *
 * Sail-managed SMAs are deployed via SailKernel.createAccount, which derives
 * the proxy salt from msg.sender — so the address must be read from the
 * kernel's AccountRegistered event, NOT the proxy factory's ProxyCreation log.
 * Plain Safes (chains without a Sail deployment) still emit only ProxyCreation.
 */
function getSafeAddressFromReceipt(receipt) {
  if (!receipt?.logs) return null
  const [registered] = parseEventLogs({
    abi: SailKernelAbi,
    eventName: 'AccountRegistered',
    logs: receipt.logs,
  })
  if (registered?.args?.account) return registered.args.account
  const log = receipt.logs.find((l) => l.topics?.[0] === PROXY_CREATION_TOPIC)
  if (!log) return null
  return `0x${log.topics[1]?.slice(26)}`
}

async function saveAccount(account) {
  try {
    await fetch('/api/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(account),
    })
  } catch {
    // best-effort — the user can also run `sailor account create`
  }
}

/**
 * The bundled "create your first mandate" experience.
 *
 * The SMA used to be deployed at sign-up — a gas-paid signature for a
 * value the user couldn't yet feel. Now the SMA is deployed at the
 * moment of the first mandate, where the cost is paid for a concrete
 * benefit: "your AI starts working as soon as you sign."
 *
 * Steps:
 *   1. intro     — explainer: "Before creating your first agent,
 *                  we will create your SMA"
 *   2. review    — what you're signing (calldata, gas, network)
 *   3. confirm   — wallet-side waiting state
 *   4. ready     — SMA deployed. Hand off to AI for the mandate draft.
 */
export default function CreateSMAModal({ open, onClose, onComplete }) {
  const [step, setStep] = useState('intro')
  const [networks, setNetworks] = useState([DEFAULT_NETWORK_ID])
  const [txError, setTxError] = useState('')
  const [deployedSafe, setDeployedSafe] = useState(null)
  const [createdAccount, setCreatedAccount] = useState(null)

  const { address: ownerAddress, chainId: walletChainId } = useAccount()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()
  const [txHash, setTxHash] = useState(null)
  const { data: receipt, isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  // When the receipt lands, extract the Safe address and persist it.
  useEffect(() => {
    if (!txConfirmed || !receipt) return
    const safe = getSafeAddressFromReceipt(receipt)
    setDeployedSafe(safe)
    const account = safe && ownerAddress && walletChainId
      ? {
          safe,
          owner: ownerAddress,
          permissionSigner: ownerAddress,
          manager: ownerAddress,
          chainId: walletChainId,
          createdAtBlock: receipt.blockNumber?.toString() ?? '0',
        }
      : null
    if (account) saveAccount(account)
    setCreatedAccount(account)
    setStep('ready')
  }, [txConfirmed, receipt, ownerAddress, walletChainId])

  // Reset when the modal opens.
  useEffect(() => {
    if (!open) return
    setStep('intro')
    setTxError('')
    setTxHash(null)
    setDeployedSafe(null)
    setCreatedAccount(null)
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape' && step !== 'confirm') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleSign() {
    if (!ownerAddress) { setTxError('No wallet connected.'); return }
    const selectedNet = ALL_NETWORKS.find((n) => networks.includes(n.id))
    if (!selectedNet) { setTxError('Select a network.'); return }

    // Resolve the Sail deployment for the target chain. When present we deploy
    // AND register the Safe atomically through SailKernel.createAccount — a
    // plain createProxyWithNonce leaves the Safe unregistered, so it can never
    // have mandates attached or dispatch (the kernel's `registered[account]`
    // mapping is only set by createAccount / registerAccount). Chains without a
    // Sail deployment fall back to a plain, clearly-unmanaged Safe.
    let deployment = null
    try { deployment = getSailDeployment(selectedNet.chainId) } catch { /* not yet deployed */ }

    const saltNonce = BigInt(Date.now())
    let to
    let data

    if (deployment) {
      // The kernel needs its module enabled during Safe setup, or createAccount
      // reverts with ModuleNotEnabled().
      const safeInitializer = buildSafeSetupInitializer({
        owners: [ownerAddress],
        threshold: 1n,
        kernel: deployment.kernel,
        safeModuleEnabler: deployment.safeModuleEnabler,
      })
      // No agent exists yet at SMA creation, so the owner is both permission
      // signer and manager; the manager is reassigned when an agent is bound.
      to = deployment.kernel
      data = encodeFunctionData({
        abi: SailKernelAbi,
        functionName: 'createAccount',
        args: [
          SAFE_V141.proxyFactory,
          SAFE_V141.singletonL2,
          safeInitializer,
          saltNonce,
          ownerAddress, // permissionSigner
          ownerAddress, // manager
          deployment.standardFeePolicy,
          zeroAddress, // feeAsset (native)
        ],
      })
    } else {
      const initializer = encodeFunctionData({
        abi: gnosisSafeAbi,
        functionName: 'setup',
        args: [[ownerAddress], 1n, zeroAddress, '0x', SAFE_V141.fallbackHandler, zeroAddress, 0n, zeroAddress],
      })
      to = SAFE_V141.proxyFactory
      data = encodeFunctionData({
        abi: PROXY_FACTORY_ABI,
        functionName: 'createProxyWithNonce',
        args: [SAFE_V141.singletonL2, initializer, saltNonce],
      })
    }

    setStep('confirm')
    setTxError('')
    try {
      // Switch wallet to the target chain if needed.
      if (walletChainId !== selectedNet.chainId) {
        await switchChainAsync({ chainId: selectedNet.chainId })
      }
      const hash = await sendTransactionAsync({
        to,
        data,
        chainId: selectedNet.chainId,
      })
      setTxHash(hash)
    } catch (err) {
      setTxError(err?.shortMessage || err?.message || 'Transaction rejected.')
      setStep('review')
    }
  }

  if (!open) return null

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Create your SMA"
      onClick={step === 'confirm' ? undefined : onClose}
    >
      <GlassCard
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
      >
        {step !== 'confirm' && (
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >×</button>
        )}

        {/* The stepper guides the user through the explainer.
            Once the SMA is deployed, the modal is no longer an explainer
            — it's a single celebratory success card, so the stepper
            chrome disappears. */}
        {step !== 'ready' && <Stepper step={step} />}

        {step === 'intro'   && <IntroStep onContinue={() => setStep('review')} />}
        {step === 'review'  && (
          <ReviewStep
            onBack={() => setStep('intro')}
            onSign={handleSign}
            networks={networks}
            onNetworksChange={setNetworks}
            error={txError}
            ownerAddress={ownerAddress}
          />
        )}
        {step === 'confirm' && <ConfirmStep confirmed={txConfirmed} networks={networks} />}
        {step === 'ready'   && <ReadyStep safeAddress={deployedSafe} onContinue={() => { onClose?.(); onComplete?.(createdAccount) }} />}
      </GlassCard>
    </div>
  )
}

const STEPS = [
  { id: 'intro',   label: 'Intro' },
  { id: 'review',  label: 'Review' },
  { id: 'confirm', label: 'Confirm' },
]

function Stepper({ step }) {
  const currentIdx = STEPS.findIndex((s) => s.id === step)
  return (
    <div className={styles.stepper} aria-label="Setup progress">
      {STEPS.map((s, i) => {
        const status = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming'
        return (
          <span key={s.id} className={styles.stepGroup}>
            <span className={`${styles.step} ${styles[`step_${status}`]}`}>
              <span className={styles.stepCircle} aria-hidden>
                {status === 'done'
                  ? <CheckSm />
                  : i + 1}
              </span>
              {status === 'current' && <span className={styles.stepLabel}>{s.label}</span>}
            </span>
            {i < STEPS.length - 1 && (
              <span className={`${styles.stepLine} ${i < currentIdx ? styles.stepLineDone : ''}`} aria-hidden />
            )}
          </span>
        )
      })}
    </div>
  )
}

/* ─────────── Step 1 · Intro ─────────── */
function IntroStep({ onContinue }) {
  return (
    <section className={styles.body}>
      <div className={styles.heroSai} aria-hidden>
        <Sai size={56} animate />
      </div>
      <header className={styles.header}>
        <span className={styles.kicker}>FIRST AGENT</span>
        <h2 className={`${shared.displayHeadline} ${styles.headline}`}>
          Before creating your first agent, we&rsquo;ll create your SMA.
        </h2>
        <p className={styles.sub}>
          Your Separately Managed Account is the self-custody smart contract that your AI operates inside. It&rsquo;s deployed once. You alone control it.
        </p>
      </header>

      <ul className={styles.points}>
        <li style={{ '--i': 0 }}>
          <Bullet />
          <div>
            <span className={styles.pointTitle}>You own this account</span>
            <span className={styles.pointSub}>Not Sail. Not the AI. Only the wallet you just connected.</span>
          </div>
        </li>
        <li style={{ '--i': 1 }}>
          <Bullet />
          <div>
            <span className={styles.pointTitle}>Bounded delegation</span>
            <span className={styles.pointSub}>Every agent has cap, time, and venue limits — enforced onchain.</span>
          </div>
        </li>
        <li style={{ '--i': 2 }}>
          <Bullet />
          <div>
            <span className={styles.pointTitle}>Revoke at any time</span>
            <span className={styles.pointSub}>One signature halts every running agent. No waiting period.</span>
          </div>
        </li>
      </ul>

      <SailButton fullWidth onClick={onContinue}>
        Continue
      </SailButton>
      <p className={styles.fineprint}>You can stop at any step. Nothing happens onchain until you sign.</p>
    </section>
  )
}

/* ─────────── Step 2 · Review ─────────── */
function ReviewStep({ onBack, onSign, networks, onNetworksChange, error, ownerAddress }) {
  const selectedNets = ALL_NETWORKS.filter((n) => networks.includes(n.id))
  const totalGasUsd = selectedNets.reduce((sum, n) => sum + parseGasUsd(n.gas), 0)
  const gasLabel = formatGasUsd(totalGasUsd)
  const [signing, setSigning] = useState(false)

  // The deploy target chain is the first selected (handleSign deploys to one).
  // When that chain has a Sail deployment the tx is a kernel createAccount —
  // deploy + register in one — otherwise a plain, unmanaged Safe proxy.
  const targetNet = selectedNets[0]
  let deployment = null
  if (targetNet) {
    try { deployment = getSailDeployment(targetNet.chainId) } catch { /* not yet deployed */ }
  }
  const managed = Boolean(deployment)

  async function handleSign() {
    setSigning(true)
    try { await onSign() } finally { setSigning(false) }
  }

  return (
    <section className={styles.body}>
      <header className={styles.headerCentered}>
        <span className={styles.kicker}>REVIEW &amp; SIGN</span>
        <h2 className={`${shared.displayHeadline} ${styles.headline}`}>
          Deploy your SMA.
        </h2>
        <p className={styles.sub}>
          One signature creates a self-custody smart account.<br />
          No AI has access until you create your first agent.
        </p>
      </header>

      <div className={styles.txPanel}>
        <header className={styles.txPanelHeader}>
          <span className={styles.txPanelKicker}>What you are signing</span>
          <NetworkMultiSelect value={networks} onChange={onNetworksChange} />
        </header>
        <dl className={styles.txDetails}>
          <TxRow k="Transaction" v={managed ? 'Deploy & register SMA' : 'Safe proxy deployment'} />
          <TxRow
            k={`Network${selectedNets.length === 1 ? '' : 's'}`}
            v={<NetworkSummary nets={selectedNets} />}
          />
          {managed
            ? <TxRow k="SailKernel" v={`${deployment.kernel.slice(0, 10)}…`} />
            : <TxRow k="Factory" v={`${SAFE_V141.proxyFactory.slice(0, 10)}…`} />}
          <TxRow
            k={selectedNets.length === 1 ? 'Gas estimate' : `Gas estimate · ${selectedNets.length} chains`}
            v={gasLabel}
            accent
          />
        </dl>
      </div>

      {error && <p style={{ color: '#ff6b6b', fontSize: 13, margin: '8px 0 0', textAlign: 'center' }}>{error}</p>}

      <div className={styles.actions}>
        <SailButton fullWidth onClick={handleSign} disabled={selectedNets.length === 0 || signing}>
          {signing ? 'Check your wallet…' : 'Sign & deploy'}
        </SailButton>
        <button type="button" className={styles.linkBtn} onClick={onBack}>
          Back
        </button>
      </div>
    </section>
  )
}

/* Comma-separated list of selected networks with their brand-tinted
   dots. Falls back to "N networks" once we pass three so the row
   stays a single line on narrow modals. */
function NetworkSummary({ nets }) {
  if (nets.length === 0) return <span style={{ opacity: 0.6 }}>None selected</span>
  if (nets.length <= 3) {
    return (
      <span className={styles.netSummary}>
        {nets.map((n, i) => (
          <span key={n.id} className={styles.netSummaryItem}>
            <span
              className={styles.netSelectDot}
              style={{ background: n.color, boxShadow: `0 0 6px ${n.color}66` }}
              aria-hidden
            />
            <span>{n.name}</span>
            {i < nets.length - 1 && <span className={styles.netSummarySep} aria-hidden>·</span>}
          </span>
        ))}
      </span>
    )
  }
  return (
    <span className={styles.netSummary}>
      <span className={styles.netSummaryStack} aria-hidden>
        {nets.slice(0, 4).map((n) => (
          <span
            key={n.id}
            className={styles.netSummaryStackDot}
            style={{ background: n.color, boxShadow: `0 0 6px ${n.color}66` }}
          />
        ))}
      </span>
      <span>{nets.length} networks</span>
    </span>
  )
}

function parseGasUsd(s) {
  const m = String(s ?? '').match(/\$(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}
function formatGasUsd(n) {
  if (n < 1) return `$${n.toFixed(2)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${Math.round(n)}`
}

/* ─────────── Step 3 · Confirm ─────────── */
function ConfirmStep({ confirmed }) {
  return (
    <section className={`${styles.body} ${styles.bodyCentered}`}>
      <div className={`${styles.confirmIndicator} ${confirmed ? styles.confirmDone : ''}`}>
        {confirmed ? (
          <svg viewBox="0 0 32 32" width="48" height="48" aria-hidden>
            <circle cx="16" cy="16" r="14" fill="none" stroke="var(--accent-blue)" strokeWidth="2" />
            <path d="M9 16.5l4.5 4.5L23 11" fill="none" stroke="var(--accent-blue)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className={styles.pulse} />
        )}
      </div>
      <h2 className={`${shared.displayHeadline} ${styles.confirmHeadline}`}>
        {confirmed ? 'Transaction confirmed.' : 'Waiting for confirmation…'}
      </h2>
      <p className={styles.confirmSub}>
        {confirmed ? 'Your SMA is live.' : 'Approve the deployment in your wallet, then wait for the block.'}
      </p>
    </section>
  )
}

/* "A and B" / "A, B, and C" / "A, B, C, and D" — used in the
   "live on X, Y, and Z" line under the confirmation check. */
function formatList(items) {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/* ─────────── Step 4 · Ready ─────────── */
function ReadyStep({ onContinue, safeAddress }) {
  return (
    <section className={`${styles.body} ${styles.bodyCentered}`}>
      <span className={styles.successHalo} aria-hidden>
        <Sai size={56} animate />
      </span>
      <header className={styles.headerCentered}>
        <span className={styles.kicker}>SMA READY</span>
        <h2 className={`${shared.displayHeadline} ${styles.headline}`}>
          Your account is ready.
        </h2>
        {safeAddress && (
          <p className={styles.sub} style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
            {safeAddress}
          </p>
        )}
        <p className={styles.sub}>
          Open a chat with your AI and ask it to draft your first agent.<br />
          When it&rsquo;s ready you&rsquo;ll see it here, waiting for your signature.
        </p>
      </header>

      <SailButton fullWidth onClick={onContinue}>
        Open my dashboard
      </SailButton>
      <p className={styles.fineprint}>
        Tip: paste your SMA address into your AI chat to start.
      </p>
    </section>
  )
}

const ALL_NETWORKS = [
  // ── Mainnets ─────────────────────────────────────────────────────────
  { id: 'base',             name: 'Base',             chainId: 8453,   color: '#0052FF', gas: '$0.18',  tier: 'L2',      sail: true },
  { id: 'arbitrum',         name: 'Arbitrum One',     chainId: 42161,  color: '#28A0F0', gas: '$0.42',  tier: 'L2',      sail: true },
  { id: 'ethereum',         name: 'Ethereum',         chainId: 1,      color: '#627EEA', gas: '$24.80', tier: 'L1',      sail: true },
  { id: 'unichain',         name: 'Unichain',         chainId: 130,    color: '#FF007A', gas: '$0.10',  tier: 'L2',      sail: true },
  // ── Testnets ─────────────────────────────────────────────────────────
  { id: 'sepolia',          name: 'Ethereum Sepolia', chainId: 11155111, color: '#627EEA', gas: '$0.01', tier: 'Testnet', sail: true },
  { id: 'baseSepolia',      name: 'Base Sepolia',     chainId: 84532,    color: '#3c6ef5', gas: '$0.01', tier: 'Testnet', sail: true },
  { id: 'arbitrumSepolia',  name: 'Arbitrum Sepolia', chainId: 421614,   color: '#28A0F0', gas: '$0.01', tier: 'Testnet', sail: true },
  { id: 'unichainSepolia',  name: 'Unichain Sepolia', chainId: 1301,     color: '#FF007A', gas: '$0.01', tier: 'Testnet', sail: true },
]
const DEFAULT_NETWORK_ID = 'base'

/* Selectable network pill — multi-select. Click → drops down a list
   with brand colour-coded dots; tapping each option toggles it without
   closing the menu, so the user can fan out a deployment across as
   many chains as they want. The pill itself collapses to "N networks"
   plus a stack of dots once more than one is selected. */
function NetworkMultiSelect({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const selected = ALL_NETWORKS.filter((n) => value.includes(n.id))
  const single = selected.length === 1 ? selected[0] : null

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!e.target?.closest?.(`.${styles.netSelectWrap}`)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle(id) {
    const next = value.includes(id)
      ? value.filter((v) => v !== id)
      : [...value, id]
    // Always keep at least one selected — the SMA needs a home chain.
    if (next.length === 0) return
    onChange?.(next)
  }

  return (
    <span className={styles.netSelectWrap}>
      <button
        type="button"
        className={`${styles.netSelectBtn} ${open ? styles.netSelectBtnOpen : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {single ? (
          <>
            <span
              className={styles.netSelectDot}
              style={{ background: single.color, boxShadow: `0 0 6px ${single.color}66` }}
              aria-hidden
            />
            <span className={styles.netSelectName}>{single.name}</span>
          </>
        ) : (
          <>
            <span className={styles.netSelectStack} aria-hidden>
              {selected.slice(0, 4).map((n) => (
                <span
                  key={n.id}
                  className={styles.netSelectStackDot}
                  style={{ background: n.color, boxShadow: `0 0 6px ${n.color}66` }}
                />
              ))}
            </span>
            <span className={styles.netSelectName}>
              {selected.length === 0
                ? 'Select networks'
                : `${selected.length} networks`}
            </span>
          </>
        )}
        <svg
          viewBox="0 0 12 12"
          width="10"
          height="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`${styles.netSelectCaret} ${open ? styles.netSelectCaretOpen : ''}`}
          aria-hidden
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div className={styles.netSelectMenu} role="listbox" aria-multiselectable="true" aria-label="EVM networks">
          <header className={styles.netSelectMenuHeader}>
            <span className={styles.netSelectMenuKicker}>
              {selected.length === 0
                ? 'Select at least one chain'
                : `${selected.length} selected`}
            </span>
            <button
              type="button"
              className={styles.netSelectMenuLink}
              onClick={() => onChange?.([DEFAULT_NETWORK_ID])}
            >
              Reset
            </button>
          </header>
          <ul className={styles.netSelectMenuList}>
            {ALL_NETWORKS.map((n) => {
              const checked = value.includes(n.id)
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    className={`${styles.netSelectOption} ${checked ? styles.netSelectOptionActive : ''}`}
                    onClick={() => toggle(n.id)}
                  >
                    <span
                      className={styles.netSelectDot}
                      style={{ background: n.color, boxShadow: `0 0 6px ${n.color}66` }}
                      aria-hidden
                    />
                    <span className={styles.netSelectOptionBody}>
                      <span className={styles.netSelectOptionName}>
                        {n.name}
                        {n.sail && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent-blue)', opacity: 0.9 }}>● Sail</span>}
                      </span>
                      <span className={styles.netSelectOptionMeta}>{n.tier} · chain {n.chainId}</span>
                    </span>
                    <span
                      className={`${styles.netSelectCheckbox} ${checked ? styles.netSelectCheckboxOn : ''}`}
                      aria-hidden
                    >
                      {checked && (
                        <svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 7.4l2.6 2.6L11 4.4" />
                        </svg>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </span>
  )
}

/* ─────────── helpers ─────────── */
function TxRow({ k, v, accent }) {
  return (
    <div className={styles.txRow}>
      <dt>{k}</dt>
      <dd className={accent ? styles.gas : ''}>{v}</dd>
    </div>
  )
}

function Bullet() {
  return (
    <span className={styles.checkBubble} aria-hidden>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l5 5L20 7" />
      </svg>
    </span>
  )
}

function CheckSm() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5l2.6 2.6L11 4" />
    </svg>
  )
}
