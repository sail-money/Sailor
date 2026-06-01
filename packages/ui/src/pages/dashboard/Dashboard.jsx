import { useEffect, useRef, useState } from 'react'
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
import {
  useSailorAccount,
  useSailorAccounts,
  useSailorActivity,
  useSailorAgentStatus,
  useSailorMandate,
  useSailorOverview,
  useSailorPending,
  useDiscoverSafe,
  switchSailorAccount,
  renameSailorAccount,
} from '../../hooks/useSailorData'

/**
 * Dashboard — SMA-centric main view.
 *
 * Mental model: one SMA holds one mandate (a bundle of permissions);
 * multiple delegated signers run under that one mandate; activity is
 * a single decision journal across all of them.
 *
 * Layout (top to bottom, matching the framework spec):
 *   1. Page header — brand + notifications + wallet identity
 *   2. SMA title block — name, address pill, created date, Stop-all
 *   3. Quick links — View Portfolio (DeBank) + Manage SMA (Safe)
 *   4. Your mandate — permissions list (✓ allowed / ✗ disallowed)
 *   5. Your agents — delegated signers (each with ERC-8004 identity)
 *   6. Recent activity — Agent Decision Journal
 *
 * The previous All-Agents grid is retired; users navigate by SMA, not
 * by mandate. Drill-down to a single delegated signer still lives at
 * /agent/:id.
 */

const SAFE_CHAIN_PREFIX = {
  ethereum: 'eth',
  arbitrum: 'arb1',
  base: 'base',
  optimism: 'oeth',
  polygon: 'matic',
}
// Maps a numeric chainId (from .sail/account.json) to the network key
// used by the explorer/Safe URL helpers above.
const CHAIN_NAMES = {
  1: 'ethereum',
  42161: 'arbitrum',
  8453: 'base',
  10: 'optimism',
  137: 'polygon',
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
    optimism: `https://optimistic.etherscan.io/address/${address}`,
    polygon: `https://polygonscan.com/address/${address}`,
  }
  return map[network] ?? map.ethereum
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
  84532: 'Base Sepolia',
}

const ACTIVITY_LABELS = {
  // Delegated signer (agent) — from `sailor run`
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
  manager: { label: 'Delegated signer', sub: 'Pays gas for every dispatch — keep it funded.' },
  owner: { label: 'Owner', sub: 'Holds the Safe and signs mandates.' },
  permissionSigner: { label: 'Permission signer', sub: 'Authorizes which mandates apply.' },
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
function SignersPanel({ overview, sma, onAddSigner }) {
  const signers = overview?.signers ?? []
  if (signers.length === 0) {
    return (
      <div className={styles.signersOffline}>
        {overview?.onchainError
          ? `Balances unavailable — ${overview.onchainError}`
          : 'Connect an RPC to read signer balances.'}
      </div>
    )
  }
  return (
    <div className={styles.signerGrid}>
      {signers.map((s) => (
        <SignerCard key={s.role} signer={s} network={overview.network} onAddSigner={onAddSigner} />
      ))}
      {sma && overview?.sma?.balanceEth != null && (
        <SignerCard
          signer={{
            role: 'sma',
            address: overview.sma.address,
            balanceEth: overview.sma.balanceEth,
            // The Safe holds funds/tokens, not gas — never flag it for top-up.
            status: 'vault',
          }}
          network={overview.network}
        />
      )}
    </div>
  )
}

function SignerCard({ signer, network, onAddSigner }) {
  const [copied, setCopied] = useState(false)
  const role = signer.role === 'sma'
    ? { label: 'SMA (Safe)', sub: 'Holds your funds. Native ETH shown; tokens not counted.' }
    : (SIGNER_ROLE[signer.role] ?? { label: signer.role, sub: '' })
  const unconfigured = signer.status === 'unconfigured'
  const isLocal = signer.status === 'local'
  const bal = signer.role === 'sma' || unconfigured || isLocal
    ? null
    : (BALANCE_STATUS[signer.status] ?? BALANCE_STATUS.ok)
  const needsTopUp = signer.status === 'low' || signer.status === 'critical'

  function copy() {
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(signer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <article
      className={`${styles.signerCard} ${needsTopUp ? styles.signerCardWarn : ''} ${
        signer.status === 'critical' ? styles.signerCardCrit : ''
      }`}
    >
      <header className={styles.signerCardHead}>
        <span className={styles.signerRole}>{role.label}</span>
        {bal && (
          <span className={`${styles.balancePill} ${styles[`balancePill_${signer.status}`] ?? ''}`}>
            <span className={styles.balancePillDot} aria-hidden />
            {bal.label}
          </span>
        )}
        {isLocal && (
          <span className={styles.balancePill} style={{ color: 'var(--text-secondary)' }}>
            <span className={styles.balancePillDot} aria-hidden style={{ background: 'var(--accent-blue)' }} />
            Local
          </span>
        )}
      </header>

      <div className={styles.signerBalance}>
        {unconfigured ? (
          <span className={styles.signerBalanceNum} style={{ opacity: 0.4 }}>—</span>
        ) : (
          <>
            <span className={styles.signerBalanceNum}>{fmtEth(signer.balanceEth)}</span>
            <span className={styles.signerBalanceUnit}>ETH</span>
          </>
        )}
      </div>
      <p className={styles.signerSub}>
        {unconfigured
          ? 'No delegated signer assigned yet — create or import one to let your agent sign.'
          : isLocal
            ? 'Created locally — not yet delegated on-chain.'
            : role.sub}
      </p>

      {unconfigured && (
        <SailButton fullWidth variant="secondary" onClick={onAddSigner}>
          Add delegated signer
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

      {needsTopUp && (
        <div className={styles.signerTopUp}>
          {signer.status === 'critical' ? 'Out of gas — ' : 'Running low — '}
          send ETH to this address to top up.
        </div>
      )}
    </article>
  )
}

/** Live mandate card built from .sail/mandate.json (replaces the mock summary cards). */
function LiveMandateCard({ mandate, network }) {
  const permissions = mandate?.permissions ?? []
  const status = mandate?.registeredOnChain ? 'active' : 'pending'
  const signed = mandate?.signedAt ? new Date(mandate.signedAt).toLocaleDateString() : ''
  const networkLabel = network ?? (mandate?.chainId ? CHAIN_NAMES[mandate.chainId] : null)
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
        {permissions.map((p, i) => (
          <li key={`${p.template}-${i}`} className={styles.mandateSummaryPermRow}>
            <span className={styles.mandateSummaryCheck} aria-hidden>
              <CheckMark />
            </span>
            <span className={styles.mandateSummaryPermBody}>
              <span className={styles.mandateSummaryPermLabel}>{p.template}</span>
              {/* UI-signed mandates carry a pre-rendered `explanation` string;
                  CLI-signed mandates carry template name + params, explained
                  locally. Either path renders plain-English here. */}
              {(p.explanation
                ? String(p.explanation).split('; ')
                : explainPermission(p)
              ).map((line, j) => (
                <span key={j} className={styles.mandateSummaryPermSub}>
                  {line}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>

      <footer className={styles.mandateSummaryFoot}>
        <span className={styles.mandateSummaryFootMeta}>
          {status === 'active' ? 'Registered on-chain' : 'Signed — awaiting on-chain registration'}
        </span>
      </footer>
    </article>
  )
}

/** Live agent card reflecting the real `sailor run` process state. */
function LiveAgentCard({ running, pid }) {
  return (
    <article
      className={`${styles.mCard} ${running ? styles.mCardActive : styles.mCardMuted}`}
    >
      <header className={styles.mCardTop}>
        <span className={styles.mAiRow}>
          <span className={styles.mAiText}>Sailor agent</span>
        </span>
        <MandateStatus status={running ? 'active' : 'paused'} kind="agent" />
      </header>

      <div className={styles.mTitleBlock}>
        <h3 className={`${shared.displayHeadline} ${styles.mTitle}`}>Agent runner</h3>
        <span className={styles.mScope}>{running ? `running · PID ${pid}` : 'stopped'}</span>
        <span className={styles.mDelegatedTag}>local process</span>
      </div>

      <div className={styles.mCardMid}>
        <span
          className={`${styles.mascot} ${running ? styles.mascotLive : styles.mascotMuted}`}
          aria-hidden
        >
          <Sai size={48} animate={running} />
        </span>
      </div>
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
 * Live activity feed from .sail/activity.jsonl (newest first), capturing both
 * actors: the owner's signing-station decisions and the delegated signer's
 * dispatches. A small segmented filter lets you isolate one actor — the two
 * streams interleave on-chain but answer different questions ("what did I
 * authorize?" vs "what is the agent doing?").
 *
 * Supports incremental loading of older events via "Load 10 more" button.
 */
function LiveActivityFeed({ events, network }) {
  const INITIAL_VISIBLE = 6
  const [filter, setFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)

  const filtered = filter === 'all' ? events : events.filter((e) => activityActor(e) === filter)

  // Newest first, then take only the number we want to display
  const allRows = [...filtered].reverse()
  const rows = allRows.slice(0, visibleCount)
  const hasMore = allRows.length > visibleCount
  const canContract = visibleCount > INITIAL_VISIBLE

  // Reset visible count when filter changes so we don't show stale counts
  const handleFilterChange = (key) => {
    setFilter(key)
    setVisibleCount(INITIAL_VISIBLE)
  }

  const handleLoadMore = () => {
    setVisibleCount((c) => c + 10)
  }

  const handleShowLess = () => {
    setVisibleCount(INITIAL_VISIBLE)
  }

  return (
    <>
      <div className={styles.activityFilter} role="tablist" aria-label="Filter activity by actor">
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
          <p className={styles.emptyAgentsBody}>No {filter === 'all' ? '' : `${filter} `}activity yet.</p>
        </div>
      ) : (
        <>
          <ul className={agentStyles.journalList}>
            {rows.map((e, i) => {
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

          {(hasMore || canContract) && (
            <div style={{ marginTop: '12px', textAlign: 'center', display: 'flex', gap: '8px', justifyContent: 'center' }}>
              {canContract && (
                <button
                  type="button"
                  onClick={handleShowLess}
                  style={{
                    padding: '6px 14px',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: '1px solid #3a3f4a',
                    background: 'transparent',
                    color: '#9aa0ae',
                    cursor: 'pointer',
                  }}
                >
                  Show less
                </button>
              )}
              {hasMore && (
                <button
                  type="button"
                  onClick={handleLoadMore}
                  style={{
                    padding: '6px 14px',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: '1px solid #3a3f4a',
                    background: 'transparent',
                    color: '#9aa0ae',
                    cursor: 'pointer',
                  }}
                >
                  Load 10 more
                </button>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}

export default function Dashboard() {
  const { isConnected, address: wagmiAddress } = useAccount()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  // Bumped on SMA switch/rename to force every panel to refetch immediately
  // instead of waiting for its next poll — the server serves the target SMA's
  // cached snapshot instantly, so the switch feels immediate.
  const [refreshTick, setRefreshTick] = useState(0)
  const [addSignerOpen, setAddSignerOpen] = useState(false)
  const { account: realAccount, loading: accountLoading } = useSailorAccount(refreshTick)
  const { accounts: allAccounts } = useSailorAccounts(refreshTick)
  const { overview } = useSailorOverview(refreshTick)
  const { mandate: liveMandate } = useSailorMandate(refreshTick)
  const { events: liveActivity } = useSailorActivity(refreshTick)
  const { running: agentRunning, pid: agentPid } = useSailorAgentStatus()
  const { pending } = useSailorPending()

  const [justCreatedAccount, setJustCreatedAccount] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sail.account') ?? 'null') } catch { return null }
  })

  const { discovered, scanning } = useDiscoverSafe(
    wagmiAddress,
    isConnected && !accountLoading && !realAccount && !justCreatedAccount,
  )

  useEffect(() => {
    if (!discovered) return
    setJustCreatedAccount(discovered)
    try { localStorage.setItem('sail.account', JSON.stringify(discovered)) } catch {}
  }, [discovered])
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [createSMAOpen, setCreateSMAOpen] = useState(false)
  const [handoff, setHandoff] = useState(null)
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [safeNames, setSafeNames] = useState({})

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
  const hasLiveMandate =
    liveMandate != null &&
    (liveMandate.safe != null
      ? liveMandate.safe.toLowerCase() === activeSafe
      : allAccounts.length <= 1)
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
  const smaName = safeNames[activeAccount?.safe ?? 'live-sma'] ?? activeAccount?.name ?? sma?.name ?? 'My SMA'
  const currentSafeId = activeAccount?.safe ?? effectiveAccount?.safe ?? 'live-sma'
  const profileSafes = allAccounts.length > 0
    ? allAccounts.map((a) => {
        const net = CHAIN_NAMES[a.chainId] ?? 'ethereum'
        const isCurrent = a.safe?.toLowerCase() === currentSafeId?.toLowerCase()
        return {
          id: a.safe,
          name: safeNames[a.safe] ?? a.name ?? 'My SMA',
          address: a.safe,
          network: net,
          networks: [net],
          agentCount: isCurrent && agentRunning ? 1 : 0,
          createdAt: a.addedAt ?? null,
        }
      })
    : sma
    ? [{ ...sma, name: smaName, networks: [realNetwork], agentCount: agentRunning ? 1 : 0, createdAt: null }]
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
            open={notifOpen}
            onToggle={() => setNotifOpen((o) => !o)}
            onClose={() => setNotifOpen(false)}
            onOpenStation={() => { setNotifOpen(false); window.location.hash = '#/station' }}
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
        {/* Local-first: if we know the SMA (from .sail/), show the monitoring
            view straight away — no wallet connection required just to look.
            The connect / scan / setup heroes only appear when no SMA exists. */}
        {!isConnected ? (
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 24px' }}>
            <NotConnectedCard eyebrow="DASHBOARD" title="Connect to view your SMA." sub="Connect the owner wallet you used with sailor init to see your mandates and activity." />
          </div>
        ) : !hasSMA && (accountLoading || scanning) ? (
          <ScanningHero />
        ) : !hasSMA ? (
          <SetupHero
            onCreate={() => setCreateSMAOpen(true)}
            onImport={(account) => {
              setJustCreatedAccount(account)
              try { localStorage.setItem('sail.account', JSON.stringify(account)) } catch {}
            }}
            ownerAddr={ownerAddr}
          />
        ) : (
          <>
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
                <h1 className={agentStyles.title}>{smaName}</h1>
                <button
                  type="button"
                  className={agentStyles.stopAllBtn}
                  onClick={stopAgent}
                  disabled={!agentRunning || stopping}
                  title={agentRunning ? 'Send SIGTERM to the running agent' : 'Agent is not running'}
                >
                  <StopIcon />
                  <span>{stopping ? 'Stopping…' : 'Stop all agents'}</span>
                </button>
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

              {overview?.sma && (
                <div className={styles.smaBadges}>
                  {overview.sma.registered && (
                    <span className={styles.smaBadge}>
                      <ShieldGlyphSm />
                      Registered SMA
                    </span>
                  )}
                  {overview.sma.registered != null && (
                    <MandateStatus status={overview.sma.sessionActive ? 'active' : 'paused'} />
                  )}
                  {overview.network && (
                    <span className={styles.smaBadge}>{overview.network}</span>
                  )}
                  {!overview.onchain && (
                    <span className={`${styles.smaBadge} ${styles.smaBadgeWarn}`}>
                      on-chain read unavailable
                    </span>
                  )}
                </div>
              )}
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
                <span className={`${agentStyles.qlIcon} ${styles.qlIconLarge}`} aria-hidden>
                  <PieGlyph />
                </span>
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
                <span className={`${agentStyles.qlIcon} ${styles.qlIconLarge}`} aria-hidden>
                  <ShieldGlyph />
                </span>
                <span className={agentStyles.qlText}>
                  <span className={`${agentStyles.qlTitle} ${styles.qlTitleLarge}`}>Manage SMA</span>
                  <span className={agentStyles.qlSub}>opens Safe</span>
                </span>
                <span className={agentStyles.qlArrow} aria-hidden><ArrowOutIcon /></span>
              </a>
            </section>

            {/* ── Your mandates ───────────────────────────────────
                Each mandate is its own signed contract with its own
                permission set and its own delegated-signer roster.
                We show only the ✓ permissions here — anything not
                listed is forbidden by the contract by default. Full
                contract receipt, hashes, selectors, and the Revoke
                action live one click in at /mandate/:id. */}
            <section className={styles.mandatesSection} aria-label="Your mandates">
              <header className={styles.mandatesSectionHead}>
                <h2 className={styles.mandatesSectionTitle}>
                  <DocGlyph />
                  Your mandates
                </h2>
                <span className={styles.mandatesSectionMeta}>
                  {overviewMandates.length > 0
                    ? `${overviewMandates.length} permission${
                        overviewMandates.length === 1 ? '' : 's'
                      }${overview?.onchain ? ' · attached on-chain' : ''}`
                    : hasLiveMandate
                      ? `${(liveMandate.permissions ?? []).length} permission${
                          (liveMandate.permissions ?? []).length === 1 ? '' : 's'
                        } · live`
                      : 'No mandate yet'}
                </span>
              </header>

              <div className={styles.mandateList}>
                {overviewMandates.length > 0 ? (
                  <AttachedMandatesPanel
                    mandates={overviewMandates}
                    network={overview?.network ?? realNetwork}
                    onchain={overview?.onchain}
                    onRevoke={overview?.kernel && overview?.sma?.address ? setRevokeTarget : undefined}
                  />
                ) : hasLiveMandate ? (
                  <LiveMandateCard mandate={liveMandate} network={realNetwork} />
                ) : (
                  <NewMandateTile onClick={() => setHandoff({ variant: 'new', context: 'mandate' })} />
                )}
              </div>
            </section>

            {/* ── Delegated signers — gas balances ────────────────────
                The manager (delegated signer) pays gas for every dispatch;
                if it runs dry the agent stalls. This section surfaces each
                signer's live native balance with a top-up status so you can
                refill before that happens. Read-only: Sail never holds keys,
                so "top up" means sending ETH to the shown address yourself. */}
            <section className={styles.signersSection} aria-label="Delegated signers">
              <header className={styles.mandatesSectionHead}>
                <h2 className={styles.mandatesSectionTitle}>
                  <KeyGlyph />
                  Delegated signers
                </h2>
                <span className={styles.mandatesSectionMeta}>
                  {overview?.onchain
                    ? 'live balances · refill when low'
                    : 'balances unavailable'}
                </span>
              </header>
              <SignersPanel overview={overview} sma={sma} onAddSigner={() => setAddSignerOpen(true)} />
            </section>

            {/* ── Your agents — restored card grid ─────────────────
                Each card is one delegated signer (one mandate in the
                old data model). Mascot animates in the middle while
                the agent is active. Clicking View drops into the rich
                AgentPage detail (mandate fingerprint, permission
                receipt, run history, decision journal). Edit opens the
                AI handoff to redraft. Revoke triggers the contract
                fade + REVOKED stamp animation. */}
            <section className={agentStyles.card}>
              <header className={agentStyles.cardHead}>
                <div className={agentStyles.cardHeadText}>
                  <h2 className={agentStyles.cardTitle}>
                    <RobotGlyph />
                    Your agents
                  </h2>
                  <p className={agentStyles.cardSub}>
                    Delegated signers running under this mandate. Click View to inspect the agent in detail.
                  </p>
                </div>
                <div className={styles.agentsHeadRight} />
              </header>

              <div className={styles.mandateCards}>
                {liveMode ? (
                  <LiveAgentCard running={agentRunning} pid={agentPid} />
                ) : (
                  <EmptyAgentsState onNew={() => setHandoff({ variant: 'new', context: 'agent' })} />
                )}
              </div>
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

              {liveActivity.length > 0 ? (
                <LiveActivityFeed events={liveActivity} network={realNetwork} />
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
        mandate={revokeTarget}
        sma={overview?.sma?.address}
        kernel={overview?.kernel}
        chainId={overview?.chainId}
        onClose={() => setRevokeTarget(null)}
        onRevoked={() => setRevokeTarget(null)}
      />

      {/* Contract preview modal retired — viewing the signed contract
          now lives inside MandatePage at /mandate/:id, which the
          Your mandate card on the dashboard routes to. */}
    </div>
  )
}

/* ────────── Scanning hero ────────── */
function ScanningHero() {
  return (
    <section className={styles.noSMAHero}>
      <div className={styles.noSMAMascot} aria-hidden>
        <Sai size={64} animate />
      </div>
      <h2 className={styles.noSMATitle}>Looking for your SMA…</h2>
      <p className={styles.noSMASub}>Scanning Safe Transaction Service across supported chains.</p>
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

/* ────────── Setup hero (wallet connected, no .sail/account.json yet) ────────── */
function SetupHero({ onCreate, onImport, ownerAddr }) {
  const [showImport, setShowImport] = useState(false)
  const [safeInput, setSafeInput] = useState('')
  const [chainInput, setChainInput] = useState('8453')
  const [err, setErr] = useState('')

  function handleImport() {
    const safe = safeInput.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(safe)) {
      setErr('Enter a valid 0x address.')
      return
    }
    const chainId = Number(chainInput)
    if (!chainId) { setErr('Enter a valid chain ID.'); return }
    onImport?.({ safe, owner: ownerAddr ?? safe, permissionSigner: ownerAddr ?? safe, manager: ownerAddr ?? safe, chainId, createdAtBlock: '0' })
  }

  return (
    <section className={styles.noSMAHero}>
      <div className={styles.noSMAMascot} aria-hidden>
        <Sai size={64} animate />
      </div>
      <div className={styles.noSMAStatus}>
        <span className={styles.noSMAStatusDot} aria-hidden />
        No SMA found
      </div>
      <h2 className={styles.noSMATitle}>Your wallet is connected.</h2>
      <p className={styles.noSMASub}>
        Sail deploys your Separately Managed Account the moment you create your first agent — so you only pay gas when there&rsquo;s something for your AI to do.
      </p>

      {!showImport ? (
        <>
          <div className={styles.noSMACta}>
            <SailButton onClick={onCreate}>Create your first agent</SailButton>
          </div>
          <button type="button" className={styles.noSMAImportLink} onClick={() => setShowImport(true)}>
            Already have an SMA? Import it
          </button>
        </>
      ) : (
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
            <SailButton onClick={handleImport}>Import SMA</SailButton>
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
        <span className={styles.newMandateTileLabel}>Create new mandate</span>
        <span className={styles.newMandateTileHint}>
          Draft one with your AI — sign each permission individually.
        </span>
      </span>
    </button>
  )
}

function EmptyAgentsState({ onNew }) {
  return (
    <div className={styles.emptyAgents}>
      <h3 className={styles.emptyAgentsTitle}>No agents yet</h3>
      <p className={styles.emptyAgentsBody}>
        Once you have a mandate, ask your AI to draft an agent strategy. It will appear here for your signature.
      </p>
      <SailButton onClick={onNew}>Create your first agent</SailButton>
    </div>
  )
}

/* ────────── Notifications bell + dropdown ──────────
   The bell badges the count of signing requests the agent has pushed to the
   running station daemon (via /api/station/pending). The dropdown gives a brief
   read on each pending tx/signature without leaving the dashboard; "Open
   signing station" jumps to #/station to actually approve. */
function NotificationsBell({ pending, open, onToggle, onClose, onOpenStation }) {
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

  const count = pending.length

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

          <button type="button" className={styles.notifFootBtn} onClick={onOpenStation}>
            Open signing station
            <ArrowRightSm />
          </button>
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
function PieGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2.5a5.5 5.5 0 105.5 5.5H8z" />
      <path d="M8 2.5v5.5h5.5" />
    </svg>
  )
}
function ShieldGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2l5 2v4.5c0 3-2.2 5.4-5 6-2.8-.6-5-3-5-6V4l5-2z" />
      <path d="M5.8 8.2l1.7 1.7L10.4 7" />
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
function RobotGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5.5" width="10" height="7" rx="1.6" />
      <path d="M8 3.2v2.3" />
      <circle cx="8" cy="2.6" r="0.6" fill="currentColor" />
      <circle cx="6.3" cy="8.6" r="0.9" fill="currentColor" />
      <circle cx="9.7" cy="8.6" r="0.9" fill="currentColor" />
      <path d="M6.5 11h3" />
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
