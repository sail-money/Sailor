import { useEffect, useState } from 'react'
import { GlassCard, Sai, SailButton, RevealCalldata } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './CreateSMAModal.module.css'
import { mockDeploy } from '../signing/mockData'

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
  const [progress, setProgress] = useState('idle')
  // Multi-network deploy — the SMA is created counterfactually on every
  // selected chain at the same address. Default to the user's "home"
  // chain, but they can fan it out to as many as they want.
  const [networks, setNetworks] = useState([DEFAULT_NETWORK_ID])

  // Reset when the modal opens so a re-open always starts at step 1.
  useEffect(() => {
    if (!open) return
    setStep('intro')
    setProgress('idle')
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape' && step !== 'confirm') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Drive the confirm → ready transition on a timer (mock chain settle).
  useEffect(() => {
    if (step !== 'confirm') return
    setProgress('waiting')
    const t1 = setTimeout(() => setProgress('confirmed'), 1700)
    const t2 = setTimeout(() => setStep('ready'), 3000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [step])

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
            onSign={() => setStep('confirm')}
            networks={networks}
            onNetworksChange={setNetworks}
          />
        )}
        {step === 'confirm' && <ConfirmStep progress={progress} networks={networks} />}
        {step === 'ready'   && <ReadyStep onContinue={() => { onClose?.(); onComplete?.() }} />}
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
function ReviewStep({ onBack, onSign, networks, onNetworksChange }) {
  const selectedNets = EVM_NETWORKS.filter((n) => networks.includes(n.id))
  const totalGasUsd = selectedNets.reduce((sum, n) => sum + parseGasUsd(n.gas), 0)
  const gasLabel = formatGasUsd(totalGasUsd)
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
          <NetworkMultiSelect
            value={networks}
            onChange={onNetworksChange}
          />
        </header>
        <dl className={styles.txDetails}>
          <TxRow k="Transaction" v={mockDeploy.type} />
          <TxRow
            k={`Network${selectedNets.length === 1 ? '' : 's'}`}
            v={<NetworkSummary nets={selectedNets} />}
          />
          <TxRow
            k={selectedNets.length === 1 ? 'Gas estimate' : `Gas estimate · ${selectedNets.length} chains`}
            v={gasLabel}
            accent
          />
        </dl>
        <div className={styles.txPanelFooter}>
          <RevealCalldata
            calldata={mockDeploy.calldata}
            label="View calldata"
            caption="The exact deployment payload."
          />
        </div>
      </div>

      <div className={styles.actions}>
        <SailButton fullWidth onClick={onSign} disabled={selectedNets.length === 0}>
          {selectedNets.length <= 1
            ? 'Sign & deploy'
            : `Sign & deploy on ${selectedNets.length} chains`}
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
function ConfirmStep({ progress, networks }) {
  const done = progress === 'confirmed'
  const selectedNets = EVM_NETWORKS.filter((n) => (networks ?? []).includes(n.id))
  const liveLabel = selectedNets.length === 0
    ? 'Your SMA is live.'
    : selectedNets.length === 1
      ? `Your SMA is live on ${selectedNets[0].name}.`
      : `Your SMA is live on ${formatList(selectedNets.map((n) => n.name))}.`
  return (
    <section className={`${styles.body} ${styles.bodyCentered}`}>
      <div className={`${styles.confirmIndicator} ${done ? styles.confirmDone : ''}`}>
        {done ? (
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
        {done ? 'Account deployed.' : 'Waiting for your signature…'}
      </h2>
      <p className={styles.confirmSub}>
        {done ? liveLabel : 'Approve the deployment in your wallet to continue.'}
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
function ReadyStep({ onContinue }) {
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

/* ─────────── EVM network catalog ───────────
   Every chain Sail's Safe singleton is (or could be) deployed on.
   Each entry carries a brand-tinted dot colour, the chainId, and a
   plausible gas estimate so the review row updates as the user picks. */
const EVM_NETWORKS = [
  // Mainnets
  { id: 'arbitrum',     name: 'Arbitrum One',   chainId: 42161,  color: '#28A0F0', gas: '$0.42', tier: 'L2' },
  { id: 'base',         name: 'Base',           chainId: 8453,   color: '#0052FF', gas: '$0.18', tier: 'L2' },
  { id: 'optimism',     name: 'Optimism',       chainId: 10,     color: '#FF0420', gas: '$0.24', tier: 'L2' },
  { id: 'ethereum',     name: 'Ethereum',       chainId: 1,      color: '#627EEA', gas: '$24.80', tier: 'L1' },
  { id: 'polygon',      name: 'Polygon PoS',    chainId: 137,    color: '#8247E5', gas: '$0.06', tier: 'Sidechain' },
  { id: 'bnb',          name: 'BNB Chain',      chainId: 56,     color: '#F3BA2F', gas: '$0.12', tier: 'L1' },
  { id: 'avalanche',    name: 'Avalanche',      chainId: 43114,  color: '#E84142', gas: '$0.34', tier: 'L1' },
  { id: 'linea',        name: 'Linea',          chainId: 59144,  color: '#61DFFF', gas: '$0.20', tier: 'L2 zk' },
  { id: 'zksync',       name: 'zkSync Era',     chainId: 324,    color: '#8C8DFC', gas: '$0.22', tier: 'L2 zk' },
  { id: 'scroll',       name: 'Scroll',         chainId: 534352, color: '#FFEEDA', gas: '$0.32', tier: 'L2 zk' },
  { id: 'mantle',       name: 'Mantle',         chainId: 5000,   color: '#000000', gas: '$0.14', tier: 'L2' },
  { id: 'blast',        name: 'Blast',          chainId: 81457,  color: '#FCFC03', gas: '$0.18', tier: 'L2' },
  { id: 'mode',         name: 'Mode',           chainId: 34443,  color: '#DFFE00', gas: '$0.16', tier: 'L2' },
  { id: 'manta',        name: 'Manta Pacific',  chainId: 169,    color: '#23AAF2', gas: '$0.20', tier: 'L2' },
  { id: 'polygonzkevm', name: 'Polygon zkEVM',  chainId: 1101,   color: '#9F71E8', gas: '$0.26', tier: 'L2 zk' },
  { id: 'celo',         name: 'Celo',           chainId: 42220,  color: '#FCFF52', gas: '$0.08', tier: 'L1' },
  { id: 'gnosis',       name: 'Gnosis Chain',   chainId: 100,    color: '#04795B', gas: '$0.04', tier: 'L1' },
  { id: 'fantom',       name: 'Fantom',         chainId: 250,    color: '#1969FF', gas: '$0.10', tier: 'L1' },
  { id: 'metis',        name: 'Metis',          chainId: 1088,   color: '#00DACC', gas: '$0.18', tier: 'L2' },
  { id: 'cronos',       name: 'Cronos',         chainId: 25,     color: '#002D74', gas: '$0.14', tier: 'L1' },
  { id: 'moonbeam',     name: 'Moonbeam',       chainId: 1284,   color: '#53CBC8', gas: '$0.12', tier: 'L1' },
  { id: 'fraxtal',      name: 'Fraxtal',        chainId: 252,    color: '#F3C26C', gas: '$0.20', tier: 'L2' },
]
const DEFAULT_NETWORK_ID = 'arbitrum'

/* Selectable network pill — multi-select. Click → drops down a list
   with brand colour-coded dots; tapping each option toggles it without
   closing the menu, so the user can fan out a deployment across as
   many chains as they want. The pill itself collapses to "N networks"
   plus a stack of dots once more than one is selected. */
function NetworkMultiSelect({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const selected = EVM_NETWORKS.filter((n) => value.includes(n.id))
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
            {EVM_NETWORKS.map((n) => {
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
                      <span className={styles.netSelectOptionName}>{n.name}</span>
                      <span className={styles.netSelectOptionMeta}>{n.tier} · chainId {n.chainId}</span>
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
