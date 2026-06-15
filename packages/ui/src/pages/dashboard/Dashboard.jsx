import { useEffect, useRef, useState } from 'react'
import OnboardingWizard from '../onboarding/OnboardingWizard'
import { MandateSigningFlow } from '../signing/Signing'
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount, useDisconnect } from 'wagmi'
import {
  FluidBackground,
  MandateStatus,
  Sai,
  SailButton,
} from '../shared'
import shared from '../shared/shared.module.css'
import styles from './Dashboard.module.css'
import agentStyles from './SharedLayout.module.css'
import AIHandoffModal from './AIHandoffModal'
import ProfileModal from './ProfileModal'
import NotConnectedCard from '../shared/NotConnectedCard'
import CreateSMAModal from './CreateSMAModal'
import RevokeMandateModal from './RevokeMandateModal'
import AddSignerModal from './AddSignerModal'
import RotateSignerModal from './RotateSignerModal'
import FundGasModal from './FundGasModal'
import RpcSection from './RpcSection'
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
  useDiscoverSafes,
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

const SAFE_CHAIN_PREFIX = {
  ethereum: 'eth',
  arbitrum: 'arb1',
  base: 'base',
  unichain: 'unichain',
  optimism: 'oeth',
  polygon: 'matic',
}
// Maps a numeric chainId (from .sail/account.json) to the network key
// used by the explorer/Safe URL helpers above.
const CHAIN_NAMES = {
  1: 'ethereum',
  42161: 'arbitrum',
  8453: 'base',
  130: 'unichain',
  10: 'optimism',
  137: 'polygon',
  84532: 'base sepolia',
}
function safeAppUrl(network, address) {
  const prefix = SAFE_CHAIN_PREFIX[network] ?? 'eth'
  return `https://app.safe.global/home?safe=${prefix}:${address}`
}
function explorerUrl(network, address) {
  const map = {
    arbitrum: `https://arbiscan.io/address/${address}`,
    ethereum: `https://etherscan.io/address/${address}`,
    base: `https://basescan.org/address/${address}`,
    unichain: `https://uniscan.xyz/address/${address}`,
    optimism: `https://optimistic.etherscan.io/address/${address}`,
    polygon: `https://polygonscan.com/address/${address}`,
  }
  return map[network] ?? map.ethereum
}
function explorerCodeUrl(network, address) {
  return `${explorerUrl(network, address)}#code`
}

function truncateAddr(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
function truncateSma(addr) {
  if (!addr) return ''
  return `${addr.slice(0, 10)}...${addr.slice(-7)}`
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

// Human labels for the signing-request kinds the agent pushes to the station.
// Mirrors the station's own KIND_LABELS so the bell dropdown and the station
// read the same way.
const SIGNING_KIND_LABELS = {
  'create-sma': 'Create Safe (SMA)',
  'deploy-mandate': 'Deploy mandate',
  'register-permission': 'Register permission',
  'attach-mandate': 'Attach mandate',
  'set-delegate': 'Set agent as manager',
  'arbitrary-tx': 'Arbitrary transaction',
}

const SIGNING_CHAIN_NAMES = {
  1: 'Ethereum',
  10: 'Optimism',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum One',
  130: 'Unichain',
  84532: 'Base Sepolia',
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
  // Owner — from the signing station + owner-paid txs
  owner_signed: 'signed in wallet',
  owner_rejected: 'rejected signing',
  sma_created: 'created Safe (SMA)',
  mandate_deployed: 'deployed mandate',
  mandate_attached: 'attached mandate',
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
    return e.name ?? truncateAddr(e.permission)
  }
  if (e.permission) return truncateAddr(e.permission)
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
  low: { label: 'Low' },
  critical: { label: 'Empty' },
}

const SIGNER_ROLE = {
  manager: { label: 'Manager', sub: 'Pays gas for every dispatch.' },
  owner: { label: 'Owner', sub: 'Holds the Safe and signs mandates.' },
  permissionSigner: { label: 'Permission signer', sub: 'Authorizes which mandates apply.' },
}

/**
 * Per-chain panel for multi-chain SMAs: shows mandates + account details for one chain.
 */
function ChainSection({ chainOverview, liveMandates, sma, onNewMandate, onAddSigner, onRotateSigner, onRevoke }) {
  const chainId = chainOverview.chainId
  const network = chainOverview.network ?? CHAIN_NAMES[chainId] ?? null
  const chainName = network ? (network.charAt(0).toUpperCase() + network.slice(1)) : `Chain ${chainId}`
  const overviewMandates = chainOverview.mandates ?? []
  const addressByTemplate = new Map(overviewMandates.map((m) => [m.name ?? m.template, m.address]))

  // Use live mandates from mandate.json when available. Otherwise synthesize one
  // mandate card per on-chain permission so the format stays consistent across chains.
  const displayMandates = liveMandates.length > 0
    ? liveMandates
    : overviewMandates.map((m) => ({
        chainId,
        registeredOnChain: true,
        permissions: [{ template: m.name ?? m.template ?? 'Unknown permission', params: {} }],
      }))

  const totalPerms = displayMandates.reduce((n, m) => n + (m.permissions ?? []).length, 0)

  return (
    <div className={styles.chainSection}>
      <div className={styles.chainSectionHeader}>
        <span className={styles.chainSectionBadge}>{chainName}</span>
        {chainOverview.onchainError && (
          <span className={styles.chainSectionMeta}>RPC unavailable</span>
        )}
      </div>

      <section className={styles.mandatesSection} aria-label={`${chainName} mandates`}>
        <header className={styles.mandatesSectionHead}>
          <h2 className={styles.mandatesSectionTitle}><DocGlyph />Your Mandates</h2>
          <span className={styles.mandatesSectionMeta}>
            {totalPerms > 0
              ? `${totalPerms} permission${totalPerms === 1 ? '' : 's'}${chainOverview.onchain ? ' · on-chain' : ''}`
              : 'No permissions yet'}
          </span>
        </header>
        <div className={styles.mandateList}>
          {displayMandates.length > 0 ? (
            displayMandates.map((m, i) => (
              <LiveMandateCard
                key={m.signedAt ?? i}
                mandate={m}
                network={network}
                addressByTemplate={addressByTemplate}
                onRevoke={onRevoke}
              />
            ))
          ) : (
            <NewMandateTile onClick={onNewMandate} />
          )}
        </div>
      </section>

      <section className={styles.signersSection} aria-label={`${chainName} account details`}>
        <header className={styles.mandatesSectionHead}>
          <h2 className={styles.mandatesSectionTitle}><KeyGlyph />Account Details</h2>
          <span className={styles.mandatesSectionMeta}>
            {chainOverview.onchain ? 'live balances · refill when low' : 'Add RPC URL to enable balance tracking'}
          </span>
        </header>
        <SignersPanel
          overview={chainOverview}
          sma={sma}
          onAddSigner={onAddSigner}
          onRotateSigner={onRotateSigner}
        />
      </section>
    </div>
  )
}

/**
 * The mandates (IPermission contracts) currently attached to the SMA on-chain.
 * Each row is one registered permission; the name comes from the local deploy
 * history when known, otherwise we show the address honestly rather than guess.
 */
function AttachedMandatesPanel({ mandates, network, onchain, onRevoke }) {
  return (
    <div className={styles.mandateRows}>
      {mandates.map((m) => (
        <MandateRow key={m.address} mandate={m} network={network} onRevoke={onRevoke} />
      ))}
      <div className={styles.mandateRowsFoot}>
        {onchain
          ? `Reflecting the kernel's live permission set${network ? ` on ${network}` : ''}.`
          : 'Last known set — on-chain confirmation unavailable.'}
      </div>
    </div>
  )
}

function MandateRow({ mandate, network, onRevoke }) {
  const name = mandate.name ?? mandate.template ?? 'Unrecognized permission'
  const known = !!(mandate.name ?? mandate.template)
  return (
    <article className={`${styles.mandateRow} ${known ? '' : styles.mandateRowUnknown}`}>
      <span className={styles.mandateRowIcon} aria-hidden>
        {known ? <CheckMark /> : <DocGlyph />}
      </span>
      <span className={styles.mandateRowBody}>
        <span className={styles.mandateRowName}>{name}</span>
        <span className={styles.mandateRowAddr}>{mandate.address}</span>
      </span>
      {onRevoke && (
        <button
          type="button"
          className={styles.mandateRowRevoke}
          onClick={() => onRevoke(mandate)}
          aria-label={`Revoke ${name}`}
        >
          Revoke
        </button>
      )}
      <a
        className={styles.mandateRowOpen}
        href={explorerUrl(network ?? mandate.network, mandate.address)}
        target="_blank"
        rel="noreferrer"
        aria-label="Open permission contract on block explorer"
      >
        <ArrowOutIcon />
      </a>
    </article>
  )
}

/** Delegated-signer balances with top-up status. */
function SignersPanel({ overview, sma, onAddSigner, onRotateSigner }) {
  const { address: wagmiAddress } = useAccount()
  const rawSigners = overview?.signers ?? []

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
      return list.map((m) => ({
        ...s,
        address: m.address,
        balanceEth: m.balanceEth,
        // Preserve balance status only for the active manager.
        status: m.isActive ? s.status : 'idle',
        managers: undefined,
        activeManager: m.isActive,
      }))
    }
    return [s]
  })

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
    <div className={styles.signerGrid}>
      {displaySigners.map((s) => (
        <SignerCard
          key={s.address ? `${s.role}:${s.address}` : s.role}
          signer={s}
          network={overview.network}
          loading={balancesLoading}
          onAddSigner={onAddSigner}
          onRotateSigner={onRotateSigner}
        />
      ))}
    </div>
  )
}

function SignerCard({ signer, network, loading, onAddSigner, onRotateSigner }) {
  const [copied, setCopied] = useState(false)
  const [fundOpen, setFundOpen] = useState(false)
  const role = signer.role === 'sma'
    ? { label: 'SMA', sub: 'Holds your funds. Native ETH shown; tokens not counted.' }
    : (SIGNER_ROLE[signer.role] ?? { label: signer.role, sub: '' })
  const unconfigured = signer.status === 'unconfigured'
  const isLocal = signer.status === 'local'
  const isIdle = signer.status === 'idle'
  // activeManager is set by SignersPanel when expanding a managers list.
  // Fall back to the old derivation for non-expanded manager cards.
  const isActiveManager = signer.role === 'manager' && (
    signer.activeManager !== undefined ? signer.activeManager : (!isLocal && !unconfigured && !isIdle)
  )
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
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(signer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <article
      className={`${styles.signerCard} ${needsTopUp ? styles.signerCardWarn : ''} ${
        isCritical ? styles.signerCardCrit : ''
      }`}
    >
      <header className={styles.signerCardHead}>
        <span className={styles.signerRole}>{role.label}</span>
        {/* While balances hydrate we can't vouch for a status — show a single
            muted "Reading…" pill instead of a (possibly wrong) state badge. */}
        {balanceLoading ? (
          <span className={`${styles.balancePill} ${styles.balancePillLoading}`}>
            <span className={styles.balancePillDot} aria-hidden />
            Reading…
          </span>
        ) : (
          <>
            {isActiveManager && (
              <span
                className={styles.balancePill}
                style={{ color: '#34d399' }}
                title="Registered as this SMA's delegated signer on-chain"
              >
                <span className={styles.balancePillDot} aria-hidden style={{ background: '#34d399' }} />
                Active
              </span>
            )}
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
      </header>

      <div className={styles.signerBalance}>
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
            <span className={`${styles.signerBalanceUnit} ${styles.signerBalanceNumLoading}`}>ETH</span>
          </>
        ) : (
          <>
            <span className={styles.signerBalanceNum}>{fmtEth(signer.balanceEth)}</span>
            <span className={styles.signerBalanceUnit}>ETH</span>
          </>
        )}
      </div>
      <p className={styles.signerSub}>
        {unconfigured
          ? 'No agent wallet assigned yet — create or import one to let your agent sign.'
          : isLocal
            ? 'Local key — not yet delegated.'
            : isIdle
              ? 'Known manager — not currently active on-chain.'
              : role.sub}
      </p>

      {unconfigured && (
        <SailButton fullWidth variant="secondary" onClick={onAddSigner}>
          Add agent wallet
        </SailButton>
      )}

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
        </footer>
      )}

      {/* Rotate button: on active manager, opens modal to pick new manager */}
      {signer.role === 'manager' && isActiveManager && onRotateSigner && (
        <button type="button" className={styles.signerRotateBtn} onClick={() => onRotateSigner()}>
          Rotate manager
        </button>
      )}

      {/* On idle managers, open the modal with this address pre-selected. */}
      {signer.role === 'manager' && isIdle && onRotateSigner && (
        <button type="button" className={styles.signerRotateBtn} onClick={() => onRotateSigner(signer.address)}>
          Rotate to this
        </button>
      )}

      <div className={styles.signerSpacer} />
      {needsTopUp && (
        <div className={styles.signerTopUp}>
          <span className={styles.signerTopUpMsg}>
            {isCritical ? 'Out of gas — agent is stalled.' : 'Running low — top up soon.'}
          </span>
          <button
            type="button"
            className={styles.signerFundBtn}
            onClick={() => setFundOpen(true)}
          >
            Fund Gas
          </button>
        </div>
      )}
      <FundGasModal
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        signer={signer}
        network={network}
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
    const n = network ?? (mandate?.chainId ? CHAIN_NAMES[mandate.chainId] : null)
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : null
  })()

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
          <h3 className={styles.mandateSummaryTitle}>
            {networkLabel ? `Mandate · ${networkLabel}` : 'Mandate'}
          </h3>
        </div>
        <div className={styles.mandateSummaryHeadRight}>
          <MandateStatus status={status} />
          <span className={styles.mandateSummaryCount}>
            {permissions.length} permission{permissions.length === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      <ul className={styles.mandateSummaryPerms}>
        {permissions.map((p, i) => {
          const addr = addressByTemplate?.get(p.template)
          const body = (
            <span className={styles.mandateSummaryPermBody}>
              <span className={styles.mandateSummaryPermLabel}>{p.template}</span>
              {(p.explanation
                ? String(p.explanation).split('; ')
                : explainPermission(p)
              ).map((line, j) => (
                <span key={j} className={styles.mandateSummaryPermSub}>
                  {line}
                </span>
              ))}
            </span>
          )
          return (
            <li key={`${p.template}-${i}`} className={styles.mandateSummaryPermRow}>
              <span className={styles.mandateSummaryCheck} aria-hidden>
                <CheckMark />
              </span>
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
            Revoke permission
          </button>
        )}
      </footer>
    </article>
  )
}


const TX_EXPLORER = {
  arbitrum: (hash) => `https://arbiscan.io/tx/${hash}`,
  ethereum: (hash) => `https://etherscan.io/tx/${hash}`,
  base:     (hash) => `https://basescan.org/tx/${hash}`,
  optimism: (hash) => `https://optimistic.etherscan.io/tx/${hash}`,
  polygon:  (hash) => `https://polygonscan.com/tx/${hash}`,
}
function txUrl(network, hash) {
  return (TX_EXPLORER[network] ?? TX_EXPLORER.ethereum)(hash)
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
  const totalUsd = positions?.reduce((s, p) => s + (p.valueUsd ?? 0), 0) ?? null

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
        {totalUsd != null && (
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

function AgentSourceBadge({ source, pid, pids }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = source === 'remote' ? 'remote agent'
    : source === 'github-actions' ? 'github actions'
    : 'Running'

  const hasDetail = source === 'local' && pids.length > 0

  return (
    <div className={styles.agentSourceWrap} ref={ref}>
      <button
        type="button"
        className={`${styles.agentRunningBadge} ${hasDetail ? styles.agentRunningBadgeClickable : ''}`}
        onClick={() => hasDetail && setOpen((o) => !o)}
        aria-haspopup={hasDetail ? 'true' : undefined}
        aria-expanded={open}
      >
        <span className={styles.agentRunningDot} aria-hidden />
        {label}
        {hasDetail && (
          <svg
            className={`${styles.agentSourceChevron} ${open ? styles.agentSourceChevronOpen : ''}`}
            width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true"
          >
            <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>
      {open && (
        <div className={styles.agentSourcePanel}>
          {pids.map(({ chainId, pid: p }) => {
            const chainLabel = chainId ? (CHAIN_NAMES[chainId] ?? `chain ${chainId}`) : 'unknown chain'
            return (
              <div key={chainId ?? p} className={styles.agentSourceRow}>
                <span className={styles.agentSourceChain}>{chainLabel}</span>
                <span className={styles.agentSourcePid}>PID {p}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ActivityChainFilter({ deployedChains, chainFilter, onChainFilterChange }) {
  if (deployedChains.length <= 1) return null
  return (
    <div className={styles.activityFilter} role="tablist" aria-label="Filter by chain" style={{ marginBottom: 14 }}>
      <button
        type="button"
        role="tab"
        aria-selected={chainFilter === 'all'}
        className={`${styles.activityFilterBtn} ${chainFilter === 'all' ? styles.activityFilterBtnActive : ''}`}
        onClick={() => onChainFilterChange('all')}
      >
        All chains
      </button>
      {deployedChains.map((cid) => {
        const name = CHAIN_NAMES[cid]
        const label = name ? (name.charAt(0).toUpperCase() + name.slice(1)) : `Chain ${cid}`
        return (
          <button
            key={cid}
            type="button"
            role="tab"
            aria-selected={chainFilter === String(cid)}
            className={`${styles.activityFilterBtn} ${chainFilter === String(cid) ? styles.activityFilterBtnActive : ''}`}
            onClick={() => onChainFilterChange(String(cid))}
          >
            {label}
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
function LiveActivityFeed({ events, positions, network, permToChain = new Map(), chainFilter = 'all' }) {
  const INITIAL_VISIBLE = 8
  const [filter, setFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)

  const allItems = groupActivityItems(events, permToChain)

  const filtered = allItems.filter((item) => {
    const actorMatch = filter === 'all'
      || (item.kind === 'tick' ? filter === 'agent' : activityActor(item.event) === filter)
    const chainMatch = chainFilter === 'all'
      || (item.kind === 'tick'
        ? item.chainIds?.has(Number(chainFilter))
        : item.event.chainId === Number(chainFilter))
    return actorMatch && chainMatch
  })

  const rows = filtered.slice(0, visibleCount)
  const hasMore = filtered.length > visibleCount

  const handleFilterChange = (key) => { setFilter(key); setVisibleCount(INITIAL_VISIBLE) }

  const emptyLabel = [
    filter !== 'all' ? filter : null,
    chainFilter !== 'all' ? (CHAIN_NAMES[Number(chainFilter)] ?? chainFilter) : null,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <div className={styles.activityFilter} role="tablist" aria-label="Filter by actor">
        {ACTIVITY_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`${styles.activityFilterBtn} ${filter === f.key ? styles.activityFilterBtnActive : ''}`}
            onClick={() => handleFilterChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
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
                      <span className={agentStyles.journalMeta}>
                        {detail}
                        {hasTx && (
                          <>
                            {detail ? ' · ' : ''}
                            <a
                              href={txUrl(network ?? 'ethereum', e.txHash)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {truncateAddr(e.txHash)}
                            </a>
                          </>
                        )}
                      </span>
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
                style={{ padding: '6px 14px', fontSize: '13px', borderRadius: '6px', border: '1px solid #3a3f4a', background: 'transparent', color: '#9aa0ae', cursor: 'pointer' }}
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
  const { isConnected } = useAccount()
  const [wizardSkipped, setWizardSkipped] = useState(false)
  // Capture connected state at first render — if already connected on load, bypass the wizard.
  const connectedOnMount = useRef(isConnected)

  function refreshOnboard() {
    fetch('/api/onboard/state')
      .then(r => r.json())
      .then(s => { _onboardCache = s; setOnboardState(s); setOnboardChecked(true) })
      .catch(() => setOnboardChecked(true))
  }

  // Called by the wizard's "Go to dashboard →" button. Optimistically mark
  // hasAccount = true so the dashboard appears immediately without waiting for
  // another /api/onboard/state round-trip. Then fetch in the background to
  // populate the full state (rpcUrl, chainId, etc.).
  function handleOnboardComplete() {
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
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <FluidBackground />
    </div>
  )
  // Show onboarding whenever there's no SMA and no wallet connected — even if a
  // wallet was connected on mount and later disconnected. Without the live
  // `!isConnected` clause, that disconnect path fell through to the dashboard's
  // bare "Connect wallet" card instead of the guided wizard.
  if (!onboardState?.hasAccount && !wizardSkipped && (!connectedOnMount.current || !isConnected)) {
    return <OnboardingWizard onboardState={onboardState} onComplete={handleOnboardComplete} onSkip={() => setWizardSkipped(true)} />
  }

  return <DashboardContent draft={draft} onReset={refreshOnboard} wizardSkipped={wizardSkipped} />
}

function DashboardContent({ draft, onReset, wizardSkipped }) {
  const { isConnected, address: wagmiAddress } = useAccount()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  // Bumped on SMA switch/rename to force every panel to refetch immediately
  // instead of waiting for its next poll — the server serves the target SMA's
  // cached snapshot instantly, so the switch feels immediate.
  const [refreshTick, setRefreshTick] = useState(0)
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
  const { running: agentRunning, pid: agentPid, pids: agentPids, source: agentSource, githubActions } = useSailorAgentStatus()
  const { pending } = useSailorPending()

  const [justCreatedAccount, setJustCreatedAccount] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sail.account') ?? 'null') } catch { return null }
  })

  // We no longer auto-adopt the first Safe the connected wallet owns. An
  // existing Safe is surfaced only inside the explicit Import flow (SetupHero),
  // where the user picks which one to adopt as their SMA — so the dashboard
  // starts from a clean "create or import" state instead of silently binding to
  // whatever Safe happens to be associated with the wallet.
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [createSMAOpen, setCreateSMAOpen] = useState(false)
  const [handoff, setHandoff] = useState(null)
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [revokeContext, setRevokeContext] = useState(null) // { sma, kernel, chainId } for multi-chain revoke
  const [activityChainFilter, setActivityChainFilter] = useState('all')
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
  const effectiveAccount = overviewAccount ?? realAccount ?? justCreatedAccount
  const hasSMA = effectiveAccount != null
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
  const liveMode = hasLiveMandate || agentRunning

  const realNetwork = effectiveAccount ? (CHAIN_NAMES[effectiveAccount.chainId] ?? 'ethereum') : null
  const sma = effectiveAccount
    ? {
        id: 'live-sma',
        name: 'My SMA',
        address: effectiveAccount.safe,
        network: realNetwork,
      }
    : null

  const ownerAddr = effectiveAccount?.owner ?? wagmiAddress ?? null

  const activeAccount = allAccounts.find((a) => a.active) ?? allAccounts[0] ?? null
  // Resolve the chains this SMA spans by unioning the account's own list with
  // the chain ids the server actually returned overviews for. `deployedChains`
  // is only set when the SMA was created through the browser flow with the full
  // list in the payload — CLI/onboarding and per-chain creates leave it unset,
  // which would otherwise collapse the badges/RPC/activity panels to one chain.
  const deployedChains = (() => {
    const chains = new Set(activeAccount?.deployedChains ?? [])
    for (const ov of chainOverviews) if (ov?.chainId != null) chains.add(Number(ov.chainId))
    if (activeAccount?.chainId != null) chains.add(Number(activeAccount.chainId))
    return [...chains].filter((c) => Number.isFinite(c) && c > 0)
  })()
  const isMultiChain = deployedChains.length > 1
  const smaName = safeNames[activeAccount?.safe ?? 'live-sma'] ?? activeAccount?.name ?? sma?.name ?? 'My SMA'
  const currentSafeId = activeAccount?.safe ?? effectiveAccount?.safe ?? 'live-sma'
  const profileSafes = allAccounts.length > 0
    ? (() => {
        const byId = new Map()
        for (const a of allAccounts) {
          const key = a.safe.toLowerCase()
          const net = CHAIN_NAMES[a.chainId] ?? 'ethereum'
          const isCurrent = a.safe?.toLowerCase() === currentSafeId?.toLowerCase()
          const deployedNets = a.deployedChains
            ? a.deployedChains.map((id) => CHAIN_NAMES[id] ?? 'ethereum').filter(Boolean)
            : null
          if (!byId.has(key)) {
            byId.set(key, {
              id: a.safe,
              name: safeNames[a.safe] ?? a.name ?? 'My SMA',
              address: a.safe,
              network: net,
              networks: deployedNets ?? [net],
              mandateCount: isCurrent ? (isMultiChain && chainOverviews.length > 0 ? chainOverviews.reduce((sum, ov) => sum + (ov.mandateCount ?? 0), 0) : (overview?.mandateCount ?? 0)) : 0,
              createdAt: a.addedAt ?? null,
            })
          } else {
            const entry = byId.get(key)
            const toMerge = deployedNets ?? [net]
            for (const n of toMerge) {
              if (!entry.networks.includes(n)) entry.networks.push(n)
            }
          }
        }
        return [...byId.values()]
      })()
    : sma
    ? [{ ...sma, name: smaName, networks: deployedChains.length > 0 ? deployedChains.map((id) => CHAIN_NAMES[id] ?? 'ethereum').filter(Boolean) : [realNetwork], mandateCount: isMultiChain && chainOverviews.length > 0 ? chainOverviews.reduce((sum, ov) => sum + (ov.mandateCount ?? 0), 0) : (overview?.mandateCount ?? 0), createdAt: null }]
    : []

  const safeUrl = sma ? safeAppUrl(sma.network, sma.address) : '#'
  const debankUrl = sma ? `https://debank.com/profile/${sma.address}` : '#'

  async function stopAgent() {
    setStopping(true)
    try {
      await fetch('/api/agent-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
    } catch {
      // agent-status poll will reconcile
    } finally {
      setStopping(false)
    }
  }

  function copySma() {
    if (!sma) return
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(sma.address)
    setCopiedAddr(true)
    setTimeout(() => setCopiedAddr(false), 1400)
  }

  return (
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <FluidBackground />

      {/* ── Top bar — kept minimal. The brand mascot anchors the left,
          and the right cluster is just notifications + wallet identity.
          Quick links (DeBank/Safe) no longer live here; they have
          first-class cards in the body, where they belong now that the
          SMA is the dashboard's primary subject. */}
      <header className={styles.header}>
        <button
          type="button"
          className={styles.brand}
          onClick={() => { window.location.hash = '#/dashboard' }}
          aria-label="Go to dashboard"
        >
          <Sai size={48} animate />
        </button>

        <div className={styles.topActionsPill}>
          <NotificationsBell
            pending={pending}
            draft={draft}
            open={notifOpen}
            onToggle={() => setNotifOpen((o) => !o)}
            onClose={() => setNotifOpen(false)}
            onOpenStation={() => { setNotifOpen(false); window.location.hash = '#/station' }}
            onOpenSigning={() => { setNotifOpen(false); window.location.hash = '#/station' }}
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
      </header>

      <main className={agentStyles.main}>
        {/* Wallet mismatch: connected wallet ≠ account owner in .sail/account.json */}
        {isConnected && hasSMA && wagmiAddress && effectiveAccount?.owner &&
          wagmiAddress.toLowerCase() !== effectiveAccount.owner.toLowerCase() ? (
          <WalletMismatchCard
            projectOwner={effectiveAccount.owner}
            connectedAddress={wagmiAddress}
            onReset={async () => {
              await fetch('/api/account', { method: 'DELETE' }).catch(() => {})
              onReset()
            }}
            onConnect={openConnectModal}
          />
        ) : !isConnected ? (
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 24px' }}>
            <NotConnectedCard eyebrow="DASHBOARD" title="Connect to view your SMA." sub="Connect the owner wallet you used to set up this project." />
          </div>
        ) : !hasSMA && accountLoading ? (
          <ScanningHero />
        ) : !hasSMA ? (
          <SetupHero
            onCreate={() => setCreateSMAOpen(true)}
            initialShowImport={wizardSkipped}
            onImport={(account) => {
              setJustCreatedAccount(account)
              try { localStorage.setItem('sail.account', JSON.stringify(account)) } catch {}
              // Persist server-side so /api/overview can read on-chain balances
              // and the CLI/agent see the same SMA — not just this browser.
              fetch('/api/account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(account),
              }).catch(() => {})
              setRefreshTick((t) => t + 1)
            }}
            ownerAddr={ownerAddr}
          />
        ) : (
          <>
            {draft && draftItemCount(draft) > 0 && (
              <DraftBanner
                draft={draft}
                onReview={() => { window.location.hash = '#/station' }}
              />
            )}
            {pending.length > 0 && (
              <PendingBanner
                count={pending.length}
                onReview={() => { window.location.hash = '#/station' }}
              />
            )}

            {/* ── SMA title block ────────────────────────────────────
                The SMA is the page subject. Name on the left at h1
                weight, "Stop all agents" at the top-right as the
                destructive global lever. Below: address pill (copy =
                deposit UI) and created-date meta. */}
            <section className={agentStyles.titleBlock}>
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
                  <button
                    type="button"
                    className={styles.titleNameBtn}
                    onClick={() => { setNameInput(smaName); setEditingName(true) }}
                    title="Click to rename"
                  >
                    <h1 className={agentStyles.title}>{smaName}</h1>
                    <PencilIcon />
                  </button>
                )}
                {overview?.sma && (
                  <div className={styles.smaBadges}>
                    {(deployedChains.length > 0
                      ? deployedChains.map((id) => CHAIN_NAMES[id]).filter(Boolean)
                      : overview.network ? [overview.network] : []
                    ).map((n) => (
                      <span key={n} className={styles.smaBadge}>{n}</span>
                    ))}
                    <MandateStatus status={agentRunning ? 'active' : 'paused'} kind="agent" />
                    {agentSource && (
                      <AgentSourceBadge
                        source={agentSource}
                        pid={agentPid}
                        pids={agentPids}
                      />
                    )}
                  </div>
                )}
              </div>

              <div className={agentStyles.addrRow}>
                <button
                  type="button"
                  className={agentStyles.addrPill}
                  onClick={copySma}
                  aria-label="Copy SMA address"
                  title={sma?.address}
                >
                  <span className={agentStyles.addrMono}>{truncateSma(sma?.address)}</span>
                  <span className={agentStyles.addrIcon} aria-hidden>
                    {copiedAddr ? <CheckSm /> : <CopyGlyph />}
                  </span>
                  <a
                    href={explorerUrl(sma?.network, sma?.address)}
                    target="_blank"
                    rel="noreferrer"
                    className={agentStyles.addrOpen}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Open SMA on block explorer"
                  >
                    <ArrowOutIcon />
                  </a>
                </button>
                <span className={agentStyles.titleMeta}>
                  SMA · created {sma?.createdAt ?? sma?.createdAgo ?? '—'}
                </span>
              </div>
            </section>

            {/* ── Quick links ─────────────────────────────────────────
                Bigger than on the agent page — the dashboard is where
                most users will reach these, so they deserve presence. */}
            <section className={`${agentStyles.quickLinks} ${styles.quickLinksLarge}`} aria-label="Quick links">
              <a
                className={`${agentStyles.quickLink} ${styles.quickLinkLarge}`}
                href={debankUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span className={agentStyles.qlText}>
                  <span className={`${agentStyles.qlTitle} ${styles.qlTitleLarge}`}>View portfolio</span>
                  <span className={agentStyles.qlSub}>opens DeBank</span>
                </span>
                <span className={agentStyles.qlArrow} aria-hidden><ArrowOutIcon /></span>
              </a>
              <a
                className={`${agentStyles.quickLink} ${styles.quickLinkLarge}`}
                href={safeUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span className={agentStyles.qlText}>
                  <span className={`${agentStyles.qlTitle} ${styles.qlTitleLarge}`}>Manage SMA</span>
                  <span className={agentStyles.qlSub}>opens Safe</span>
                </span>
                <span className={agentStyles.qlArrow} aria-hidden><ArrowOutIcon /></span>
              </a>
            </section>

            {/* ── Mandates + Account Details ──────────────────────
                Multi-chain SMAs get one section per deployed chain.
                Single-chain SMAs get the original layout. */}
            {isMultiChain && chainOverviews.length > 0 ? (
              chainOverviews.map((chainOv) => {
                const chainMandates = liveMandates.filter((m) =>
                  (m.safe == null || m.safe.toLowerCase() === activeSafe) &&
                  m.chainId === chainOv.chainId
                )
                return (
                  <ChainSection
                    key={chainOv.chainId}
                    chainOverview={chainOv}
                    liveMandates={chainMandates}
                    sma={sma}
                    onNewMandate={() => setHandoff({ variant: 'new', context: 'mandate' })}
                    onAddSigner={() => setAddSignerOpen(true)}
                    onRotateSigner={chainOv?.kernel && chainOv?.sma?.address
                      ? (addr) => {
                          setRotateContext({
                            sma: chainOv.sma.address,
                            kernel: chainOv.kernel,
                            chainId: chainOv.chainId,
                            owner: chainOv.sma.owner,
                            currentManager: chainOv.sma.manager,
                            mandates: chainOv.mandates ?? [],
                          })
                          setRotateTo(addr ?? null)
                          setRotateOpen(true)
                        }
                      : undefined}
                    onRevoke={chainOv?.kernel && chainOv?.sma?.address
                      ? (target) => { setRevokeContext({ sma: chainOv.sma.address, kernel: chainOv.kernel, chainId: chainOv.chainId }); setRevokeTarget(target) }
                      : undefined}
                  />
                )
              })
            ) : (
              <>
                <section className={styles.mandatesSection} aria-label="Your mandates">
                  <header className={styles.mandatesSectionHead}>
                    <h2 className={styles.mandatesSectionTitle}>
                      <DocGlyph />
                      Your Mandates
                    </h2>
                    <span className={styles.mandatesSectionMeta}>
                      {overviewMandates.length > 0
                        ? `${overviewMandates.length} permission${
                            overviewMandates.length === 1 ? '' : 's'
                          }${overview?.onchain ? ' · attached on-chain' : ''}`
                        : hasLiveMandate
                          ? `${activeLiveMandates.reduce((n, m) => n + (m.permissions ?? []).length, 0)} permission${
                              activeLiveMandates.reduce((n, m) => n + (m.permissions ?? []).length, 0) === 1 ? '' : 's'
                            } · live`
                          : 'No permissions registered yet'}
                    </span>
                  </header>
                  <div className={styles.mandateList}>
                    {hasLiveMandate ? (() => {
                      const addressByTemplate = new Map(overviewMandates.map((m) => [m.name ?? m.template, m.address]))
                      return activeLiveMandates.map((m, i) => (
                        <LiveMandateCard
                          key={m.signedAt ?? i}
                          mandate={m}
                          network={realNetwork}
                          addressByTemplate={addressByTemplate}
                          onRevoke={overview?.kernel && overview?.sma?.address ? setRevokeTarget : undefined}
                        />
                      ))
                    })() : overviewMandates.length > 0 ? (
                      <AttachedMandatesPanel
                        mandates={overviewMandates}
                        network={overview?.network ?? realNetwork}
                        onchain={overview?.onchain}
                        onRevoke={overview?.kernel && overview?.sma?.address ? setRevokeTarget : undefined}
                      />
                    ) : (
                      <NewMandateTile onClick={() => setHandoff({ variant: 'new', context: 'mandate' })} />
                    )}
                  </div>
                </section>

                <section className={styles.signersSection} aria-label="Accounts details">
                  <header className={styles.mandatesSectionHead}>
                    <h2 className={styles.mandatesSectionTitle}>
                      <KeyGlyph />
                      Accounts Details
                    </h2>
                    <span className={styles.mandatesSectionMeta}>
                      {overview?.onchain
                        ? 'live balances · refill when low'
                        : 'Add RPC URL to enable balance tracking'}
                    </span>
                  </header>
                  <SignersPanel
                    overview={overview}
                    sma={sma}
                    onAddSigner={() => setAddSignerOpen(true)}
                    onRotateSigner={overview?.kernel && overview?.sma?.address
                      ? (addr) => {
                          setRotateContext({
                            sma: overview.sma.address,
                            kernel: overview.kernel,
                            chainId: overview.chainId,
                            owner: overview.sma.owner,
                            currentManager: overview.sma.manager,
                            mandates: overview.mandates ?? [],
                          })
                          setRotateTo(addr ?? null)
                          setRotateOpen(true)
                        }
                      : undefined}
                  />
                </section>
              </>
            )}

            {/* ── RPC / Network config ─────────────────────────────── */}
            <section className={agentStyles.card}>
              <RpcSection deployedChains={deployedChains} />
            </section>

            {/* ── Recent activity / Decision Journal ─────────────── */}
            <section className={agentStyles.card}>
              <header className={agentStyles.cardHead}>
                <div className={agentStyles.cardHeadText}>
                  <h2 className={agentStyles.cardTitle}>
                    <ClockGlyph />
                    Recent activity
                  </h2>
                  <p className={agentStyles.cardSub}>
                    Click any event to see the agent's reasoning and evidence.
                  </p>
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

            {/* Local-first disclosure — calm footer so the user knows
                Sail runs entirely on their machine. No hosted backend,
                no remote state. The Studio they're looking at lives at
                localhost; all project state is under .sail/ on disk. */}
            <footer className={styles.localFootnote}>
              <span className={styles.localFootnoteDot} aria-hidden />
              Running locally at <code>{window.location.host}</code> · project state lives in
              {' '}<code>.sail/</code>. There is no Sail-hosted backend; your wallet
              talks to the chain directly.
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
        onClose={() => setProfileOpen(false)}
        onDisconnect={() => {
          setProfileOpen(false)
          setJustCreatedAccount(null)
          try { localStorage.removeItem('sail.account') } catch {}
          disconnect()
        }}
        onCreateSMA={() => { setProfileOpen(false); setCreateSMAOpen(true) }}
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

      <CreateSMAModal
        open={createSMAOpen}
        onClose={() => setCreateSMAOpen(false)}
        onComplete={(account) => {
          if (account) {
            setJustCreatedAccount(account)
            try { localStorage.setItem('sail.account', JSON.stringify(account)) } catch {}
          }
          setCreateSMAOpen(false)
        }}
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

      {/* Contract preview modal retired — viewing the signed contract
          now lives inside MandatePage at /mandate/:id, which the
          Your mandate card on the dashboard routes to. */}
    </div>
  )
}

/* ────────── Scanning hero ────────── */
function WalletMismatchCard({ projectOwner, connectedAddress, onReset, onConnect }) {
  const [resetting, setResetting] = useState(false)
  return (
    <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 24px' }}>
      <div style={{
        maxWidth: 440, width: '100%',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20,
        padding: '36px 32px',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,165,0,0.7)' }}>
          Wrong wallet
        </span>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: '#fff', lineHeight: 1.2 }}>
          This project belongs to a different wallet.
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
          Project owner: <code style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>{truncateAddr(projectOwner)}</code><br />
          Connected: <code style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>{truncateAddr(connectedAddress)}</code>
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
          Connect the owner wallet to manage this SMA, or reset to start a new project with the current wallet.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <SailButton onClick={onConnect} style={{ flex: 1 }}>
            Switch wallet
          </SailButton>
          <button
            type="button"
            disabled={resetting}
            onClick={async () => { setResetting(true); await onReset() }}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 12, fontSize: 14, fontWeight: 500,
              color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)', cursor: resetting ? 'default' : 'pointer',
            }}
          >
            {resetting ? 'Resetting…' : 'Reset project'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ScanningHero() {
  return (
    <section className={styles.noSMAHero}>
      <div className={styles.noSMAMascot} aria-hidden>
        <Sai size={64} animate />
      </div>
      <h2 className={styles.noSMATitle}>Loading your project…</h2>
      <p className={styles.noSMASub}>Reading local state from <code>.sail/</code>.</p>
    </section>
  )
}

/* ────────── Connect wallet hero ────────── */
function ConnectWalletHero() {
  return (
    <section className={styles.noSMAHero}>
      <div className={styles.noSMAMascot} aria-hidden>
        <Sai size={64} animate />
      </div>
      <h2 className={styles.noSMATitle}>Connect your wallet</h2>
      <p className={styles.noSMASub}>
        Connect the owner wallet you used when running <code>sailor init</code> to view your SMA and mandates.
      </p>
      <div className={styles.noSMACta}>
        <ConnectButton showBalance={false} />
      </div>
      <p className={styles.noSMAFine}>Self-custody. Sail never holds your keys.</p>
    </section>
  )
}

/* ────────── Setup hero (wallet connected, no .sail/account.json yet) ──────────
   The SMA section starts empty: the user either creates their first SMA or
   imports an existing Safe. Import discovers the Safes the connected wallet
   owns (Safe Transaction Service, the same source the old auto-load used) and
   lets the user pick which to adopt — with a manual-address fallback for Safes
   on chains the service doesn't index. */
function SetupHero({ onCreate, onImport, ownerAddr, initialShowImport }) {
  const [showImport, setShowImport] = useState(initialShowImport ?? false)
  const [manual, setManual] = useState(false)
  const [safeInput, setSafeInput] = useState('')
  const [chainInput, setChainInput] = useState('8453')
  const [err, setErr] = useState('')
  const { safes, scanning, done } = useDiscoverSafes(ownerAddr, showImport && !manual)

  function importSafe(safe, chainId) {
    onImport?.({
      safe,
      owner: ownerAddr ?? safe,
      permissionSigner: ownerAddr ?? safe,
      manager: ownerAddr ?? safe,
      chainId,
      createdAtBlock: '0',
    })
  }

  function handleManualImport() {
    const safe = safeInput.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(safe)) {
      setErr('Enter a valid 0x address.')
      return
    }
    const chainId = Number(chainInput)
    if (!chainId) { setErr('Enter a valid chain ID.'); return }
    importSafe(safe, chainId)
  }

  return (
    <section className={styles.noSMAHero}>
      <div className={styles.noSMAMascot} aria-hidden>
        <Sai size={64} animate />
      </div>
      <div className={styles.noSMAStatus}>
        <span className={styles.noSMAStatusDot} aria-hidden />
        No SMA yet
      </div>
      <h2 className={styles.noSMATitle}>Your wallet is connected.</h2>
      <p className={styles.noSMASub}>
        Create a new Separately Managed Account for your AI to operate — you only pay gas when there&rsquo;s something for it to do — or import an existing Safe you already own.
      </p>

      {!showImport ? (
        <>
          <div className={styles.noSMACta}>
            <SailButton onClick={onCreate}>Create your first agent</SailButton>
          </div>
          <button type="button" className={styles.noSMAImportLink} onClick={() => setShowImport(true)}>
            Already have a Safe? Import it as your SMA
          </button>
        </>
      ) : manual ? (
        <div className={styles.noSMAImport}>
          <input
            className={styles.noSMAImportInput}
            type="text"
            placeholder="Safe address  0x…"
            value={safeInput}
            onChange={(e) => { setSafeInput(e.target.value); setErr('') }}
            spellCheck={false}
          />
          <input
            className={styles.noSMAImportInput}
            type="text"
            placeholder="Chain ID  e.g. 8453"
            value={chainInput}
            onChange={(e) => { setChainInput(e.target.value); setErr('') }}
          />
          {err && <span className={styles.noSMAImportErr}>{err}</span>}
          <div className={styles.noSMAImportActions}>
            <SailButton onClick={handleManualImport}>Import SMA</SailButton>
            <button type="button" className={styles.noSMAImportLink} onClick={() => { setManual(false); setErr('') }}>
              Back to discovered Safes
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.noSMAImport}>
          {scanning && safes.length === 0 && (
            <span className={styles.noSMAImportScan}>
              Scanning for Safes owned by {truncateAddr(ownerAddr)}…
            </span>
          )}
          {safes.length > 0 && (
            <ul className={styles.importSafeList}>
              {safes.map((s) => (
                <li key={`${s.chainId}-${s.safe}`}>
                  <button
                    type="button"
                    className={styles.importSafeRow}
                    onClick={() => importSafe(s.safe, s.chainId)}
                  >
                    <span className={styles.importSafeAddr}>{truncateSma(s.safe)}</span>
                    <span className={styles.importSafeNet}>
                      {CHAIN_NAMES[s.chainId] ?? `chain ${s.chainId}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {done && safes.length === 0 && (
            <span className={styles.noSMAImportScan}>
              No Safes found for this wallet on supported chains.
            </span>
          )}
          <div className={styles.noSMAImportActions}>
            <button type="button" className={styles.noSMAImportLink} onClick={() => setManual(true)}>
              Enter an address manually
            </button>
            <button type="button" className={styles.noSMAImportLink} onClick={() => setShowImport(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className={styles.noSMAFine}>Self-custody. Sail never holds your keys.</p>
    </section>
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
          Draft one with your AI — sign each permission individually.
        </span>
      </span>
    </button>
  )
}


/* ────────── Notifications bell + dropdown ──────────
   The bell badges the count of signing requests the agent has pushed to the
   running station daemon (via /api/station/pending). The dropdown gives a brief
   read on each pending tx/signature without leaving the dashboard; "Open
   signing station" jumps to #/station to actually approve. */
function NotificationsBell({ pending, draft, open, onToggle, onClose, onOpenStation, onOpenSigning }) {
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
                appears here — start it with <code>sailor station start</code>.
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
                    onClick={onOpenStation}
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
                      {SIGNING_CHAIN_NAMES[req.chainId] ?? `Chain ${req.chainId}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pending.length > 0 && (
            <button type="button" className={styles.notifFootBtn} onClick={onOpenStation}>
              Open signing station
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
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.6 6.2a3.4 3.4 0 016.8 0v2.6c0 .9.3 1.7.9 2.3l.6.7H3.1l.6-.7c.6-.6.9-1.4.9-2.3V6.2z" />
      <path d="M6.8 12.5a1.4 1.4 0 002.4 0" />
    </svg>
  )
}
function ArrowOutIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 9 L9 5" />
      <path d="M5.4 5 H9 V8.6" />
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
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.6" />
      <path d="M4 4V3a1 1 0 011-1h4.5a1 1 0 011 1v5a1 1 0 01-1 1H9" />
    </svg>
  )
}
function CheckSm() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7.4l2.6 2.6L11 4.4" />
    </svg>
  )
}
function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 8.4l3 3L13 5.2" />
    </svg>
  )
}
function CrossSm() {
  return (
    <svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
function StopIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="currentColor" aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
    </svg>
  )
}
function ShieldGlyphSm() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2l5 2v4.5c0 3-2.2 5.4-5 6-2.8-.6-5-3-5-6V4l5-2z" />
      <path d="M5.8 8.2l1.7 1.7L10.4 7" />
    </svg>
  )
}
function DocGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 2.5h5l3 3v8a.5.5 0 01-.5.5h-7.5a.5.5 0 01-.5-.5v-10a.5.5 0 01.5-.5z" />
      <path d="M9 2.5v3h3" />
      <path d="M5.6 9h5M5.6 11.4h5" />
    </svg>
  )
}
function ClockGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2.1 1.5" />
    </svg>
  )
}
function KeyGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="5.5" cy="6" r="2.8" />
      <path d="M7.7 7.8l4.3 4.3M10.4 10.5l1.2-1.2M12 12.1l1.2-1.2" />
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
