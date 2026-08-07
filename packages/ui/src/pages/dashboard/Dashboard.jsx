import { useEffect, useRef, useState } from 'react'
import OnboardingWizard, { CreateSmaStep } from '../onboarding/OnboardingWizard'
import { useSandboxMode } from '../../hooks/useSandboxMode'
import { useSandbox } from '../../sandboxContext'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount, useDisconnect } from 'wagmi'
import { sailDeployments } from '@sail/sdk/deployments'
import { explorerAddressUrl, explorerCodeUrl as libExplorerCodeUrl, explorerTxUrl, nativeCurrencySymbol } from '../../lib/explorer'
import { chainDisplayName, chainSlug, chainSafePrefix, slugToChainId } from '../../lib/chains'
import {
  ChainGlyph,
  InfoTip,
  MandateStatus,
  NativeCurrencyGlyph,
  Sai,
  SailButton,
} from '../shared'
import { describePermission } from '../../lib/permissions'
import debankIcon from '../shared/debank.png'
import sailorMark from '../shared/sailor-mark.png'
import robotMark from '../shared/robot-mark.svg'
import shared from '../shared/shared.module.css'
import styles from './Dashboard.module.css'
import agentStyles from './SharedLayout.module.css'
import AIHandoffModal from './AIHandoffModal'
import VersionWarning from './VersionWarning'
import ProfileModal from './ProfileModal'
import RevokeMandateModal from './RevokeMandateModal'
import AddSignerModal from './AddSignerModal'
import RotateSignerModal from './RotateSignerModal'
import FundGasModal from './FundGasModal'
import RpcSection from './RpcSection'
import SmaForkControls from './SmaForkControls'
import {
  useSailorAccount,
  useSailorAccounts,
  useSailorActivity,
  useSailorAgentStatus,
  useSailorMandate,
  useSailorMandateDraft,
  useSailorOverview,
  useSailorOverviews,
  useSailorPending,
  useSailorPositions,
  switchSailorAccount,
  renameSailorAccount,
} from '../../hooks/useSailorData'

/**
 * Dashboard — SMA-centric main view.
 *
 * Mental model: one SMA holds one mandate (a bundle of permissions);
 * multiple agent wallets run under that one mandate; activity is
 * a single decision journal across all of them.
 *
 * Layout (top to bottom, matching the framework spec):
 *   1. Page header — brand + notifications + wallet identity
 *   2. SMA title block — name, address pill, created date, Stop-all
 *   3. Quick links — View Portfolio (DeBank) + Manage SMA (Safe)
 *   4. Your mandate — permissions list (✓ allowed / ✗ disallowed)
 *   5. Your agents — agent wallets (each with ERC-8004 identity)
 *   6. Recent activity — Agent Decision Journal
 *
 * The previous All-Agents grid is retired; users navigate by SMA, not
 * by mandate. Drill-down to a single agent wallet still lives at
 * /agent/:id.
 */

// Testnets we deliberately never surface in the Sailor UI (Base/Ethereum
// Sepolia and their siblings). Filtered out of every chain list, the
// Add-network picker, and the switchers so they can't render anywhere. UI
// policy (includes testnets that aren't in the SDK registry), not chain metadata.
const HIDDEN_CHAIN_IDS = new Set([84532, 11155111, 421614, 1301, 11155420, 4801])
// Chains an SMA can actually be deployed to — those with a live Sail kernel.
// Drives the "Add network" picker (deployable − already-deployed). Same source
// the onboarding wizard uses so the two never drift.
const DEPLOYABLE_CHAIN_IDS = Object.keys(sailDeployments).map(Number).filter((id) => !HIDDEN_CHAIN_IDS.has(id))
function safeAppUrl(network, address) {
  const id = typeof network === 'number' ? network : slugToChainId(network)
  return `https://app.safe.global/home?safe=${chainSafePrefix(id)}:${address}`
}
function explorerUrl(network, address) {
  // Chain-aware (F5); falls back to Etherscan only for genuinely unknown chains.
  return explorerAddressUrl(network, address) ?? `https://etherscan.io/address/${address}`
}
function explorerCodeUrl(network, address) {
  return libExplorerCodeUrl(network, address) ?? `${explorerUrl(network, address)}#code`
}

function truncateAddr(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
function truncateSma(addr) {
  if (!addr) return ''
  return `${addr.slice(0, 10)}…${addr.slice(-7)}`
}

// ── Live data (.sail/) helpers ────────────────────────────────────────────────
//
// Mirrors the plain-English output of the @sail/sdk template explainers for the
// permission templates the DCA mandate uses. Kept local to avoid coupling the
// browser bundle to the SDK's built output. Unknown templates fall back to no
// detail lines (the template name still renders).
const PERMISSION_EXPLAINERS = {
  SharedBoundedSwapPermission: (p) => [
    `Maximum swap size: $${Number(p.maxSwapValueUsd ?? 0).toLocaleString()} USD per transaction`,
    `Maximum slippage: ${Number(p.maxSlippageBps ?? 0) / 100}%`,
    `Allowed input tokens: ${(p.allowedInputTokens ?? []).join(', ')}`,
    `Allowed output tokens: ${(p.allowedOutputTokens ?? []).join(', ')}`,
    `Allowed protocols: ${(p.allowedProtocols ?? []).join(', ')}`,
  ],
  SharedTransferTargetPermission: (p) => [
    `ERC-20 transfers restricted to ${(p.allowedRecipients ?? []).length} approved recipient(s)`,
    `Applies to: ${(p.allowedTokens ?? []).length === 0 ? 'all tokens' : (p.allowedTokens ?? []).join(', ')}`,
    `Approved recipients: ${(p.allowedRecipients ?? []).join(', ')}`,
  ],
}

function explainPermission(perm) {
  const fn = PERMISSION_EXPLAINERS[perm?.template]
  if (!fn) return []
  try {
    return fn(perm.params ?? {})
  } catch {
    return []
  }
}

// Plain-language one-liner for what a permission lets the agent do, matched from
// the permission/template name — see lib/permissions.js (shared with the signing
// page so the two never drift).

function fmtActivityTime(ts) {
  try {
    const d = new Date(ts)
    // Include both date and time, e.g. "May 31, 14:48"
    const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return `${datePart}, ${timePart}`
  } catch {
    return ts ?? ''
  }
}

// Human labels for the signing-request kinds the agent pushes to the signing page.
// Mirrors the signing page's own KIND_LABELS so the bell dropdown and the page
// read the same way.
const SIGNING_KIND_LABELS = {
  'create-sma': 'Create Safe (SMA)',
  'deploy-mandate': 'Deploy mandate',
  'register-permission': 'Register permission',
  'attach-mandate': 'Register mandate',
  'set-delegate': 'Set agent as manager',
  'arbitrary-tx': 'Arbitrary transaction',
}

const ACTIVITY_LABELS = {
  // Agent wallet (agent) — from `sailor run`
  dispatch_executed: 'executed dispatch',
  dispatch_approved: 'approved dispatch',
  dispatch_denied: 'denied dispatch',
  tick_start: 'tick started',
  tick_end: 'tick ended',
  error: 'error',
  log: 'log',
  // Agent-submitted on-chain confirmations
  permission_registered: 'registered permission',
  permission_revoked: 'revoked permission',
  // Owner — from the signing page + owner-paid txs
  owner_signed: 'signed in wallet',
  owner_rejected: 'rejected signing',
  sma_created: 'created Safe (SMA)',
  mandate_deployed: 'deployed mandate',
  mandate_attached: 'registered mandate',
}

const SUCCESS_TYPES = new Set([
  'dispatch_executed',
  'dispatch_approved',
  'owner_signed',
  'sma_created',
  'mandate_deployed',
  'mandate_attached',
  'permission_registered',
])
const REJECTED_TYPES = new Set([
  'dispatch_denied',
  'error',
  'owner_rejected',
  'permission_revoked',
])

function activityStatus(type) {
  if (SUCCESS_TYPES.has(type)) return 'success'
  if (REJECTED_TYPES.has(type)) return 'rejected'
  return 'info'
}

/** Normalize the actor for display; events written before the field default to agent. */
function activityActor(e) {
  return e.actor === 'owner' ? 'owner' : 'agent'
}

const ACTOR_LABEL = { owner: 'Owner', agent: 'Agent' }

/**
 * Secondary text for an activity row. Owner/lifecycle events carry richer
 * fields (title, mandate name + address) than the agent's dispatch events,
 * so we surface the most specific identifier available and fall back honestly.
 */
function activityDetail(e) {
  if (e.type === 'owner_signed' || e.type === 'owner_rejected') {
    return e.title ?? e.reason ?? e.kind ?? ''
  }
  if (e.type === 'sma_created') return truncateAddr(e.sma)
  if (e.type === 'mandate_deployed' || e.type === 'mandate_attached') {
    return e.name ?? truncateAddr(e.address ?? e.permission)
  }
  if (e.type === 'permission_registered' || e.type === 'permission_revoked') {
    const base = e.name ?? truncateAddr(e.permission)
    if (e.type === 'permission_registered' && e.feeEth) {
      const symbol = e.feeSymbol ?? nativeCurrencySymbol(e.chainId)
      return `${base} · fee ${e.feeEth} ${symbol}`
    }
    return base
  }
  if (e.permission) {
    const base = truncateAddr(e.permission)
    // Dispatch events now carry the decoded amount (S4) — surface "how much
    // moved" instead of only the permission address. `allowance` is an approve,
    // not a transfer, so it's labelled distinctly.
    if (e.amountFormatted) {
      // A max-uint (unlimited) approval is flagged rather than printed as its
      // ~78-digit value; show "unlimited" in place of the number.
      const num = e.unlimited ? 'unlimited' : e.amountFormatted
      const amt = `${num}${e.tokenSymbol ? ` ${e.tokenSymbol}` : ''}`
      const label = e.amountKind === 'allowance' ? `${amt} allowance` : amt
      return `${label} · ${base}`
    }
    return base
  }
  return e.reason ?? e.msg ?? ''
}

// ── Overview helpers (active mandates + signer balances) ──────────────────────

/** Compact native-balance formatting: keep small balances legible. */
function fmtEth(eth) {
  const n = Number(eth ?? 0)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  if (n < 0.0001) return n.toFixed(6)
  return n.toFixed(n < 1 ? 5 : 4)
}

const BALANCE_STATUS = {
  ok: { label: 'Funded' },
  low: { label: 'Low gas balance' },
  critical: { label: 'Empty' },
}

const SIGNER_ROLE = {
  manager: { label: 'Agent' },
  owner: { label: 'Owner' },
  permissionSigner: { label: 'Permission signer' },
}

/**
 * Per-chain panel for multi-chain SMAs: shows mandates + account details for one chain.
 */
// Build a mandate's permission list: prefer the on-chain set (source of truth),
// enriched with local explanation/params from mandate.json (matched by address);
// fall back to the local mandates' permissions when there is no on-chain data.
// Ensures every registered permission shows even if mandate.json is partial.
function buildMandatePermissions(overviewMandates, liveMandates, addressByTemplate) {
  const liveByAddr = new Map()
  for (const lm of liveMandates ?? []) {
    for (const p of (lm.permissions ?? [])) {
      const a = (p.address ?? addressByTemplate?.get(p.template))?.toLowerCase()
      if (a) liveByAddr.set(a, p)
    }
  }
  if ((overviewMandates ?? []).length > 0) {
    return overviewMandates.map((m) => {
      const live = liveByAddr.get(m.address?.toLowerCase())
      return {
        template: m.name ?? m.template ?? 'Unknown permission',
        address: m.address,
        params: live?.params,
        explanation: live?.explanation,
      }
    })
  }
  return (liveMandates ?? []).flatMap((lm) => lm.permissions ?? [])
}

/** Delegated-signer balances with top-up status. */
function SignersPanel({ overview, sma, onAddSigner, onRotateSigner, stacked = false }) {
  const _wallet = useAccount()
  const { address: wagmiAddress } = _wallet
  const rawSigners = overview?.signers ?? []
  const ownerLower = overview?.sma?.owner?.toLowerCase() ?? null

  // The owner EOA can also be the delegated manager (e.g. an SMA created with
  // no separate manager wallet, or rotated back to the owner). Don't render it
  // as a second "manager" card — collapse it into the single EOA/owner card and
  // tag that card instead. Track whether the owner is a manager (and active) so
  // the owner card can show the tag + the rotate control.
  let ownerIsManager = false
  let ownerManagerActive = false

  // Expand manager signers that have a known managers list into one card each.
  const signers = rawSigners.flatMap((s) => {
    if (s.role === 'manager' && s.managers?.length > 0) {
      // The active on-chain manager (s.address) isn't always present in the
      // recorded managers list — e.g. an imported SMA, or setManager called
      // out-of-band. Without this, the expand drops the active EOA entirely so
      // it never shows in the gas section. Prepend it (with its real balance +
      // status) when it's missing.
      let list = s.managers
      if (s.address && !list.some((m) => m.address?.toLowerCase() === s.address.toLowerCase())) {
        list = [{ address: s.address, balanceEth: s.balanceEth, isActive: true }, ...list]
      }
      const cards = []
      for (const m of list) {
        if (ownerLower && m.address?.toLowerCase() === ownerLower) {
          ownerIsManager = true
          if (m.isActive) ownerManagerActive = true
          continue // shown as the EOA/owner card, not a duplicate manager card
        }
        cards.push({
          ...s,
          address: m.address,
          balanceEth: m.balanceEth,
          // Preserve balance status only for the active manager.
          status: m.isActive ? s.status : 'idle',
          managers: undefined,
          activeManager: m.isActive,
        })
      }
      return cards
    }
    // A non-expanded manager card that is itself the owner → fold into the EOA card.
    if (s.role === 'manager' && s.address && ownerLower && s.address.toLowerCase() === ownerLower) {
      ownerIsManager = true
      if (!['local', 'unconfigured', 'idle'].includes(s.status)) ownerManagerActive = true
      return []
    }
    return [s]
  })

  // Ensure the owner appears exactly once, annotated if it's also the manager.
  // When the owner *is* the on-chain manager the server emits no separate owner
  // entry (it dedupes against the manager), so synthesize one here.
  const ownerCardIdx = signers.findIndex((s) => s.role === 'owner')
  if (ownerCardIdx !== -1) {
    signers[ownerCardIdx] = { ...signers[ownerCardIdx], isManager: ownerIsManager, managerActive: ownerManagerActive }
  } else if (ownerIsManager && ownerLower) {
    const mgr = rawSigners.find((s) => s.role === 'manager')
    signers.push({
      role: 'owner',
      address: overview.sma.owner,
      balanceEth: mgr?.balanceEth ?? null,
      status: mgr?.status,
      isManager: true,
      managerActive: ownerManagerActive,
    })
  }

  // Balances pending: RPC is configured but the on-chain read hasn't hydrated
  // yet (cold-load skeleton). Distinct from "no RPC", where balances never come.
  const balancesLoading = Boolean(overview?.rpcConfigured) && !overview?.onchain

  // While balances hydrate, seed the connected wallet (the owner EOA) as a card
  // so the user sees their address immediately — with a loading balance —
  // alongside the manager, instead of waiting for the on-chain read. Skip if
  // that address is already in the signer set. The real owner card from the
  // overview replaces it once hydrated.
  let displaySigners = signers
  if (balancesLoading && wagmiAddress &&
      !displaySigners.some((s) => s.address?.toLowerCase() === wagmiAddress.toLowerCase())) {
    displaySigners = [...displaySigners, { role: 'owner', address: wagmiAddress, balanceEth: null, status: undefined }]
  }
  // Owner first, then agent — matches the "owner sets the rules, agent executes" reading order.
  const ROLE_ORDER = { owner: 0, manager: 1, permissionSigner: 2 }
  displaySigners = [...displaySigners].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9))

  if (displaySigners.length === 0) {
    return (
      <div className={styles.signersOffline}>
        <p className={styles.signersOfflineMsg}>
          {overview?.rpcConfigured === false
            ? 'Add RPC_URL to .sail/.env.local to see balances.'
            : overview?.onchainError
              ? 'Add RPC_URL to .sail/.env.local to see balances.'
              : 'Reading balances…'}
        </p>
        {sma && (
          <SailButton variant="secondary" onClick={onAddSigner}>
            Add agent wallet
          </SailButton>
        )}
      </div>
    )
  }
  return (
    <div className={`${styles.signerGrid} ${stacked ? styles.signerGridStacked : ''}`}>
      {displaySigners.map((s) => (
        <SignerCard
          key={s.address ? `${s.role}:${s.address}` : s.role}
          signer={s}
          network={overview.network}
          chainId={overview.chainId}
          loading={balancesLoading}
          onAddSigner={onAddSigner}
          onRotateSigner={onRotateSigner}
        />
      ))}
    </div>
  )
}


// Shared chain switcher — one visual, used identically on Overview, Mandates and
// Gas wallets. Always rendered (even for a single-chain SMA, so the user always
// sees which chain they're on). `onAll`, when provided, prepends an "All chains"
// chip (Mandates only). Chips carry the ChainGlyph + display name.
function ChainSwitcher({ chains, activeChainId, onSelect, allActive = false, onAll, ariaLabel = 'Switch chain' }) {
  if (!chains || chains.length === 0) return null
  return (
    <div className={styles.chainSwitcher} role="group" aria-label={ariaLabel}>
      {onAll && (
        <button
          type="button"
          aria-pressed={allActive}
          className={`${styles.chainSwitchBtn} ${allActive ? styles.chainSwitchBtnActive : ''}`}
          onClick={onAll}
        >
          All chains
        </button>
      )}
      {chains.map((c) => {
        const isActive = !allActive && Number(c.id) === Number(activeChainId)
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={isActive}
            className={`${styles.chainSwitchBtn} ${isActive ? styles.chainSwitchBtnActive : ''}`}
            onClick={() => onSelect?.(Number(c.id))}
            title={c.name}
          >
            {c.id != null && <ChainGlyph chainId={c.id} size={14} />}
            <span>{c.name}</span>
          </button>
        )
      })}
    </div>
  )
}

// "Add a new network" — deploy the current SMA to another chain. This is the
// wallet-signed onboarding deploy (switch chain → factory deploy → sign the
// RegisterAccount digest), reusing the wizard's CreateSmaStep verbatim so the
// two never drift. It needs the SMA's ORIGINAL saltNonce (stored in
// account.json) to land at the SAME CREATE2 address — without it we can't
// guarantee the address, so we surface the CLI path instead of risking a
// mismatched deploy.
function AddNetworkModal({ open, onClose, owner, manager, saltNonce, existingSafe, deployable, onDeployed }) {
  const { isSandbox, activateForks } = useSandbox()
  const [target, setTarget] = useState(null)
  // Sandbox only: a chain has no fork until we start one, and the wagmi connector
  // can't switch to (or transact on) a chain that isn't in its fork map. So in
  // sandbox mode we must provision the target chain's fork AND rebuild the wagmi
  // config to include it BEFORE handing off to CreateSmaStep — exactly what the
  // onboarding Network step does. 'idle' | 'starting' | 'ready' | error string.
  const [forkPhase, setForkPhase] = useState('idle')
  const [forkError, setForkError] = useState('')

  useEffect(() => {
    if (!open) { setTarget(null); setForkPhase('idle'); setForkError('') }
  }, [open])

  // Pick a network to deploy to. Live mode goes straight to CreateSmaStep. In
  // sandbox mode a chain has no fork until we start one, and the wagmi connector
  // can't switch to (or transact on) a chain that isn't in its fork map — so we
  // provision the target's fork AND rebuild the wagmi config to include it
  // before handing off to CreateSmaStep (exactly what the onboarding Network
  // step does). Driven straight off the click (not a reactive effect) so it
  // fires deterministically the moment the user picks.
  async function handlePick(chainId) {
    setForkError('')
    setTarget(chainId)
    if (!isSandbox) { setForkPhase('ready'); return }
    setForkPhase('starting')
    try {
      // Current forks + which chain owns the active RPC — preserve the primary
      // and the already-running set; just add the target.
      const cur = await fetch('/api/sandbox/forks', { cache: 'no-store' }).then((r) => r.json())
      const entries = Object.values(cur?.forks ?? {})
      const readyIds = entries.filter((f) => f.status === 'ready').map((f) => f.chainId)
      const primary = entries.find((f) => f.primary)?.chainId ?? readyIds[0] ?? chainId
      const chainIds = Array.from(new Set([...readyIds, chainId]))

      const startRes = await fetch('/api/sandbox/forks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainIds, primary }),
      })
      const startData = await startRes.json().catch(() => ({}))
      if (!startRes.ok) throw new Error(startData?.error || 'Could not start a local fork for this chain.')

      // Poll until the target fork answers ready (or fails).
      const deadline = Date.now() + 40_000
      let forks = startData.forks ?? {}
      while (forks[String(chainId)]?.status !== 'ready') {
        if (forks[String(chainId)]?.status === 'failed') {
          throw new Error(forks[String(chainId)]?.error || 'The local fork for this chain failed to start.')
        }
        if (Date.now() > deadline) throw new Error('Timed out waiting for the local fork to start.')
        await new Promise((r) => setTimeout(r, 1200))
        forks = (await fetch('/api/sandbox/forks', { cache: 'no-store' }).then((r) => r.json()))?.forks ?? {}
      }

      // Rebuild the wagmi config so the connector can switch to (and sign on)
      // the new chain. Done once, here — never during the deploy loop.
      const ready = Object.values(forks).filter((f) => f.status === 'ready' && f.rpcUrl)
      activateForks?.({ forks: Object.fromEntries(ready.map((f) => [f.chainId, f.rpcUrl])), primary })
      setForkPhase('ready')
    } catch (e) {
      setForkPhase('idle')
      setForkError(e?.message || String(e))
    }
  }

  if (!open) return null
  const canDeploy = saltNonce != null && owner && manager
  // In sandbox mode, hold at the picker (showing progress/error) until the fork
  // is ready; live mode reaches CreateSmaStep as soon as a target is picked.
  const showDeployStep = target != null && (!isSandbox || forkPhase === 'ready')
  return (
    <div className={styles.addNetOverlay} role="dialog" aria-modal="true" aria-label="Add a network" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {/* Picker view gets its own solid panel; the deploy step (CreateSmaStep)
          already renders its own card, so the wrapper goes transparent + wider
          there to avoid a card-inside-a-card. */}
      <div className={`${styles.addNetModal} ${showDeployStep ? styles.addNetModalStep : ''}`}>
        {!showDeployStep ? (
          <>
            <header className={styles.addNetHead}>
              <span className={styles.addNetKicker}>ADD NETWORK</span>
              <h2 className={styles.addNetTitle}>Deploy your SMA to another chain</h2>
              <p className={styles.addNetSub}>
                Same address on every chain. Pick a network — your wallet will prompt you to
                deploy and register it, exactly like first-run setup.
              </p>
            </header>
            {target != null && isSandbox ? (
              // Sandbox: provisioning the target chain's fork before deploy.
              forkError ? (
                <>
                  <p className={styles.addNetNote}>Couldn't start a local fork for {deployable.find((c) => c.id === target)?.name ?? `chain ${target}`}: {forkError}</p>
                  <button type="button" className={styles.addNetCancel} onClick={() => { setTarget(null); setForkError('') }}>Pick another network</button>
                </>
              ) : (
                <p className={styles.addNetNote}>Starting a local fork for {deployable.find((c) => c.id === target)?.name ?? `chain ${target}`}… this can take a few seconds.</p>
              )
            ) : !canDeploy ? (
              <p className={styles.addNetNote}>
                Your SMA keeps the same address on every chain thanks to its deployment salt,
                and this project doesn't have that salt on record. Nothing is wrong with your
                SMA. To keep the address identical, add networks from the CLI instead:
                <code className={styles.addNetNoteCmd}>sailor account deploy-chain --chain &lt;id&gt;</code>
              </p>
            ) : deployable.length === 0 ? (
              <p className={styles.addNetNote}>This SMA is already live on every supported chain.</p>
            ) : (
              <div className={styles.addNetList}>
                {deployable.map((c) => (
                  <button key={c.id} type="button" className={styles.addNetOption} onClick={() => handlePick(c.id)}>
                    <ChainGlyph chainId={c.id} size={18} />
                    <span className={styles.addNetOptionName}>{c.name}</span>
                    <span className={styles.addNetOptionArrow} aria-hidden><ArrowOutIcon /></span>
                  </button>
                ))}
              </div>
            )}
            {!(target != null && isSandbox && !forkError) && (
              <button type="button" className={styles.addNetCancel} onClick={onClose}>Cancel</button>
            )}
          </>
        ) : (
          <CreateSmaStep
            compact
            owner={owner}
            managerAddress={manager}
            chainIds={[target]}
            saltNonce={saltNonce}
            existingSafe={existingSafe}
            title="Deploy to this network"
            sub="Your wallet will prompt to deploy the SMA and register it on this chain — same address as everywhere else."
            cta="Deploy to this network"
            onBack={() => { setTarget(null); setForkPhase('idle'); setForkError('') }}
            onDone={(settled) => { onDeployed?.(settled); onClose() }}
          />
        )}
      </div>
    </div>
  )
}

function SignerCard({ signer, network, chainId, loading, onAddSigner, onRotateSigner }) {
  const [copied, setCopied] = useState(false)
  const [fundOpen, setFundOpen] = useState(false)
  const nativeSymbol = nativeCurrencySymbol(chainId)
  const role = signer.role === 'sma'
    ? { label: 'SMA' }
    : (SIGNER_ROLE[signer.role] ?? { label: signer.role })
  const unconfigured = signer.status === 'unconfigured'
  const isLocal = signer.status === 'local'
  const isIdle = signer.status === 'idle'
  // activeManager is set by SignersPanel when expanding a managers list.
  // Fall back to the old derivation for non-expanded manager cards.
  const isActiveManager = signer.role === 'manager' && (
    signer.activeManager !== undefined ? signer.activeManager : (!isLocal && !unconfigured && !isIdle)
  )
  // Owner EOA that also serves as the delegated manager — tagged on the EOA
  // card rather than duplicated as a separate manager card.
  const isOwnerManager = signer.role === 'owner' && signer.isManager
  const isOwnerActiveManager = signer.role === 'owner' && signer.managerActive
  const canRotate = (isActiveManager || isOwnerActiveManager) && onRotateSigner
  const bal = signer.role === 'sma' || unconfigured || isLocal || isIdle
    ? null
    : (BALANCE_STATUS[signer.status] ?? BALANCE_STATUS.ok)
  const localBal = isLocal && signer.balanceEth != null ? Number(signer.balanceEth) : null
  // Exactly 0 = out of gas → always critical/red, even for a local (not-yet-
  // delegated) manager whose server status is 'local', not 'critical'. Excludes
  // idle managers and the SMA, which don't pay gas.
  const balNum = signer.balanceEth != null ? Number(signer.balanceEth) : null
  // Balance not hydrated yet (cold-load skeleton) — show a shimmer, not a 0 or
  // an empty/low state we can't yet vouch for.
  const balanceLoading = Boolean(loading) && !unconfigured && signer.balanceEth == null
  const isEmpty = !unconfigured && !isIdle && signer.role !== 'sma' && balNum === 0
  const isCritical = signer.status === 'critical' || isEmpty
  const needsTopUp = !balanceLoading && (signer.status === 'low' || isCritical || (isLocal && (localBal === null || localBal < 0.002)))

  function copy() {
    if (!navigator?.clipboard?.writeText) return // don't claim "copied" without a clipboard
    navigator.clipboard.writeText(signer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <article
      className={`${styles.signerCard} ${needsTopUp ? styles.signerCardWarn : ''} ${
        isCritical ? styles.signerCardCrit : ''
      }`}
    >
      {/* Banner "lid" — the role icon + label sit top-left, over a coloured header. */}
      <header className={styles.signerBanner}>
        {(signer.role === 'owner' || signer.role === 'manager' || signer.role === 'sma') && (
          <span className={styles.signerBannerIcon} aria-hidden>
            {signer.role === 'owner'
              ? <PersonGlyph />
              : signer.role === 'manager'
                ? <img src={robotMark} className={styles.signerBannerRobot} alt="" />
                : <SafeMark />}
          </span>
        )}
        <span className={styles.signerBannerLabel}>{role.label} gas wallet</span>
      </header>

      <div className={styles.signerBodyNew}>
        {/* Balance is the hero, with the status pill beside it. */}
        <div className={styles.signerBalanceRow}>
          <div className={styles.signerBalance}>
            {!unconfigured && (
              <span className={styles.ethGlyph} aria-hidden><NativeCurrencyGlyph chainId={chainId} size={28} /></span>
            )}
            {unconfigured ? (
              <span className={styles.signerBalanceNum} style={{ opacity: 0.4 }}>—</span>
            ) : balanceLoading ? (
              <>
                <span
                  className={`${styles.signerBalanceNum} ${styles.signerBalanceNumLoading}`}
                  aria-label="Loading balance"
                >
                  0.0000
                </span>
                <span className={`${styles.signerBalanceUnit} ${styles.signerBalanceNumLoading}`}>{nativeSymbol}</span>
              </>
            ) : (
              <>
                <span className={styles.signerBalanceNum}>{fmtEth(signer.balanceEth)}</span>
                <span className={styles.signerBalanceUnit}>{nativeSymbol}</span>
              </>
            )}
          </div>
          <span className={styles.signerStatusGroup}>
            {balanceLoading ? (
              <span className={`${styles.balancePill} ${styles.balancePillLoading}`}>
                <span className={styles.balancePillDot} aria-hidden />
                Reading…
              </span>
            ) : (
              <>
                {isOwnerActiveManager ? (
                  <span
                    className={styles.balancePill}
                    style={{ color: 'var(--accent-blue)' }}
                    title="This EOA is also registered as the SMA's delegated manager on-chain"
                  >
                    <span className={styles.balancePillDot} aria-hidden style={{ background: 'var(--accent-blue)' }} />
                    Active manager
                  </span>
                ) : isOwnerManager ? (
                  <span
                    className={styles.balancePill}
                    style={{ color: 'var(--text-secondary)' }}
                    title="This EOA is a known manager for this SMA, not currently active on-chain"
                  >
                    <span className={styles.balancePillDot} aria-hidden style={{ background: 'rgba(255,255,255,0.25)' }} />
                    Manager
                  </span>
                ) : null}
                {isIdle && (
                  <span className={styles.balancePill} style={{ color: 'var(--text-secondary)' }}>
                    <span className={styles.balancePillDot} aria-hidden style={{ background: 'rgba(255,255,255,0.25)' }} />
                    Idle
                  </span>
                )}
                {bal && (
                  <span className={`${styles.balancePill} ${styles[`balancePill_${signer.status}`] ?? ''}`}>
                    <span className={styles.balancePillDot} aria-hidden />
                    {bal.label}
                  </span>
                )}
                {isLocal && (
                  <span className={styles.balancePill} style={{ color: 'var(--text-secondary)' }}>
                    <span className={styles.balancePillDot} aria-hidden style={{ background: 'var(--accent-blue)' }} />
                    Not registered
                  </span>
                )}
              </>
            )}
          </span>
        </div>

        {(unconfigured || isLocal || isIdle) && (
          <p className={styles.signerSub}>
            {unconfigured
              ? 'No agent wallet assigned yet — create or import one to let your agent sign.'
              : isLocal
                ? 'Local key — not yet delegated.'
                : 'Known manager — not currently active on-chain.'}
          </p>
        )}
        {unconfigured && (
          <SailButton fullWidth variant="secondary" onClick={onAddSigner}>
            Add agent wallet
          </SailButton>
        )}

        <div className={styles.signerSpacer} />

        {/* Address + actions sit at the foot of the card, like a wallet's details row. */}
        {signer.address && (
          <footer className={styles.signerFoot}>
            <button
              type="button"
              className={styles.signerAddrPill}
              onClick={copy}
              title={signer.address}
              aria-label="Copy signer address"
            >
              <span className={styles.signerAddrMono}>{truncateAddr(signer.address)}</span>
              <span className={styles.signerAddrIcon} aria-hidden>
                {copied ? <CheckSm /> : <CopyGlyph />}
              </span>
            </button>
            <a
              className={styles.signerAddrOpen}
              href={explorerUrl(network, signer.address)}
              target="_blank"
              rel="noreferrer"
              aria-label="Open on block explorer"
            >
              <ArrowOutIcon />
            </a>
            {canRotate && (
              <button type="button" className={styles.signerRotateBtnSm} onClick={() => onRotateSigner()} title="Rotate agent keys">
                <RotateIcon />
                Rotate keys
              </button>
            )}
            {signer.role === 'manager' && isIdle && onRotateSigner && (
              <button type="button" className={styles.signerRotateBtnSm} onClick={() => onRotateSigner(signer.address)} title="Rotate to this key">
                <RotateIcon />
                Rotate to this
              </button>
            )}
          </footer>
        )}

        {needsTopUp && (
          <p className={`${styles.signerTopUpMsg} ${isCritical ? styles.signerTopUpMsgCrit : ''}`}>
            {isCritical ? 'Out of gas — agent is stalled.' : 'Running low — top up soon.'}
          </p>
        )}

        {/* Fund is always available — top the wallet up with gas at any time. */}
        {signer.address && (
          <button
            type="button"
            className={styles.signerFundBtn}
            onClick={() => setFundOpen(true)}
          >
            <span className={styles.signerFundIcon} aria-hidden><GasGlyph /></span>
            Fund gas
          </button>
        )}
      </div>
      <FundGasModal
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        signer={signer}
        network={network}
        chainId={chainId}
      />
    </article>
  )
}

/** Live mandate card built from .sail/mandate.json (replaces the mock summary cards). */
function LiveMandateCard({ mandate, network, addressByTemplate, onRevoke }) {
  const permissions = mandate?.permissions ?? []
  const status = mandate?.registeredOnChain ? 'active' : 'pending'
  const signed = mandate?.signedAt ? new Date(mandate.signedAt).toLocaleDateString() : ''
  const networkLabel = (() => {
    const disp = mandate?.chainId != null ? chainDisplayName(mandate.chainId) : null
    const n = disp ?? network ?? (mandate?.chainId ? chainSlug(mandate.chainId) : null)
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : null
  })()

  // Custom mandate name — browser-local (there's no backend field for mandate
  // names; the on-chain record has none either). Keyed by SMA + chain so each
  // card renames independently. Falls back to "Mandate · <chain>".
  const nameKey = `sail.mandateName.${(mandate?.safe ?? 'sma').toLowerCase()}.${mandate?.chainId ?? 'single'}`
  const defaultTitle = networkLabel ? `Mandate · ${networkLabel}` : 'Mandate'
  const [customName, setCustomName] = useState(() => {
    try { return localStorage.getItem(nameKey) ?? '' } catch { return '' }
  })
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  function saveName() {
    const trimmed = nameInput.trim()
    try {
      if (trimmed && trimmed !== defaultTitle) localStorage.setItem(nameKey, trimmed)
      else localStorage.removeItem(nameKey)
    } catch { /* private mode — rename just doesn't persist */ }
    setCustomName(trimmed && trimmed !== defaultTitle ? trimmed : '')
    setEditingName(false)
  }

  // Only permissions with a known on-chain address can be revoked; dedup by address
  const revokeablePool = onRevoke
    ? (() => {
        const seen = new Set()
        return permissions
          .map((p) => ({ name: p.template, address: addressByTemplate?.get(p.template) }))
          .filter((p) => {
            if (!p.address) return false
            const key = p.address.toLowerCase()
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
      })()
    : []

  return (
    <article className={styles.mandateSummary}>
      <header className={styles.mandateSummaryHead}>
        <div className={styles.mandateSummaryHeadText}>
          <span className={styles.mandateSummaryKicker}>
            Live mandate{signed ? ` · signed ${signed}` : ''}
          </span>
          {editingName ? (
            <input
              className={styles.mandateTitleInput}
              value={nameInput}
              autoFocus
              maxLength={40}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur()
                if (e.key === 'Escape') setEditingName(false)
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.mandateTitleBtn}
              onClick={() => { setNameInput(customName || defaultTitle); setEditingName(true) }}
              title="Click to rename"
            >
              <h3 className={styles.mandateSummaryTitle}>{customName || defaultTitle}</h3>
              <PencilIcon />
            </button>
          )}
        </div>
        <div className={styles.mandateSummaryHeadRight}>
          <MandateStatus status={status} />
          <span className={styles.mandateSummaryCount}>
            {permissions.length} permission{permissions.length === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      <p className={styles.mandateSummaryDesc}>
        The full set of on-chain rules your agent runs under{networkLabel ? ` on ${networkLabel}` : ''} —
        it can act only within the permissions below, and you can revoke them anytime.
      </p>

      <ul className={styles.mandateSummaryPerms}>
        {permissions.map((p, i) => {
          const addr = addressByTemplate?.get(p.template)
          // Prefer a structured explanation, then the template explainer; if
          // neither exists, fall back to a plain-language line so every
          // permission always says what it authorizes.
          const lines = p.explanation
            ? String(p.explanation).split('; ')
            : (explainPermission(p).length > 0 ? explainPermission(p) : [describePermission(p.template)])
          const body = (
            <span className={styles.mandateSummaryPermBody}>
              <span className={styles.mandateSummaryPermLabel}>{p.template}</span>
              {lines.map((line, j) => (
                <span key={j} className={styles.mandateSummaryPermSub}>
                  {line}
                </span>
              ))}
            </span>
          )
          return (
            <li key={`${p.template}-${i}`} className={styles.mandateSummaryPermRow}>
              {addr ? (
                <a
                  className={styles.mandateSummaryPermLink}
                  href={explorerCodeUrl(networkLabel, addr)}
                  target="_blank"
                  rel="noreferrer"
                  title={addr}
                >
                  {body}
                  <span className={styles.mandateSummaryPermArrow} aria-hidden><ArrowOutIcon /></span>
                </a>
              ) : body}
            </li>
          )
        })}
      </ul>

      <footer className={styles.mandateSummaryFoot}>
        <span className={styles.mandateSummaryFootMeta}>
          {status === 'active' ? 'Registered on-chain' : 'Signed — awaiting on-chain registration'}
        </span>
        {revokeablePool.length > 0 && (
          <button
            type="button"
            className={styles.mandateRevokeBtn}
            onClick={() => onRevoke(revokeablePool)}
          >
            Revoke permissions
          </button>
        )}
      </footer>
    </article>
  )
}


function txUrl(network, hash) {
  // Chain-aware (F5); falls back to Etherscan only for genuinely unknown chains.
  return explorerTxUrl(network, hash) ?? `https://etherscan.io/tx/${hash}`
}

const ACTIVITY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'owner', label: 'Owner' },
  { key: 'agent', label: 'Agent' },
]

/**
 * Groups raw activity events into ticks (agent runs) + standalone owner events.
 * permToChain: Map<permAddrLower, chainId> — used to tag ticks and events with
 * the chain they ran on so the chain filter can work without a server-side change.
 */
function groupActivityItems(events, permToChain = new Map()) {
  const items = []
  let openTick = null
  for (const e of events) {
    // chainId from the event itself (written by CLI since this fix) takes priority;
    // fall back to permToChain lookup for older events without explicit chainId.
    const eventChain = e.chainId ?? (e.permission ? (permToChain.get(e.permission.toLowerCase()) ?? null) : null)
    if (e.type === 'tick_start') {
      openTick = { kind: 'tick', startTs: e.ts, endTs: null, durationMs: null, logs: [], complete: false, chainIds: new Set() }
      if (eventChain) openTick.chainIds.add(eventChain)
    } else if (e.type === 'tick_end' && openTick) {
      if (eventChain) openTick.chainIds.add(eventChain)
      openTick.endTs = e.ts
      openTick.durationMs = new Date(e.ts) - new Date(openTick.startTs)
      openTick.complete = true
      items.push(openTick)
      openTick = null
    } else if (e.type === 'log' && openTick) {
      if (e.msg) openTick.logs.push(e.msg)
    } else if (e.type !== 'tick_start' && e.type !== 'tick_end' && e.type !== 'log') {
      if (openTick) {
        if (eventChain) openTick.chainIds.add(eventChain)
        items.push(openTick)
        openTick = null
      }
      items.push({ kind: 'event', event: { ...e, chainId: eventChain } })
    } else if (openTick && eventChain) {
      openTick.chainIds.add(eventChain)
    }
  }
  if (openTick) items.push({ kind: 'tick', ...openTick })
  return items.reverse()
}

function fmtDuration(ms) {
  if (!ms) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function TickCard({ tick, positions }) {
  const [expanded, setExpanded] = useState(false)
  const isLive = !tick.complete
  const holdLine = tick.logs.find((l) => l.includes('hold') || l.includes('below threshold'))
  const moveLine = tick.logs.find((l) => l.includes('rebalance') || l.includes('deposit') || l.includes('withdraw'))
  const portfolioLine = tick.logs.find((l) => l.startsWith('portfolio:'))
  const headline = moveLine ?? holdLine ?? portfolioLine ?? (tick.logs[0] ?? (isLive ? 'Running…' : 'Tick complete'))
  // Only a real, non-empty positions snapshot yields a header value. Previously
  // an empty snapshot (the common live case) reduced to 0 and rendered a
  // misleading "$0.00" on every tick; dispatch amounts now live on their own
  // rows (S4), so suppress the header figure unless there's genuine value.
  const totalUsd =
    positions && positions.length > 0
      ? positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0)
      : null

  return (
    <li className={styles.tickCard}>
      <button
        type="button"
        className={styles.tickCardHead}
        onClick={() => setExpanded((x) => !x)}
        aria-expanded={expanded}
      >
        <span className={`${styles.tickDot} ${isLive ? styles.tickDotLive : ''}`} aria-hidden />
        <span className={styles.tickMeta}>
          <span className={styles.tickTime}>{fmtActivityTime(tick.startTs)}</span>
          {tick.durationMs != null && (
            <span className={styles.tickDuration}>{fmtDuration(tick.durationMs)}</span>
          )}
        </span>
        <span className={styles.tickHeadline}>{headline}</span>
        {totalUsd != null && totalUsd > 0 && (
          <span className={styles.tickValue}>${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        )}
        <span className={styles.tickChevron} aria-hidden>{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className={styles.tickBody}>
          {tick.logs.map((l, i) => (
            <p key={i} className={styles.tickLog}>{l}</p>
          ))}
          {positions && positions.length > 0 && (
            <div className={styles.tickPositions}>
              {positions.map((p) => (
                <div key={p.vaultAddress} className={styles.tickPosition}>
                  <span className={styles.tickPositionToken}>{(p.token ?? 'token').toUpperCase()}</span>
                  <span className={styles.tickPositionValue}>${(p.valueUsd ?? 0).toFixed(2)}</span>
                  {p.protocol && <span className={styles.tickPositionProto}>{p.protocol}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function ActivityChainFilter({ deployedChains, chainFilter, onChainFilterChange }) {
  if (deployedChains.length <= 1) return null
  // Same chip style as the mandate switcher (glyph + name), kept as buttons.
  return (
    <div className={styles.chainSwitcher} role="group" aria-label="Filter by chain" style={{ marginBottom: 14 }}>
      <button
        type="button"
        aria-pressed={chainFilter === 'all'}
        className={`${styles.chainSwitchBtn} ${chainFilter === 'all' ? styles.chainSwitchBtnActive : ''}`}
        onClick={() => onChainFilterChange('all')}
      >
        All chains
      </button>
      {deployedChains.map((cid) => {
        const name = chainDisplayName(cid)
        const label = name ? (name.charAt(0).toUpperCase() + name.slice(1)) : `Chain ${cid}`
        return (
          <button
            key={cid}
            type="button"
            aria-pressed={chainFilter === String(cid)}
            className={`${styles.chainSwitchBtn} ${chainFilter === String(cid) ? styles.chainSwitchBtnActive : ''}`}
            onClick={() => onChainFilterChange(String(cid))}
            title={label}
          >
            <ChainGlyph chainId={cid} size={14} />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Live activity feed — groups agent ticks into collapsible summary cards,
 * keeps owner/lifecycle events as individual rows.
 */
function LiveActivityFeed({ events, positions, network, permToChain = new Map(), chainFilter = 'all', actorFilter = 'all' }) {
  const INITIAL_VISIBLE = 8
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)

  // The actor switcher now lives in the section header; reset paging when
  // either filter changes so a narrowed view starts from the top.
  useEffect(() => { setVisibleCount(INITIAL_VISIBLE) }, [actorFilter, chainFilter])

  const allItems = groupActivityItems(events, permToChain)

  const filtered = allItems.filter((item) => {
    const actorMatch = actorFilter === 'all'
      || (item.kind === 'tick' ? actorFilter === 'agent' : activityActor(item.event) === actorFilter)
    const chainMatch = chainFilter === 'all'
      || (item.kind === 'tick'
        ? item.chainIds?.has(Number(chainFilter))
        : item.event.chainId === Number(chainFilter))
    return actorMatch && chainMatch
  })

  const rows = filtered.slice(0, visibleCount)
  const hasMore = filtered.length > visibleCount

  const emptyLabel = [
    actorFilter !== 'all' ? actorFilter : null,
    chainFilter !== 'all' ? (chainDisplayName(Number(chainFilter)) ?? chainFilter) : null,
  ].filter(Boolean).join(' · ')

  return (
    <>
      {rows.length === 0 ? (
        <div className={styles.emptyAgents}>
          <p className={styles.emptyAgentsBody}>No {emptyLabel ? `${emptyLabel} ` : ''}activity yet.</p>
        </div>
      ) : (
        <>
          <ul className={`${agentStyles.journalList} ${styles.tickList}`}>
            {rows.map((item, i) => {
              if (item.kind === 'tick') {
                return <TickCard key={`tick-${item.startTs}-${i}`} tick={item} positions={positions} />
              }
              const e = item.event
              const st = activityStatus(e.type)
              const actor = activityActor(e)
              const hasTx = e.txHash && e.txHash !== '0x'
              const detail = activityDetail(e)
              return (
                <li key={`${e.ts}-${i}`}>
                  <div className={agentStyles.journalRow}>
                    <span className={agentStyles.journalTime}>{fmtActivityTime(e.ts)}</span>
                    <span
                      className={`${agentStyles.journalMark} ${agentStyles[`jStatus_${st}`] ?? ''}`}
                      aria-hidden
                    >
                      {st === 'success' && <CheckSm />}
                      {st === 'rejected' && <CrossSm />}
                      {st === 'info' && <DotSm />}
                    </span>
                    <span className={agentStyles.journalBody}>
                      <span className={agentStyles.journalTitle}>
                        <span className={`${styles.activityActor} ${styles[`activityActor_${actor}`] ?? ''}`}>
                          {ACTOR_LABEL[actor]}
                        </span>
                        <span className={agentStyles.journalAction}>
                          {ACTIVITY_LABELS[e.type] ?? e.type}
                        </span>
                      </span>
                    </span>
                    <span className={agentStyles.journalMeta}>
                      {detail}
                      {hasTx && (
                        <a
                          className={styles.activityTxLink}
                          href={txUrl(network ?? 'ethereum', e.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          title="View transaction on explorer"
                          aria-label="View transaction on explorer"
                        >
                          <ArrowOutIcon />
                        </a>
                      )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>

          {hasMore && (
            <div style={{ marginTop: '12px', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + 10)}
                style={{ padding: '6px 14px', fontSize: '13px', borderRadius: '2px', border: '1px solid var(--hairline-strong)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer' }}
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}

// Module-level cache: survives React remounts (route changes) but resets on
// a full page reload. Prevents showing the loading shell every time the
// dashboard unmounts and remounts due to navigation, while still showing it
// on the very first page load before we know the onboard state.
let _onboardCache = null

// Read a minimal synthetic onboard state from localStorage so that after a
// full page reload (e.g. triggered by a wallet redirect) we can skip the
// loading shell immediately if we already know an account exists. DashboardContent
// never uses this — it fetches its own data — so { hasAccount: true } is enough.
function localStorageOnboardHint() {
  try {
    const a = JSON.parse(localStorage.getItem('sail.account') ?? 'null')
    if (a) return { hasAccount: true }
  } catch {}
  return null
}

export default function Dashboard() {
  const [onboardState, setOnboardState] = useState(() => _onboardCache ?? localStorageOnboardHint())
  const [onboardChecked, setOnboardChecked] = useState(() => _onboardCache !== null || localStorageOnboardHint() !== null)
  const { draft } = useSailorMandateDraft()
  // True from the moment the wizard's multi-chain CreateSmaStep starts deploying
  // until the user actually leaves the wizard (Go to dashboard / Skip). account.json
  // is written after each chain succeeds (not after all of them), so the poll below
  // must not act on an account it detects while the user is still in the wizard —
  // that would unmount the wizard out from under them: mid-loop (remaining chains'
  // wallet prompts fire with no progress UI), on the error/retry screen (they can
  // never click "Retry failed chains"), or on the "done" summary (it vanishes
  // before they see which chains deployed). It is released only on the real exit
  // paths (handleOnboardComplete / onSkip) and on wizard unmount, never at loop
  // end. Resets to false on a real page reload, so the reload-recovery behavior
  // the poll exists for is unaffected.
  const activeDeployRef = useRef(false)

  function refreshOnboard() {
    fetch('/api/onboard/state')
      .then(r => r.json())
      .then(s => {
        if (activeDeployRef.current) return
        _onboardCache = s; setOnboardState(s); setOnboardChecked(true)
      })
      .catch(() => setOnboardChecked(true))
  }

  // Called by the wizard's "Go to dashboard →" button. Optimistically mark
  // hasAccount = true so the dashboard appears immediately without waiting for
  // another /api/onboard/state round-trip. Then fetch in the background to
  // populate the full state (rpcUrl, chainId, etc.).
  function handleOnboardComplete() {
    activeDeployRef.current = false // user has left the wizard — let the poll resume
    const optimistic = { ...(onboardState ?? {}), hasAccount: true }
    _onboardCache = optimistic
    setOnboardState(optimistic)
    setOnboardChecked(true)
    refreshOnboard()
  }

  useEffect(() => { refreshOnboard() }, [])

  // Poll every 2 s while we don't have an account yet. This auto-transitions the
  // UI when a wallet-triggered reload interrupts an in-progress deployment:
  // the background deployAll JS keeps running, creates account.json, and the
  // next poll picks it up so the user never needs to manually refresh.
  useEffect(() => {
    if (onboardState?.hasAccount) return
    const id = setInterval(refreshOnboard, 2000)
    return () => clearInterval(id)
  }, [onboardState?.hasAccount])

  if (!onboardChecked) return (
    <div className={`${shared.pageShell} ${styles.shell}`} />
  )
  // First-run onboarding renders inside the dashboard frame (DashboardContent),
  // so the persistent left rail — SMAs list, create/import, connect wallet —
  // stays visible while the wizard runs in the main column. The wizard is the
  // single no-SMA surface: it owns both the create flow and the import branch
  // (there is no "skip" — an accountless dashboard has nothing to show).
  // Wallet-connection state is NOT a gate — the wizard owns the connect step.
  return (
    <>
      <DashboardContent
        draft={draft}
        onReset={refreshOnboard}
        onboardState={onboardState}
        onOnboardComplete={handleOnboardComplete}
        onActiveDeployChange={(active) => { activeDeployRef.current = active }}
      />
    </>
  )
}

function DashboardContent({ draft, onReset, onboardState, onOnboardComplete, onActiveDeployChange }) {
  const onboarding = !onboardState?.hasAccount
  const isSandbox = useSandboxMode()
  // Sidebar Create/Import clicks while onboarding: bump this to steer the
  // wizard to a step ('welcome' or 'import') instead of opening the modals.
  const [wizardStepReq, setWizardStepReq] = useState(null)
  const _wallet = useAccount()
  const { isConnected, address: wagmiAddress } = _wallet
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  // Bumped on SMA switch/rename to force every panel to refetch immediately
  // instead of waiting for its next poll — the server serves the target SMA's
  // cached snapshot instantly, so the switch feels immediate.
  const [refreshTick, setRefreshTick] = useState(0)
  // Multi-chain: which deployed chain the SMA view (wallets + mandates) shows.
  // null falls back to the first deployed chain. Persisted so a reload keeps
  // showing the chain the user was last looking at rather than resetting to
  // an arbitrary one (the activeChainId fallback below already handles the
  // case where the stored chain is no longer in deployedChains).
  const [selectedChainId, setSelectedChainId] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sail.selectedChainId') ?? 'null') } catch { return null }
  })
  useEffect(() => {
    if (selectedChainId == null) return
    try { localStorage.setItem('sail.selectedChainId', JSON.stringify(selectedChainId)) } catch {}
  }, [selectedChainId])
  // Mandate section: "All chains" shows every chain's mandate at once; otherwise
  // it follows the selected chain. Independent of the wallets' chain selector.
  const [mandateAll, setMandateAll] = useState(false)
  const [addSignerOpen, setAddSignerOpen] = useState(false)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [rotateTo, setRotateTo] = useState(null) // pre-selected manager address for rotation
  // Per-chain context for the rotation. A multi-chain SMA has an independent
  // manager per chain (each chain's kernel tracks its own setManager), so the
  // modal must operate on the chain whose "Rotate" was clicked — not always the
  // primary overview. Null falls back to the active single-chain overview.
  const [rotateContext, setRotateContext] = useState(null)
  const { account: realAccount, loading: accountLoading } = useSailorAccount(refreshTick)
  const { accounts: allAccounts } = useSailorAccounts(refreshTick)
  const { overview } = useSailorOverview(refreshTick)
  const { overviews: chainOverviews } = useSailorOverviews(refreshTick)

  const permToChain = new Map()
  for (const ov of chainOverviews) {
    for (const m of ov.mandates ?? []) {
      if (m.address) permToChain.set(m.address.toLowerCase(), ov.chainId)
    }
  }
  const { mandates: liveMandates } = useSailorMandate(refreshTick)
  const { events: liveActivity } = useSailorActivity(refreshTick)
  const { positions: livePositions } = useSailorPositions(refreshTick)
  const { running: agentRunning } = useSailorAgentStatus()
  const { pending } = useSailorPending()

  const [justCreatedAccount, setJustCreatedAccount] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sail.account') ?? 'null') } catch { return null }
  })

  // We no longer auto-adopt the first Safe the connected wallet owns. An
  // existing Safe is surfaced only inside the explicit Import flow (the
  // wizard's import step), where the user picks which one to adopt as their
  // SMA — so the dashboard starts from a clean "create or import" state
  // instead of silently binding to whatever Safe happens to be associated
  // with the wallet.
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [createSMAOpen, setCreateSMAOpen] = useState(false)
  const [addNetworkOpen, setAddNetworkOpen] = useState(false)

  // Close the additional-create flow if the wallet disconnects midway — the
  // wizard reads its owner from useAccount, so continuing without a wallet
  // would build deploy txs with an undefined owner. The connect gate takes over.
  //
  // NOT in the sandbox: there the built-in dev wallet is intrinsic and always
  // available, so `isConnected` only ever drops transiently while the Network
  // step's activateForks swaps the wagmi config (it reconnects a tick later) —
  // never a real user disconnect. Closing here on that transient tore the
  // wizard down mid-flight, so a second SMA could never be created in a
  // sandbox. Live mode still closes on a genuine disconnect.
  useEffect(() => {
    if (!isSandbox && !isConnected && createSMAOpen) setCreateSMAOpen(false)
  }, [isSandbox, isConnected, createSMAOpen])
  // Same guard for the profile modal: on an out-of-band disconnect (wallet
  // extension, session expiry) the owner filter loses its address and the SMA
  // list would fall back to every owner's accounts — close it instead.
  useEffect(() => {
    if (!isConnected && profileOpen) setProfileOpen(false)
  }, [isConnected, profileOpen])
  // Which dashboard page is showing in the tab strip (populated state only).
  const [dashTab, setDashTab] = useState('sma')
  const [handoff, setHandoff] = useState(null)
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [revokeContext, setRevokeContext] = useState(null) // { sma, kernel, chainId } for multi-chain revoke
  const [activityChainFilter, setActivityChainFilter] = useState('all')
  const [activityActorFilter, setActivityActorFilter] = useState('all')
  const [safeNames, setSafeNames] = useState({})
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  // Local-first: the overview (read from .sail/ + confirmed on-chain) is the
  // primary source, so the SMA renders without a browser wallet connected. The
  // wallet is only needed for actions that actually sign. Fall back to the
  // legacy /api/account and the just-created/imported account for the setup
  // flow before an SMA exists.
  const overviewAccount = overview?.sma?.address
    ? {
        safe: overview.sma.address,
        owner: overview.sma.owner,
        permissionSigner: overview.sma.permissionSigner,
        manager: overview.sma.manager,
        chainId: overview.chainId,
      }
    : null
  // The localStorage-seeded fallback is only trusted for the CONNECTED wallet.
  // It's written on every deploy/import and never expires, so without this
  // scope a previous wallet's record leaks into effectiveAccount whenever the
  // backend is briefly unreachable — showing wallet A's SMA to wallet B.
  const scopedJustCreated = justCreatedAccount &&
    (!wagmiAddress || !justCreatedAccount.owner ||
      justCreatedAccount.owner.toLowerCase() === wagmiAddress.toLowerCase())
    ? justCreatedAccount
    : null
  const effectiveAccount = overviewAccount ?? realAccount ?? scopedJustCreated
  const hasSMA = effectiveAccount != null
  // The wizard is the single no-SMA surface: first run (no account.json yet)
  // and the account-missing recovery state both land there.
  const showWizard = onboarding || (!accountLoading && !hasSMA)
  // Pre-populated states, computed once so the main column and the sidebar
  // section nav stay in sync. The nav (My SMA / Mandates / Activity / RPCs)
  // lives in the sidebar and is only meaningful on the populated dashboard.
  const walletMismatch = isConnected && hasSMA && wagmiAddress && effectiveAccount?.owner &&
    wagmiAddress.toLowerCase() !== effectiveAccount.owner.toLowerCase()
  const showNotConnected = !isConnected
  const showScanning = !hasSMA && accountLoading
  const showTabs = !showWizard && !createSMAOpen && !walletMismatch && !showNotConnected && !showScanning

  // ── Auto-activate: recover the active SMA from the project's accounts list.
  // `hasAccount` is derived from account.json (a single "active" pointer), which
  // "Reset project" deletes — but state/accounts.json keeps every SMA ever
  // registered here. Without this, an owner whose pointer is gone gets dumped
  // into onboarding ("no SMA") despite owning SMAs in this very project, and a
  // second owner's wallet hits the wrong-wallet card instead of its own SMA.
  // If the connected wallet owns an SMA in the list but the pointer is missing
  // or belongs to a different owner, switch to the wallet's newest SMA.
  // Client-side stopgap for the backend owner-lookup (FOR_ALVARO.md §2).
  const autoActivatedRef = useRef(null)
  useEffect(() => {
    if (!isConnected || !wagmiAddress || accountLoading) return
    const owned = allAccounts.filter((a) => a.owner?.toLowerCase() === wagmiAddress.toLowerCase())
    if (owned.length === 0) return // truly nothing here for this wallet — onboarding/mismatch are correct
    const needsSwitch = onboarding || walletMismatch
    if (!needsSwitch) return
    const target = owned[owned.length - 1] // list is append-ordered → newest
    const key = `${wagmiAddress.toLowerCase()}:${target.safe.toLowerCase()}`
    if (autoActivatedRef.current === key) return // one attempt per wallet+target; don't loop on failure
    autoActivatedRef.current = key
    switchSailorAccount(target.safe)
      .then(() => {
        setRefreshTick((t) => t + 1)
        onReset?.() // refresh onboarding state so hasAccount flips without waiting for the poll
      })
      .catch(() => { /* backend offline — the usual gates stay up */ })
  }, [isConnected, wagmiAddress, accountLoading, allAccounts, onboarding, walletMismatch, onReset])
  const overviewMandates = overview?.mandates ?? []
  // The locally-signed mandate (.sail/mandate.json) is a single global file. In a
  // multi-SMA project it would otherwise render against whatever SMA is active —
  // showing a stale draft that belongs to a different account. Only treat it as
  // "this SMA's mandate" when its safe matches the active account; a legacy entry
  // with no safe is trusted only on single-SMA projects where it's unambiguous.
  const activeSafe = (overviewAccount ?? realAccount)?.safe?.toLowerCase()
  const activeLiveMandates = liveMandates.filter((m) =>
    m.safe != null ? m.safe.toLowerCase() === activeSafe : allAccounts.length <= 1
  )
  const hasLiveMandate = activeLiveMandates.length > 0
  // The unsigned draft (.sail/mandate-draft.json) is ALSO a single global file, so
  // it must be scoped the same way — otherwise a draft prepared for account A shows
  // its "ready to authorize" banner + notification on accounts B and C in a
  // multi-SMA project. Only surface it against the SMA it was prepared for (its
  // `account`/`safe`); a legacy draft with neither is trusted only on single-SMA
  // projects where it's unambiguous.
  const draftSafe = (draft?.account ?? draft?.safe)?.toLowerCase()
  const scopedDraft = draft && (draftSafe != null ? draftSafe === activeSafe : allAccounts.length <= 1)
    ? draft
    : null
  const liveMode = hasLiveMandate || agentRunning

  const realNetwork = effectiveAccount ? (chainSlug(effectiveAccount.chainId) ?? 'ethereum') : null
  const sma = effectiveAccount
    ? {
        id: 'live-sma',
        name: 'My SMA',
        address: effectiveAccount.safe,
        network: realNetwork,
      }
    : null

  // The CONNECTED wallet's identity — used by the avatar button and as the
  // owner recorded on add-by-address imports. The connected address must win:
  // preferring the active account's owner showed wallet A's address on the
  // avatar while wallet B was connected, and stamped A as the owner of SMAs
  // B imported (which owner-scoping then hid from B).
  const ownerAddr = wagmiAddress ?? effectiveAccount?.owner ?? null

  const activeAccount = allAccounts.find((a) => a.active) ?? allAccounts[0] ?? null
  // The SELECTED SMA's canonical record. account.json (realAccount) IS the selected
  // SMA and carries the full stored object (saltNonce, managers, deployedChains); the
  // list's active entry is the fallback. Deliberately NOT overview-derived: `overview`
  // lags after a switch, and using it made add-network deploy/persist the WRONG SMA.
  const selectedAccount = realAccount ?? activeAccount
  // Resolve the chains this SMA spans by unioning the account's own list with
  // the chain ids the server actually returned overviews for. `deployedChains`
  // is only set when the SMA was created through the browser flow with the full
  // list in the payload — CLI/onboarding and per-chain creates leave it unset,
  // which would otherwise collapse the badges/RPC/activity panels to one chain.
  const deployedChains = (() => {
    const chains = new Set(activeAccount?.deployedChains ?? [])
    for (const ov of chainOverviews) if (ov?.chainId != null) chains.add(Number(ov.chainId))
    if (activeAccount?.chainId != null) chains.add(Number(activeAccount.chainId))
    return [...chains].filter((c) => Number.isFinite(c) && c > 0 && !HIDDEN_CHAIN_IDS.has(c))
  })()
  // The union above is deliberately loose — a stale on-disk record (e.g. a
  // deploy probe that mis-recorded a chain) makes it claim chains the SMA was
  // never deployed to. For anything that *tells the user where the SMA is
  // live* we drop the chains the kernel has CONFIRMED it is absent from: the
  // overview's on-chain read succeeded (`onchain`) and `registered` came back
  // false. An unreadable chain (RPC down, cold cache) keeps its chip — an
  // unknown must never hide a real deployment. Display + Add-network picker
  // only: RPC config, activity filters, and the deploy persist-merge keep the
  // loose union, so a dropped chain's RPC row stays reachable and account.json
  // is never rewritten with a shrunken list.
  const confirmedNotLive = new Set(
    chainOverviews
      .filter((ov) => ov?.onchain === true && ov?.sma?.registered === false)
      .map((ov) => Number(ov.chainId))
  )
  const liveChains = deployedChains.filter((c) => !confirmedNotLive.has(c))
  // If the filter empties the list (e.g. an imported Safe registered nowhere),
  // fall back to the loose union so the row never disappears for a working
  // account.
  const liveChainsDisplay = liveChains.length > 0 ? liveChains : deployedChains
  const isMultiChain = deployedChains.length > 1
  // "Add a new network" deploys the current SMA to another chain via the
  // wallet-signed onboarding flow (AddNetworkModal → CreateSmaStep), not a
  // server action — see the modal for the full rationale.
  // The chain currently in view. For a single-chain SMA this is just `overview`;
  // for multi-chain it's the switcher's selection (falling back to the first chain).
  const activeChainId = selectedChainId != null && deployedChains.includes(Number(selectedChainId))
    ? Number(selectedChainId)
    // Default to the first CONFIRMED-live chain so a stale record can't make a
    // phantom chain the landing view (identical to deployedChains[0] whenever
    // nothing was filtered).
    : liveChainsDisplay[0]
  const activeChainOv = isMultiChain
    ? (chainOverviews.find((o) => Number(o.chainId) === activeChainId) ?? chainOverviews[0] ?? overview)
    : overview

  // Chip data for the shared ChainSwitcher (Overview / Mandates / Gas), and the
  // chains this SMA isn't on yet (the Add-network picker). Display-cased names.
  // Both derive from the confirmed-live set: the switchers claim "the SMA is
  // here" and the picker claims "it isn't", so a confirmed-absent chain moves
  // from the first list to the second instead of being stuck in neither.
  const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
  const deployedChainObjs = liveChainsDisplay
    .map((id) => ({ id, name: capitalize(chainDisplayName(id) ?? `Chain ${id}`) }))
  const deployableChainObjs = DEPLOYABLE_CHAIN_IDS
    .filter((id) => !liveChains.includes(id))
    .map((id) => ({ id, name: capitalize(chainDisplayName(id) ?? `Chain ${id}`) }))
    .filter((c) => c.name)

  const smaName = safeNames[activeAccount?.safe ?? 'live-sma'] ?? activeAccount?.name ?? sma?.name ?? 'My SMA'
  const currentSafeId = activeAccount?.safe ?? effectiveAccount?.safe ?? 'live-sma'
  // The SMA list is scoped to the CONNECTED wallet. state/accounts.json is
  // project-global (it accumulates every SMA registered here, across owners),
  // so without this filter a user who switches wallets sees other owners' SMAs
  // mixed into their list. Entries with no recorded owner are kept — hiding
  // them would strand legacy records with no way to reach them.
  const ownedAccounts = wagmiAddress
    ? allAccounts.filter((a) => !a.owner || a.owner.toLowerCase() === wagmiAddress.toLowerCase())
    : allAccounts
  const profileSafes = ownedAccounts.length > 0
    ? (() => {
        const byId = new Map()
        for (const a of ownedAccounts) {
          const key = a.safe.toLowerCase()
          const net = chainSlug(a.chainId) ?? 'ethereum'
          const isCurrent = a.safe?.toLowerCase() === currentSafeId?.toLowerCase()
          const deployedNets = a.deployedChains
            ? a.deployedChains.map((id) => chainSlug(id) ?? 'ethereum').filter(Boolean)
            : null
          // Chain ids for the row's network badges. The ACTIVE SMA uses the
          // confirmed-live set (stored deployedChains is stale for CLI and
          // per-chain creates — it collapsed multi-chain SMAs to one badge);
          // other SMAs have no overviews to consult, so their stored record
          // is the best available.
          const netIds = isCurrent && liveChainsDisplay.length > 0
            ? liveChainsDisplay
            : (Array.isArray(a.deployedChains) && a.deployedChains.length > 0
                ? a.deployedChains.map(Number).filter((id) => Number.isFinite(id) && !HIDDEN_CHAIN_IDS.has(id))
                : (a.chainId != null ? [Number(a.chainId)] : []))
          if (!byId.has(key)) {
            byId.set(key, {
              id: a.safe,
              name: safeNames[a.safe] ?? a.name ?? 'My SMA',
              address: a.safe,
              network: net,
              networks: deployedNets ?? [net],
              networkIds: [...netIds],
              mandateCount: isCurrent ? (isMultiChain && chainOverviews.length > 0 ? chainOverviews.reduce((sum, ov) => sum + (ov.mandateCount ?? 0), 0) : (overview?.mandateCount ?? 0)) : 0,
              createdAt: a.addedAt ?? null,
            })
          } else {
            const entry = byId.get(key)
            const toMerge = deployedNets ?? [net]
            for (const n of toMerge) {
              if (!entry.networks.includes(n)) entry.networks.push(n)
            }
            for (const id of netIds) {
              if (!entry.networkIds.includes(id)) entry.networkIds.push(id)
            }
          }
        }
        return [...byId.values()]
      })()
    // Fallback (no accounts list yet, e.g. pre-backfill project): the ACTIVE
    // SMA — but only when the connected wallet is its owner. Without the owner
    // gate this branch showed wallet A's SMA to a freshly connected wallet B
    // whenever B owned nothing here (ownedAccounts empty → fell through).
    : sma && effectiveAccount?.owner && wagmiAddress &&
      effectiveAccount.owner.toLowerCase() === wagmiAddress.toLowerCase()
    ? [{ ...sma, name: smaName, networks: liveChainsDisplay.length > 0 ? liveChainsDisplay.map((id) => chainSlug(id) ?? 'ethereum').filter(Boolean) : [realNetwork], networkIds: liveChainsDisplay, mandateCount: isMultiChain && chainOverviews.length > 0 ? chainOverviews.reduce((sum, ov) => sum + (ov.mandateCount ?? 0), 0) : (overview?.mandateCount ?? 0), createdAt: null }]
    : []

  const safeUrl = sma ? safeAppUrl(sma.network, sma.address) : '#'
  const debankUrl = sma ? `https://debank.com/profile/${sma.address}` : '#'

  function copySma() {
    if (!sma || !navigator?.clipboard?.writeText) return // don't claim "copied" without a clipboard
    navigator.clipboard.writeText(sma.address)
    setCopiedAddr(true)
    setTimeout(() => setCopiedAddr(false), 1400)
  }

  const [sandboxLaunching, setSandboxLaunching] = useState(false)
  async function enterSandbox() {
    setSandboxLaunching(true)
    try {
      const res = await fetch('/api/sandbox/launch', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data?.port) {
        window.location.href = `http://localhost:${data.port}/#/dashboard`
        return
      }
    } catch { /* fall through */ }
    setSandboxLaunching(false)
  }

  return (
    <div className={`${shared.pageShell} ${styles.shell} ${styles.dashRoot}`}>

      {/* ── Left menu: brand · SMA list · create/import · EOA identity.
          Replaces the old top header so the app reads like a full
          dashboard with a persistent side rail. */}
      <aside className={styles.dashSidebar}>
        <div className={styles.sidebarBrand}>
          <button
            type="button"
            className={styles.brandMarkBtn}
            // Always hard-refresh: go to the dashboard route and reload so the
            // logo doubles as a "reset the view / re-fetch everything" action,
            // even when already on the dashboard (a hash change alone is a no-op
            // there and wouldn't refresh).
            onClick={() => {
              window.location.hash = '#/dashboard'
              window.location.reload()
            }}
            aria-label="Go to dashboard (refresh)"
          >
            <img src={sailorMark} alt="" className={styles.brandMark} />
          </button>
          <span className={styles.brandTitle}>Sailor Dashboard</span>
          <VersionWarning />
        </div>

        {/* Portfolio (Debank) sits at the top, above the section nav — it's the
            primary "where's my money" jump-off, not a footer utility. */}
        {showTabs && sma && (
          <a
            className={styles.sidebarUtilLink}
            href={debankUrl}
            target="_blank"
            rel="noreferrer"
          >
            <span className={styles.sidebarUtilIcon} aria-hidden>
              <img src={debankIcon} alt="" className={styles.sidebarUtilImg} />
            </span>
            <span className={styles.sidebarUtilLabel}>View portfolio</span>
            <ArrowOutIcon />
          </a>
        )}

        {/* Symmetric to the sandbox's own "Exit to live dashboard" link — lets
            anyone jump into the sandbox without needing a connected wallet or
            an SMA on THIS (live) side first: launching/finding the sandbox
            server is independent of the live dashboard's own connection
            state, so this is deliberately NOT gated on showTabs/sma the way
            the portfolio link and section nav above are. Never shown from
            inside a sandbox page itself (that page IS the launch target). */}
        {isSandbox === false && (
          <button type="button" className={styles.sidebarUtilLink} onClick={enterSandbox} disabled={sandboxLaunching}>
            <span className={styles.sidebarUtilIcon} aria-hidden>⚓</span>
            <span className={styles.sidebarUtilLabel}>{sandboxLaunching ? 'Starting sandbox…' : 'Enter Sandbox'}</span>
            <ArrowOutIcon />
          </button>
        )}

        {/* Section nav — the dashboard's pages live here in the side rail
            (moved off the old top tab strip). Only meaningful on the
            populated dashboard; hidden during onboarding/create/scanning. */}
        {showTabs && (
          /* Plain navigation semantics (not role=tablist): these are page
             sections, and claiming tab semantics without the full keyboard
             pattern (roving tabindex, aria-controls) misleads screen readers. */
          <nav className={styles.sidebarNav} aria-label="Dashboard sections">
            {[['sma', 'Overview'], ['gas', 'Gas wallets'], ['mandates', 'Mandates'], ['activity', 'Activity'], ['rpc', 'RPCs']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-current={dashTab === key ? 'page' : undefined}
                className={`${styles.sidebarNavItem} ${dashTab === key ? styles.sidebarNavItemActive : ''}`}
                onClick={() => setDashTab(key)}
              >
                {label}
                {key === 'mandates' && pending.length > 0 && <span className={styles.dashTabDot} aria-hidden />}
              </button>
            ))}
          </nav>
        )}

        {/* Docs pinned to the bottom of the rail — external destination, not a
            dashboard section. Creating/importing SMAs now lives entirely in the
            profile modal (opened from the EOA button), not the sidebar. */}
        <div className={styles.sidebarUtils}>
          <a
            className={styles.sidebarUtilLink}
            href="https://docs.sail.money"
            target="_blank"
            rel="noreferrer"
          >
            <span className={styles.sidebarUtilIcon} aria-hidden><DocsGlyph /></span>
            <span className={styles.sidebarUtilLabel}>Docs</span>
            <ArrowOutIcon />
          </a>
        </div>

        <div className={styles.sidebarEoa}>
          <NotificationsBell
            pending={pending}
            draft={scopedDraft}
            open={notifOpen}
            onToggle={() => setNotifOpen((o) => !o)}
            onClose={() => setNotifOpen(false)}
            onOpenSigner={() => { setNotifOpen(false); window.location.hash = '#/signer' }}
            onOpenSigning={() => { setNotifOpen(false); window.location.hash = '#/signer' }}
          />
          <button
            type="button"
            className={styles.avatarBtn}
            onClick={isConnected ? () => setProfileOpen(true) : openConnectModal}
            aria-label={isConnected && ownerAddr ? `Profile (${truncateAddr(ownerAddr)})` : 'Connect wallet'}
            title={isConnected && ownerAddr ? ownerAddr : undefined}
          >
            <span className={styles.avatarBtnMonogram} aria-hidden>
              {isConnected && ownerAddr ? ownerAddr.slice(2, 4).toUpperCase() : '—'}
            </span>
            <span className={styles.avatarBtnAddr}>
              {isConnected && ownerAddr ? truncateAddr(ownerAddr) : 'Not connected'}
            </span>
          </button>
        </div>
      </aside>

      <main className={`${agentStyles.main} ${styles.dashMain}`}>
        {/* No SMA yet: the wizard is the single onboarding surface — it owns
            both the create flow and the import branch, and runs in the main
            column (no tab strip — nothing to navigate yet). Checked first so
            a disconnected new user gets the wizard, not the not-connected
            card (the wizard owns the connect step). */}
        {showWizard ? (
          <OnboardingWizard
            onboardState={onboardState}
            onComplete={onOnboardComplete}
            onActiveDeployChange={onActiveDeployChange}
            requestedStep={wizardStepReq}
          />
        ) : createSMAOpen ? (
          // Create another SMA: the same onboarding flow, but the owner is
          // already connected and the agent key exists, so it runs network →
          // deploy only (additional mode). Replaces the old FIRST-AGENT modal.
          <OnboardingWizard
            additional
            onboardState={onboardState}
            onActiveDeployChange={onActiveDeployChange}
            onCancel={() => setCreateSMAOpen(false)}
            onComplete={() => { setCreateSMAOpen(false); setRefreshTick((t) => t + 1) }}
          />
        ) : walletMismatch ? (
          <WalletMismatchCard
            projectOwner={effectiveAccount.owner}
            connectedAddress={wagmiAddress}
            onReset={async () => {
              await fetch('/api/account', { method: 'DELETE' }).catch(() => {})
              onReset()
            }}
            // RainbowKit's openConnectModal is undefined while a wallet is
            // connected — and on this card one always is. Disconnect instead:
            // the app falls to the connect gate, where the user picks the
            // owner wallet.
            onConnect={() => disconnect()}
            // Non-destructive path for a new wallet: the additional-create
            // wizard deploys an SMA owned by the CONNECTED wallet (it reads
            // useAccount) and appends it to the project — nothing is reset.
            // createSMAOpen renders before this branch, so it swaps the card
            // for the wizard.
            onCreate={() => setCreateSMAOpen(true)}
          />
        ) : showNotConnected ? (
          <ConnectGate onConnect={openConnectModal} />
        ) : showScanning ? (
          <ScanningHero />
        ) : (
          <>
            {/* Section nav now lives in the left rail (styles.sidebarNav) —
                the old top tab strip was removed. */}
            {scopedDraft && draftItemCount(scopedDraft) > 0 && (
              <DraftBanner
                draft={scopedDraft}
                onReview={() => { window.location.hash = '#/signer' }}
              />
            )}
            {pending.length > 0 && (
              <PendingBanner
                count={pending.length}
                onReview={() => { window.location.hash = '#/signer' }}
              />
            )}

            {/* ── SMA title block ────────────────────────────────────
                The SMA is the page subject. Name on the left at h1
                weight, "Stop all agents" at the top-right as the
                destructive global lever. Below: address pill (copy =
                deposit UI) and created-date meta. */}
            {/* ── Identity card: SMA + Owner + Agent grouped, each with an
                info tooltip, so the three roles read as one connected unit. ── */}
            {dashTab === 'sma' && (
            <>
            <PageHead
              icon={<OverviewGlyph />}
              title="Overview"
              info="This is your separately managed account: a Safe you own. It shows the account's address and the chains it's running on. To see the portfolio it holds, open View portfolio to review it on DeBank."
            />
            <section className={styles.identityCard} aria-label="Account identity">
              {/* Two-column header: identity + purpose on the left, status chips
                  on the right — fills the wide card instead of left-stacking. */}
              <div className={styles.identityHeader}>
                <div className={styles.identityMain}>

              <div className={styles.titleHeadFlex}>
                {editingName ? (
                  <input
                    className={styles.titleNameInput}
                    value={nameInput}
                    autoFocus
                    maxLength={40}
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={() => {
                      const trimmed = nameInput.trim()
                      if (trimmed && trimmed !== smaName) {
                        setSafeNames((m) => ({ ...m, [currentSafeId]: trimmed }))
                        renameSailorAccount(currentSafeId, trimmed).catch(() => {})
                        setRefreshTick((t) => t + 1)
                      }
                      setEditingName(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.target.blur()
                      if (e.key === 'Escape') { setEditingName(false) }
                    }}
                  />
                ) : (
                  <div className={styles.titleNameGroup}>
                    <button
                      type="button"
                      className={styles.titleNameBtn}
                      onClick={() => { setNameInput(smaName); setEditingName(true) }}
                      title="Click to rename"
                    >
                      <h2 className={agentStyles.title}>{smaName}</h2>
                      <PencilIcon />
                    </button>
                    {/* The "manage account" action lives here as the Safe mark next
                        to the rename pencil — hovering explains the SMA is a Safe;
                        clicking opens it in the Safe app. */}
                    <a
                      className={styles.safeChip}
                      href={safeUrl}
                      target="_blank"
                      rel="noreferrer"
                      tabIndex={0}
                      aria-label="This SMA is a Safe smart account — open it in the Safe app"
                    >
                      <span className={styles.safeChipIcon} aria-hidden><SafeMark /></span>
                      <div className={styles.safeChipPop} role="tooltip">
                        <span className={styles.safeChipPopTitle}>Safe smart account</span>
                        <span className={styles.safeChipPopBody}>
                          Your SMA is a self-custodial Safe — a smart-contract wallet you
                          fully control, with the same address on every chain. Manage settings
                          in the Safe app.
                        </span>
                        <span className={styles.safeChipPopLink}>Open in Safe <ArrowOutIcon /></span>
                      </div>
                    </a>
                  </div>
                )}
              </div>

                </div>
              </div>

              {/* Funds — deposit (money in) and portfolio (review) as two equal
                  cards side by side, so the section uses the card's width. */}
              <div className={styles.fundsGroup}>
                <span className={styles.fundsLabel}>Funds</span>
                <div className={styles.fundsGrid}>
                  <div className={styles.fundCard}>
                    <span className={styles.fundCardLabel}>
                      SMA address
                      <InfoTip label="SMA address">
                        Send tokens here on any chain you've deployed to.
                      </InfoTip>
                    </span>
                    <button
                      type="button"
                      className={styles.fundAddr}
                      onClick={copySma}
                      aria-label="Copy SMA address"
                      title={sma?.address}
                    >
                      <span className={styles.fundAddrMono}>{truncateSma(sma?.address)}</span>
                      <span className={styles.fundAddrIcons} aria-hidden>
                        <span className={styles.fundAddrIcon}>{copiedAddr ? <CheckSm /> : <CopyGlyph />}</span>
                        <a
                          href={explorerUrl(sma?.network, sma?.address)}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.fundAddrIcon}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Open SMA on block explorer"
                        >
                          <ArrowOutIcon />
                        </a>
                      </span>
                    </button>
                  </div>
                  {/* Portfolio — the funds grid's second slot. Everything the SMA
                      holds, without the dashboard doing oracle/RPC work: Debank
                      reads the address directly. */}
                  <div className={styles.fundCard}>
                    <span className={styles.fundCardLabel}>Portfolio</span>
                    <a
                      className={styles.fundAddr}
                      href={debankUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View this SMA's portfolio on Debank"
                    >
                      <span className={styles.fundPortfolioBody}>
                        <img src={debankIcon} alt="" className={styles.fundPortfolioImg} />
                        View portfolio
                      </span>
                      <span className={styles.fundAddrIcons} aria-hidden>
                        <span className={styles.fundAddrIcon}><ArrowOutIcon /></span>
                      </span>
                    </a>
                  </div>
                </div>
              </div>

              {/* Networks this SMA is live on — shown horizontally, always (even
                  a single chain), so the user always sees where it runs. The
                  Add-network deploy flow lives directly under it. */}
              {deployedChainObjs.length > 0 && (
                <div className={styles.liveInGroup}>
                  <span className={styles.fundsLabel}>SMA live in</span>
                  <ChainSwitcher
                    chains={deployedChainObjs}
                    activeChainId={activeChainId}
                    onSelect={setSelectedChainId}
                    ariaLabel="Networks this SMA is live on"
                  />
                  <button type="button" className={styles.addNetworkBtn} onClick={() => setAddNetworkOpen(true)}>
                    <span className={styles.addNetworkPlus} aria-hidden>+</span>
                    Add a new network
                  </button>
                  {/* Sandbox only: turn this SMA's per-chain forks on/off,
                      bounded by the sandbox chain cap. No-op in live mode. */}
                  <SmaForkControls chains={deployedChainObjs} />
                </div>
              )}

            </section>
            </>
            )}

            {/* ── Gas Wallets — own subpage. Owner + agent gas balances,
                funded by copying each address (see FundGasModal). ── */}
            {dashTab === 'gas' && (
            <>
            <PageHead
              icon={<GasGlyph />}
              title="Gas wallets"
              info="The two wallets that pay for signatures and dispatches. Your funds stay in the SMA."
            />
            <section className={styles.identityCard} aria-label="Gas wallets">
              {deployedChainObjs.length > 0 && (
                <ChainSwitcher
                  chains={deployedChainObjs}
                  activeChainId={activeChainId}
                  onSelect={setSelectedChainId}
                  ariaLabel="View gas wallets by chain"
                />
              )}
              <div className={styles.idWalletsGroup}>
                <SignersPanel
                  stacked
                  overview={activeChainOv}
                  sma={sma}
                  onAddSigner={() => setAddSignerOpen(true)}
                  onRotateSigner={activeChainOv?.kernel && activeChainOv?.sma?.address
                    ? (addr) => {
                        setRotateContext({
                          sma: activeChainOv.sma.address,
                          kernel: activeChainOv.kernel,
                          chainId: activeChainOv.chainId,
                          owner: activeChainOv.sma.owner,
                          currentManager: activeChainOv.sma.manager,
                          mandates: activeChainOv.mandates ?? [],
                        })
                        setRotateTo(addr ?? null)
                        setRotateOpen(true)
                      }
                    : undefined}
                />
              </div>
            </section>
            </>
            )}

            {/* ── Mandates + Account Details ──────────────────────
                Multi-chain SMAs get one section per deployed chain.
                Single-chain SMAs get the original layout. */}
            {/* ── Your Mandates — ONE section. A multi-chain SMA filters per chain
                with the switcher below, rather than repeating a section per chain. ── */}
            {dashTab === 'mandates' && (() => {
              // Build the mandate-card data for a single chain overview.
              const buildForOverview = (ov, requireChainMatch) => {
                const oms = ov?.mandates ?? []
                const safeLower = ov?.sma?.address?.toLowerCase()
                const live = liveMandates.filter((m) =>
                  (m.safe == null || m.safe.toLowerCase() === safeLower) &&
                  (!requireChainMatch || m.chainId === ov?.chainId)
                )
                const abt = new Map(oms.map((m) => [m.name ?? m.template, m.address]))
                const perms = buildMandatePermissions(oms, live, abt)
                return { ov, perms, abt, has: oms.length > 0 || live.length > 0 }
              }
              const renderCard = (b) => (
                <LiveMandateCard
                  key={b.ov?.chainId ?? 'single'}
                  mandate={{
                    chainId: b.ov?.chainId,
                    registeredOnChain: (b.ov?.mandates?.length ?? 0) > 0,
                    safe: b.ov?.sma?.address,
                    permissions: b.perms,
                  }}
                  network={b.ov?.network ?? realNetwork}
                  addressByTemplate={b.abt}
                  onRevoke={b.ov?.kernel && b.ov?.sma?.address
                    ? (target) => { setRevokeContext({ sma: b.ov.sma.address, kernel: b.ov.kernel, chainId: b.ov.chainId }); setRevokeTarget(target) }
                    : undefined}
                />
              )

              // Active (single) chain data — the default view.
              const active = buildForOverview(activeChainOv, isMultiChain)
              // All-chains data — one card per deployed chain that has a mandate.
              const allBuilt = isMultiChain ? chainOverviews.map((ov) => buildForOverview(ov, true)).filter((b) => b.has) : []

              const showAll = isMultiChain && mandateAll
              const permCount = showAll
                ? allBuilt.reduce((s, b) => s + b.perms.length, 0)
                : active.perms.length
              return (
                <>
                <PageHead
                  icon={<MandateGlyph />}
                  title="Mandates"
                  info="This is what your agent is allowed to do. The permissions live on-chain. Nothing slips past them, and you can revoke them any time."
                />
                <section className={styles.mandatesSection} aria-label="Mandates">
                  <header className={styles.mandatesSectionHead}>
                    <span className={styles.mandatesSectionMeta}>
                      {permCount > 0
                        ? `${permCount} permission${permCount === 1 ? '' : 's'}`
                        : 'No permissions registered yet'}
                    </span>
                  </header>
                  <ChainSwitcher
                    chains={deployedChainObjs}
                    activeChainId={activeChainId}
                    onSelect={(id) => { setMandateAll(false); setSelectedChainId(id) }}
                    allActive={showAll}
                    onAll={isMultiChain ? () => setMandateAll(true) : undefined}
                    ariaLabel="View mandates by chain"
                  />
                  <div className={styles.mandateList}>
                    {showAll ? (
                      allBuilt.length > 0
                        ? allBuilt.map(renderCard)
                        : <NewMandateTile onClick={() => setHandoff({ variant: 'new', context: 'mandate' })} />
                    ) : active.has ? (
                      renderCard(active)
                    ) : (
                      <NewMandateTile onClick={() => setHandoff({ variant: 'new', context: 'mandate' })} />
                    )}
                  </div>
                </section>
                </>
              )
            })()}

            {/* ── RPC / Network config ─────────────────────────────── */}
            {dashTab === 'rpc' && (
            <>
            <PageHead
              icon={<NetworkGlyph />}
              title="Network RPCs"
              info="How Sailor reads chains and sends transactions."
            />
            <section className={agentStyles.card}>
              <RpcSection deployedChains={deployedChains} embedded />
            </section>
            </>
            )}

            {/* ── Recent activity / Decision Journal ─────────────── */}
            {dashTab === 'activity' && (
            <>
            <PageHead
              icon={<ActivityGlyph />}
              title="Recent Activity"
              info="Every agent decision and on-chain action on this SMA, newest first."
            />
            <section className={agentStyles.card}>
              <header className={agentStyles.cardHead}>
                <div className={styles.activityFilter} role="group" aria-label="Filter by actor">
                  {ACTIVITY_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      aria-pressed={activityActorFilter === f.key}
                      className={`${styles.activityFilterBtn} ${activityActorFilter === f.key ? styles.activityFilterBtnActive : ''}`}
                      onClick={() => setActivityActorFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </header>

              <ActivityChainFilter
                deployedChains={deployedChains}
                chainFilter={activityChainFilter}
                onChainFilterChange={setActivityChainFilter}
              />

              {liveActivity.length > 0 ? (
                <LiveActivityFeed
                  events={liveActivity}
                  positions={livePositions}
                  network={realNetwork}
                  permToChain={permToChain}
                  chainFilter={activityChainFilter}
                  actorFilter={activityActorFilter}
                />
              ) : (
                <div className={styles.emptyAgents}>
                  <p className={styles.emptyAgentsBody}>
                    {liveMode
                      ? <>No activity yet — run <code>sailor run</code> to start</>
                      : 'Activity from your agents will appear here.'}
                  </p>
                </div>
              )}
            </section>
            </>
            )}

            {/* Local-first disclosure — calm footer so the user knows
                Sail runs entirely on their machine. No hosted backend,
                no remote state. The Studio they're looking at lives at
                localhost; all project state is under .sail/ on disk. */}
            <footer className={styles.localFootnote}>
              <span className={styles.localFootnoteDot} aria-hidden />
              Running locally at <code>{window.location.host}</code> · state in <code>.sail/</code>
              {' '}· no hosted backend.
            </footer>
          </>
        )}
      </main>

      <AIHandoffModal
        open={!!handoff}
        variant={handoff?.variant}
        context={handoff?.context}
        mandate={handoff?.mandate}
        onClose={() => setHandoff(null)}
      />

      <ProfileModal
        open={profileOpen}
        wallet={ownerAddr}
        safes={profileSafes}
        currentSafeId={currentSafeId}
        hasSMA={hasSMA}
        accountLoading={accountLoading}
        onClose={() => setProfileOpen(false)}
        onDisconnect={() => {
          setProfileOpen(false)
          // Disconnect ONLY disconnects the wallet. It must never touch the
          // project's account registration — an earlier version DELETEd
          // account.json here, which silently wiped a freshly created SMA from
          // the project (the record, not the on-chain Safe). The dashboard
          // falls back to the "Connect to view your SMA" gate, and reconnecting
          // the owner restores the full view. Destructive reset stays where it
          // is explicit: the wallet-mismatch card's reset action.
          disconnect()
        }}
        onCreateSMA={() => {
          setProfileOpen(false)
          // No SMA yet → the wizard is the create path; the modal is only for
          // adding another SMA once one exists.
          if (showWizard) setWizardStepReq({ name: 'welcome', tick: Date.now() })
          else setCreateSMAOpen(true)
        }}
        onImportSMA={(account) => {
          setJustCreatedAccount(account)
          try { localStorage.setItem('sail.account', JSON.stringify(account)) } catch {}
          fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account) }).catch(() => {})
          setRefreshTick((t) => t + 1)
          setProfileOpen(false)
        }}
        onRenameSafe={(id, name) => {
          setSafeNames((m) => ({ ...m, [id]: name }))
          renameSailorAccount(id, name).catch(() => {})
          setRefreshTick((t) => t + 1)
        }}
        onSelectSafe={async (sma) => {
          try { await switchSailorAccount(sma.address) } catch { /* server not running */ }
          setRefreshTick((t) => t + 1)
          setProfileOpen(false)
        }}
      />

      <AddSignerModal
        open={addSignerOpen}
        safe={overview?.sma?.address}
        onClose={() => setAddSignerOpen(false)}
        onCreated={() => { setAddSignerOpen(false); setRefreshTick((t) => t + 1) }}
      />

      <RotateSignerModal
        open={rotateOpen}
        sma={rotateContext?.sma ?? overview?.sma?.address}
        kernel={rotateContext?.kernel ?? overview?.kernel}
        chainId={rotateContext?.chainId ?? overview?.chainId}
        owner={rotateContext?.owner ?? overview?.sma?.owner}
        currentManager={rotateContext?.currentManager ?? overview?.sma?.manager}
        mandates={rotateContext?.mandates ?? overview?.mandates ?? []}
        initialTo={rotateTo}
        onClose={() => { setRotateOpen(false); setRotateTo(null); setRotateContext(null) }}
        onRotated={() => setRefreshTick((t) => t + 1)}
      />

      <RevokeMandateModal
        open={revokeTarget != null}
        mandate={Array.isArray(revokeTarget) ? undefined : revokeTarget}
        permissions={Array.isArray(revokeTarget) ? revokeTarget : undefined}
        sma={revokeContext?.sma ?? overview?.sma?.address}
        kernel={revokeContext?.kernel ?? overview?.kernel}
        chainId={revokeContext?.chainId ?? overview?.chainId}
        onClose={() => { setRevokeTarget(null); setRevokeContext(null) }}
        onRevoked={() => { setRevokeTarget(null); setRevokeContext(null) }}
      />

      <AddNetworkModal
        open={addNetworkOpen}
        onClose={() => setAddNetworkOpen(false)}
        owner={selectedAccount?.owner}
        manager={selectedAccount?.manager}
        saltNonce={selectedAccount?.saltNonce}
        existingSafe={selectedAccount?.safe}
        deployable={deployableChainObjs}
        onDeployed={(settled) => {
          // Add-network = append chain(s) to the SELECTED SMA. Everything comes from
          // ONE record (selectedAccount = account.json) so the deploy and the persist
          // can't disagree about which SMA they target. The server merges by `safe`,
          // so this only expands the existing SMA — it never creates a new one.
          const newChains = (settled ?? []).map((s) => Number(s.chainId)).filter(Boolean)
          if (newChains.length === 0 || !selectedAccount?.safe) { setRefreshTick((t) => t + 1); return }
          const merged = [...new Set([
            ...(selectedAccount.deployedChains ?? (selectedAccount.chainId ? [selectedAccount.chainId] : [])),
            ...newChains,
          ])]
          fetch('/api/account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              safe: selectedAccount.safe,
              owner: selectedAccount.owner,
              manager: selectedAccount.manager,
              chainId: selectedAccount.chainId,
              deployedChains: merged,
            }),
          }).catch(() => {}).finally(() => setRefreshTick((t) => t + 1))
        }}
      />
    </div>
  )
}

/* ────────── Gated states (connect / wrong-wallet) ──────────
   Both render embedded + left-aligned in the main column (sidebar stays), so
   they read as part of the dashboard rather than a floating modal — matching
   the onboarding wizard's bare, left-aligned treatment. */
function ConnectGate({ onConnect }) {
  return (
    <div className={styles.gate}>
      <div className={styles.gateMark} aria-hidden>
        <Sai size={52} animate />
      </div>
      <span className={styles.gateKicker}>Dashboard</span>
      <h2 className={styles.gateTitle}>Connect to view your SMA.</h2>
      <p className={styles.gateSub}>
        Connect your wallet — its SMAs load automatically. New wallet? You can
        create an SMA right after connecting.
      </p>
      <div className={styles.gateActions}>
        <SailButton onClick={onConnect}>Connect wallet</SailButton>
      </div>
      <p className={styles.gateFineprint}>Self-custody. Sail never holds your keys.</p>
    </div>
  )
}

function WalletMismatchCard({ projectOwner, connectedAddress, onReset, onConnect, onCreate }) {
  const [resetting, setResetting] = useState(false)
  return (
    <div className={styles.gate}>
      <span className={`${styles.gateKicker} ${styles.gateKickerWarn}`}>Different owner</span>
      <h2 className={styles.gateTitle}>
        This wallet has no SMA in this project yet.
        <InfoTip label="What is a project?">
          A project is the local <code>.sail/</code> folder this dashboard runs on — it holds the
          list of SMAs set up here, their keys, and config, all on your machine. One project can
          hold SMAs from several wallets; each wallet only sees its own.
        </InfoTip>
      </h2>
      <dl className={styles.gateMeta}>
        <div className={styles.gateMetaRow}>
          <dt>Active SMA owner</dt>
          <dd><code>{truncateAddr(projectOwner)}</code></dd>
        </div>
        <div className={styles.gateMetaRow}>
          <dt>Connected</dt>
          <dd><code>{truncateAddr(connectedAddress)}</code></dd>
        </div>
      </dl>
      {/* One decision per row: action + what it does. The old three-buttons-
          in-a-row read as a puzzle — no room to explain any of them. */}
      <div className={styles.gateChoices}>
        {onCreate && (
          <div className={styles.gateChoice}>
            <SailButton fullWidth onClick={onCreate}>Create an SMA with this wallet →</SailButton>
            <p className={styles.gateChoiceSub}>
              Sets up a new SMA owned by {truncateAddr(connectedAddress)}. Existing SMAs are untouched.
            </p>
          </div>
        )}
        <div className={styles.gateChoice}>
          <SailButton fullWidth variant="secondary" onClick={onConnect}>Switch wallet</SailButton>
          <p className={styles.gateChoiceSub}>
            Disconnect, then reconnect with the owner wallet ({truncateAddr(projectOwner)}) to manage its SMA.
          </p>
        </div>
        <div className={styles.gateChoice}>
          <button
            type="button"
            className={styles.gateResetBtn}
            disabled={resetting}
            onClick={async () => { setResetting(true); await onReset() }}
          >
            {resetting ? 'Resetting…' : 'Reset project'}
          </button>
          <p className={styles.gateChoiceSub}>
            Clears the active SMA and returns you to setup. Your SMA list and keys stay
            saved in this project, and nothing is touched on-chain — reconnecting the
            owner brings it all back.
          </p>
        </div>
      </div>
    </div>
  )
}

function ScanningHero() {
  // Same left-aligned gate language as ConnectGate — this brief loading state
  // was the last surface still using the old centered-mascot hero.
  return (
    <div className={styles.gate}>
      <div className={styles.gateMark} aria-hidden>
        <Sai size={52} animate />
      </div>
      <span className={styles.gateKicker}>Dashboard</span>
      <h2 className={styles.gateTitle}>Loading your project…</h2>
      <p className={styles.gateSub}>Reading local state from <code>.sail/</code>.</p>
    </div>
  )
}

// CLI writes `permissions: [{address, label}]`; older format uses `items: [{template, explanation}]`.
function draftItemCount(draft) {
  return (draft?.permissions ?? draft?.items ?? []).length
}

/* ────────── Draft banner (mandate prepare queued) ────────── */
function DraftBanner({ draft, onReview }) {
  const count = draftItemCount(draft)
  return (
    <button
      type="button"
      className={`${styles.pendingBanner} ${styles.pendingBannerDraft}`}
      onClick={onReview}
      aria-label="Review pending mandate draft"
    >
      <span className={styles.pendingBannerPulse} aria-hidden />
      <span className={styles.pendingBannerBody}>
        <span className={styles.pendingBannerKicker}>Mandate draft ready</span>
        <span className={styles.pendingBannerTitle}>
          <strong>{count}</strong> permission{count === 1 ? '' : 's'} queued — sign or reject
        </span>
      </span>
    </button>
  )
}

/* ────────── Pending banner ────────── */
function PendingBanner({ count, onReview }) {
  return (
    <button
      type="button"
      className={styles.pendingBanner}
      onClick={onReview}
      aria-label={`Review ${count} pending mandates`}
    >
      <span className={styles.pendingBannerPulse} aria-hidden />
      <span className={styles.pendingBannerBody}>
        <span className={styles.pendingBannerKicker}>Awaiting your signature</span>
        <span className={styles.pendingBannerTitle}>
          <strong>{count}</strong> mandate{count === 1 ? '' : 's'} ready to authorize
        </span>
      </span>
      <span className={styles.pendingBannerCta}>
        Review
        <ArrowRightSm />
      </span>
    </button>
  )
}

function NewMandateTile({ onClick }) {
  return (
    <button type="button" className={styles.newMandateTile} onClick={onClick}>
      <span className={styles.newMandateTilePlus} aria-hidden>+</span>
      <span className={styles.newMandateTileText}>
        <span className={styles.newMandateTileLabel}>Register a permission</span>
        <span className={styles.newMandateTileHint}>
          Draft with your AI.
        </span>
      </span>
    </button>
  )
}


/* ────────── Notifications bell + dropdown ──────────
   The bell badges the count of signing requests the agent has pushed to the
   running signing server (via /api/station/pending — the server's internal
   endpoint path, unrenamed). The dropdown gives a brief read on each pending
   tx/signature without leaving the dashboard; "Open signing page" jumps to
   #/signer to actually approve. */
function NotificationsBell({ pending, draft, open, onToggle, onClose, onOpenSigner, onOpenSigning }) {
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose()
    }
    function onEsc(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open, onClose])

  const draftCount = draftItemCount(draft)
  const hasDraft = draftCount > 0
  const count = pending.length + (hasDraft ? 1 : 0)

  return (
    <div className={styles.notifWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.notifBtn} ${count > 0 ? styles.notifBtnLive : ''}`}
        onClick={onToggle}
        aria-label={count > 0 ? `${count} pending signatures` : 'Pending signatures'}
        aria-expanded={open}
      >
        <BellIcon />
        {count > 0 && <span className={styles.notifBadge}>{count}</span>}
      </button>

      {open && (
        <div className={styles.notifPanel} role="menu">
          <header className={styles.notifPanelHead}>
            <span className={styles.notifPanelTitle}>Pending signatures</span>
            <span className={styles.notifPanelCount}>
              {count === 0 ? 'none' : `${count} waiting`}
            </span>
          </header>

          {count === 0 ? (
            <div className={styles.notifEmpty}>
              <p className={styles.notifEmptyBody}>
                Nothing to approve right now. When your agent needs a signature it
                shows up here — start the station with <code>sailor station start</code>.
              </p>
            </div>
          ) : (
            <ul className={styles.notifList}>
              {hasDraft && (
                <li>
                  <button type="button" className={styles.notifItem} onClick={onOpenSigning}>
                    <span className={styles.notifItemTop}>
                      <span className={styles.notifItemKind}>Mandate</span>
                      <span className={styles.notifItemType}>signature</span>
                    </span>
                    <span className={styles.notifItemTitle}>Permission draft ready</span>
                    <span className={styles.notifItemDesc}>
                      {draftCount} permission{draftCount === 1 ? '' : 's'} queued — sign or reject
                    </span>
                  </button>
                </li>
              )}
              {pending.map((req) => (
                <li key={req.id}>
                  <button
                    type="button"
                    className={styles.notifItem}
                    onClick={onOpenSigner}
                  >
                    <span className={styles.notifItemTop}>
                      <span className={styles.notifItemKind}>
                        {SIGNING_KIND_LABELS[req.kind] ?? req.kind}
                      </span>
                      <span className={styles.notifItemType}>
                        {req.type === 'typed-data' ? 'signature' : 'transaction'}
                      </span>
                    </span>
                    <span className={styles.notifItemTitle}>{req.title}</span>
                    {req.description && (
                      <span className={styles.notifItemDesc}>{req.description}</span>
                    )}
                    <span className={styles.notifItemMeta}>
                      {chainDisplayName(req.chainId)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pending.length > 0 && (
            <button type="button" className={styles.notifFootBtn} onClick={onOpenSigner}>
              Open signing page
              <ArrowRightSm />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ────────── Icons ────────── */
function BellIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      <path d="M4.6 6.2a3.4 3.4 0 016.8 0v2.6c0 .9.3 1.7.9 2.3l.6.7H3.1l.6-.7c.6-.6.9-1.4.9-2.3V6.2z" />
      <path d="M6.8 12.5a1.4 1.4 0 002.4 0" />
    </svg>
  )
}
function ArrowOutIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      <path d="M5 9 L9 5" />
      <path d="M5.4 5 H9 V8.6" />
    </svg>
  )
}
// Docs — a square-shouldered book/page glyph matching the utility-link icons.
function DocsGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      <path d="M4 2.5h6l2 2v9H4z" />
      <path d="M6 6h4M6 8.5h4M6 11h2.5" />
    </svg>
  )
}
function RotateIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.66" />
      <path d="M13.4 2.6V5.1h-2.5" />
    </svg>
  )
}
// Safe{Wallet} mark — official monochrome glyph (web3icons), tinted via currentColor.
function SafeMark() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M7.063 8.117c0-.583.472-1.055 1.055-1.055h7.76c.582 0 1.055-.472 1.055-1.055V4.055c0-.583-.473-1.055-1.055-1.055h-8.21c-.583 0-1.055.472-1.055 1.055V5.56c0 .583-.473 1.055-1.055 1.055H4.056A1.055 1.055 0 0 0 3 7.67v3.293c0 .583.475 1.031 1.058 1.031h1.951c.583 0 1.056-.472 1.056-1.055zm12.882 3.878h-1.952c-.583 0-1.055.472-1.055 1.055v2.833c0 .583-.472 1.055-1.055 1.055H8.118c-.583 0-1.055.472-1.055 1.055v1.952c0 .583.472 1.055 1.055 1.055h8.214a1.05 1.05 0 0 0 1.049-1.055v-1.566c0-.583.472-.996 1.055-.996h1.509c.582 0 1.055-.473 1.055-1.056v-3.29c0-.582-.473-1.042-1.055-1.042m-6.989-2.052h-1.874c-.61 0-1.107.496-1.107 1.107v1.874c0 .61.496 1.107 1.107 1.107h1.874c.61 0 1.107-.496 1.107-1.107V11.05c0-.61-.496-1.107-1.107-1.107" />
    </svg>
  )
}
function ArrowRightSm() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7h8M8 4l3 3-3 3" />
    </svg>
  )
}
function CopyGlyph() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      <rect x="2.6" y="4" width="6.4" height="7.4" />
      <path d="M4.6 4V2.6h6.8V10H10" />
    </svg>
  )
}
function CheckSm() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      <path d="M3 7.4l2.6 2.6L11 4.4" />
    </svg>
  )
}
function CrossSm() {
  return (
    <svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
    </svg>
  )
}
function DotSm() {
  return (
    <svg viewBox="0 0 14 14" width="8" height="8" aria-hidden>
      <circle cx="7" cy="7" r="3.2" fill="currentColor" />
    </svg>
  )
}
// Mandate — a big pixel shield with a knocked-out check: the on-chain
// permissions that guard and scope what the agent may do.
function MandateGlyph() {
  return (
    <svg {...pxSvg}>
      <path fillRule="evenodd" d="M2 1h8v1H2Z M1 2h10v4H1Z M2 6h8v2H2Z M3 8h6v1H3Z M4 9h4v1H4Z M5 10h2v1H5Z M4 5h1v1H4Z M5 6h1v1H5Z M6 5h1v1H6Z M7 4h1v1H7Z M8 3h1v1H8Z" />
    </svg>
  )
}
/* ── Icon system — pixel-art, drawn on the Sai logo's grid ──────────────────
   Every section/role glyph is bitmap pixel-art (unit-cell paths, crisp edges),
   the same language as the Sai mascot and the PixelCheck — a retro-terminal
   look that reads as Sail's own IP, not generic vector icons. White fill sits
   on the accent-blue tile; knockouts (eyes, slots) let the tile show through.
   ────────────────────────────────────────────────────────────────────────── */
const pxSvg = { viewBox: '0 0 12 12', width: 14, height: 14, fill: 'currentColor', shapeRendering: 'crispEdges', 'aria-hidden': true }
// Overview — four panes of a dashboard.
function OverviewGlyph() {
  return (
    <svg {...pxSvg}>
      <path d="M1 1h4v4H1Z M7 1h4v4H7Z M1 7h4v4H1Z M7 7h4v4H7Z" />
    </svg>
  )
}
// Gas — a pixel fuel pump (body + display slot + hose).
function GasGlyph() {
  return (
    <svg {...pxSvg}>
      <path fillRule="evenodd" d="M2 1h5v10H2Z M3 3h3v2H3Z" />
      <path d="M1 11h7v1H1Z M7 3h2v1H7Z M8 3h1v5H8Z M9 7h1v2H9Z M10 8h1v1h-1Z" />
    </svg>
  )
}

// Owner — a pixel person. The human who owns the SMA and signs the mandates.
function PersonGlyph() {
  return (
    <svg {...pxSvg}>
      <path d="M5 1h2v1H5Z M4 2h4v2H4Z M5 4h2v1H5Z M3 6h6v1H3Z M2 7h8v4H2Z" />
    </svg>
  )
}

/* Page head: icon tile + mono title, with the page's description tucked into an
   info icon beside the title (rather than a subtitle) so the page stays clean. */
function PageHead({ icon, title, info }) {
  return (
    <header className={styles.pageHead}>
      <h1 className={styles.pageHeadTitle}>
        {icon}
        <span className={styles.pageHeadLabel}>
          {title}
          {info && <InfoTip label={`About ${title}`} side="bottom">{info}</InfoTip>}
        </span>
      </h1>
    </header>
  )
}
// Network — a pixel chain: two interlocking links, for the RPC "connection".
function NetworkGlyph() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor" shapeRendering="crispEdges" aria-hidden>
      <path d="M3 1h5v1H3Z M2 2h1v5H2Z M8 2h1v5H8Z M3 7h5v1H3Z M7 6h5v1H7Z M6 7h1v5H6Z M12 7h1v5H12Z M7 12h5v1H7Z" />
    </svg>
  )
}
// Activity — a pixel log/journal: bulleted lines of decreasing length.
function ActivityGlyph() {
  return (
    <svg {...pxSvg}>
      <path d="M1 2h2v2H1Z M4 2h7v2H4Z M1 5h2v2H1Z M4 5h6v2H4Z M1 8h2v2H1Z M4 8h5v2H4Z" />
    </svg>
  )
}
function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z" />
    </svg>
  )
}
