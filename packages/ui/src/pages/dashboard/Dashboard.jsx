import { useEffect, useMemo, useState } from 'react'
import {
  BrandMark,
  FluidBackground,
  MandateStatus,
  Sai,
  SailButton,
} from '../shared'
import shared from '../shared/shared.module.css'
import styles from './Dashboard.module.css'
import agentStyles from './SharedLayout.module.css'
import {
  mockWallet,
  mockSafes,
  mockMandates,
  mockPending,
  mockSmaMandates,
  mockDashboardJournal,
} from './mockData'
import PendingDrawer from './PendingDrawer'
import AIHandoffModal from './AIHandoffModal'
import ProfileModal from './ProfileModal'
import PendingModal from './PendingModal'
import CreateSMAModal from './CreateSMAModal'
import ContractModal from './ContractModal'
import { useDemoState } from '../../demo/useDemoState'
import {
  useSailorAccount,
  useSailorActivity,
  useSailorAgentStatus,
  useSailorMandate,
} from '../../hooks/useSailorData'

function brandClass(name) {
  const n = (name ?? '').toLowerCase()
  if (n === 'claude' || n === 'anthropic') return styles.mCard_claude
  if (n === 'cursor') return styles.mCard_cursor
  if (n === 'codex' || n === 'chatgpt' || n === 'openai' || n === 'gpt') return styles.mCard_openai
  return ''
}

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
    return new Date(ts).toLocaleTimeString()
  } catch {
    return ts ?? ''
  }
}

const ACTIVITY_LABELS = {
  dispatch_executed: 'executed dispatch',
  dispatch_approved: 'approved dispatch',
  dispatch_denied: 'denied dispatch',
  tick_start: 'tick started',
  tick_end: 'tick ended',
  error: 'error',
  log: 'log',
}

function activityStatus(type) {
  if (type === 'dispatch_executed' || type === 'dispatch_approved') return 'success'
  if (type === 'dispatch_denied' || type === 'error') return 'rejected'
  return 'info'
}

/** Live mandate card built from .sail/mandate.json (replaces the mock summary cards). */
function LiveMandateCard({ mandate }) {
  const permissions = mandate?.permissions ?? []
  const status = mandate?.registeredOnChain ? 'active' : 'pending'
  const signed = mandate?.signedAt ? new Date(mandate.signedAt).toLocaleDateString() : ''
  return (
    <article className={styles.mandateSummary}>
      <header className={styles.mandateSummaryHead}>
        <div className={styles.mandateSummaryHeadText}>
          <span className={styles.mandateSummaryKicker}>
            Live mandate{signed ? ` · signed ${signed}` : ''}
          </span>
          <h3 className={styles.mandateSummaryTitle}>
            {mandate?.chainId ? `Mandate · chain ${mandate.chainId}` : 'Mandate'}
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

/** Live activity feed from .sail/activity.jsonl (newest first). */
function LiveActivityFeed({ events }) {
  const rows = [...events].slice(-12).reverse()
  return (
    <ul className={agentStyles.journalList}>
      {rows.map((e, i) => {
        const st = activityStatus(e.type)
        const hasTx = e.txHash && e.txHash !== '0x'
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
                  <span className={agentStyles.journalAction}>
                    {ACTIVITY_LABELS[e.type] ?? e.type}
                  </span>
                </span>
                <span className={agentStyles.journalMeta}>
                  {e.permission ? truncateAddr(e.permission) : e.reason ?? e.msg ?? ''}
                  {hasTx && (
                    <>
                      {' · '}
                      <a
                        href={`https://basescan.org/tx/${e.txHash}`}
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
  )
}

export default function Dashboard() {
  const demo = useDemoState()
  const hasSMA = demo.demo !== 'empty'
  const initialPending = !hasSMA
    ? []
    : demo.demo === 'incoming' && demo.incoming
    ? [demo.incoming]
    : mockPending

  // Local state — kept minimal. The dashboard's job is to read, not
  // to orchestrate write flows; those live in modal dialogs.
  const [smaMandates] = useState(mockSmaMandates)
  const [mandates, setMandates] = useState(mockMandates)
  const [filter, setFilter] = useState('all')
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [stopAllOpen, setStopAllOpen] = useState(false)
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [pending, setPending] = useState(initialPending)

  const [profileOpen, setProfileOpen] = useState(false)
  const [pendingModalOpen, setPendingModalOpen] = useState(false)
  const [pendingDrawerOpen, setPendingDrawerOpen] = useState(false)
  const [pendingDrawerSel, setPendingDrawerSel] = useState(null)
  const [createSMAOpen, setCreateSMAOpen] = useState(false)
  const [handoff, setHandoff] = useState(null)
  const [currentSafeId, setCurrentSafeId] = useState(mockSafes[0].id)
  const [safeNames, setSafeNames] = useState({})

  const resolvedSafes = useMemo(
    () => mockSafes.map((s) => ({ ...s, name: safeNames[s.id] ?? s.name })),
    [safeNames],
  )
  const baseSma = resolvedSafes.find((s) => s.id === currentSafeId) ?? resolvedSafes[0]

  // Real account from .sail/account.json, if the SMA has been deployed.
  // When present, show its on-chain address + chain over the mock SMA;
  // otherwise fall back to the existing mock display.
  const { account: realAccount } = useSailorAccount()
  const sma = realAccount
    ? {
        ...baseSma,
        address: realAccount.safe,
        network: CHAIN_NAMES[realAccount.chainId] ?? baseSma?.network,
      }
    : baseSma

  // Live project state from .sail/. When present, the dashboard renders real
  // mandate/agent/activity cards; otherwise it falls back to the mock data.
  const { mandate: liveMandate } = useSailorMandate()
  const { events: liveActivity } = useSailorActivity()
  const { running: agentRunning, pid: agentPid } = useSailorAgentStatus()
  const [stopping, setStopping] = useState(false)
  const hasLiveMandate = liveMandate != null
  const liveMode = hasLiveMandate || agentRunning

  async function stopAgent() {
    setStopping(true)
    try {
      await fetch('/api/agent-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
    } catch {
      // server unreachable — the agent-status poll will reconcile state
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

  function stopAll() {
    // "Stop all" pauses every active mandate without revoking it —
    // open positions stay in place. Mockup: flip status flag.
    setMandates((arr) =>
      arr.map((m) => (m.status === 'active' ? { ...m, status: 'paused', activeNow: false } : m)),
    )
    setStopAllOpen(false)
  }

  function confirmRevokeMandate() {
    if (!revokeTarget) return
    setMandates((arr) =>
      arr.map((m) =>
        m.id === revokeTarget.id ? { ...m, status: 'revoked', activeNow: false } : m,
      ),
    )
    setRevokeTarget(null)
  }

  function confirmRevokePermission() {
    if (!pendingRevoke) return
    setPermissions((arr) =>
      arr.map((p) => (p.id === pendingRevoke.id ? { ...p, revoked: true } : p)),
    )
    setPendingRevoke(null)
  }

  function authorizePending(id) {
    setPending((prev) => prev.filter((x) => x.id !== id))
    setPendingDrawerSel(null)
    if (pending.length <= 1) setPendingDrawerOpen(false)
  }
  function rejectPending(id) {
    setPending((prev) => prev.filter((x) => x.id !== id))
    setPendingDrawerSel(null)
    if (pending.length <= 1) setPendingDrawerOpen(false)
  }

  // Deep-link consumers — preserve the existing ?pending=<id> behavior.
  useEffect(() => {
    const consume = () => {
      const raw = window.location.hash
      const qIdx = raw.indexOf('?')
      if (qIdx < 0) return
      const params = new URLSearchParams(raw.slice(qIdx + 1))
      const pendingId = params.get('pending')
      if (pendingId) {
        setPendingDrawerSel(pendingId)
        setPendingDrawerOpen(true)
      }
      if (pendingId) {
        history.replaceState(null, '', raw.slice(0, qIdx) || '#/dashboard')
      }
    }
    consume()
    window.addEventListener('hashchange', consume)
    return () => window.removeEventListener('hashchange', consume)
  }, [])

  const counts = useMemo(() => ({
    all:     mandates.length,
    active:  mandates.filter((m) => m.status === 'active').length,
    revoked: mandates.filter((m) => m.status === 'revoked').length,
    expired: mandates.filter((m) => m.status === 'expired').length,
    paused:  mandates.filter((m) => m.status === 'paused').length,
  }), [mandates])
  const visibleMandates = useMemo(
    () => (filter === 'all' ? mandates : mandates.filter((m) => m.status === filter)),
    [mandates, filter],
  )
  const anyActiveAgent = counts.active > 0
  const safeUrl = sma ? safeAppUrl(sma.network, sma.address) : '#'
  const debankUrl = sma ? `https://debank.com/profile/${sma.address}` : '#'

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
          onClick={() => { window.location.hash = '#/signing' }}
          aria-label="Go to sign-in"
        >
          <Sai size={48} animate />
        </button>

        <div className={styles.topActionsPill}>
          <button
            type="button"
            className={`${styles.notifBtn} ${pending.length > 0 ? styles.notifBtnLive : ''}`}
            onClick={() => setPendingModalOpen(true)}
            aria-label={pending.length > 0 ? `${pending.length} pending signatures` : 'Notifications'}
          >
            <BellIcon />
            {pending.length > 0 && (
              <span className={styles.notifBadge}>{pending.length}</span>
            )}
          </button>
          <button
            type="button"
            className={styles.avatarBtn}
            onClick={() => setProfileOpen(true)}
            aria-label={`Profile (${truncateAddr(mockWallet)})`}
            title={truncateAddr(mockWallet)}
          >
            <span className={styles.avatarBtnMonogram} aria-hidden>
              {mockWallet.slice(2, 4).toUpperCase()}
            </span>
            <span className={styles.avatarBtnAddr}>{truncateAddr(mockWallet)}</span>
          </button>
        </div>
      </header>

      <main className={agentStyles.main}>
        {!hasSMA ? (
          <NoSMAHero onCreate={() => setCreateSMAOpen(true)} />
        ) : (
          <>
            {pending.length > 0 && (
              <PendingBanner
                count={pending.length}
                onReview={() => setPendingModalOpen(true)}
              />
            )}

            {/* ── SMA title block ────────────────────────────────────
                The SMA is the page subject. Name on the left at h1
                weight, "Stop all agents" at the top-right as the
                destructive global lever. Below: address pill (copy =
                deposit UI) and created-date meta. */}
            <section className={agentStyles.titleBlock}>
              <div className={styles.titleHeadFlex}>
                <h1 className={agentStyles.title}>{sma?.name ?? 'SMA'}</h1>
                <button
                  type="button"
                  className={agentStyles.stopAllBtn}
                  onClick={() => {
                    if (agentRunning) stopAgent()
                    else if (!liveMode) setStopAllOpen(true)
                  }}
                  disabled={liveMode ? !agentRunning || stopping : !anyActiveAgent}
                  title={
                    liveMode
                      ? agentRunning
                        ? 'Send SIGTERM to the running agent'
                        : 'Agent is not running'
                      : anyActiveAgent
                        ? 'Stop every agent under this mandate'
                        : 'All agents already stopped'
                  }
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
                  {hasLiveMandate
                    ? `${(liveMandate.permissions ?? []).length} permission${
                        (liveMandate.permissions ?? []).length === 1 ? '' : 's'
                      } · live`
                    : `${smaMandates.length} signed mandates`}
                </span>
              </header>

              <div className={styles.mandateList}>
                {hasLiveMandate ? (
                  <LiveMandateCard mandate={liveMandate} />
                ) : (
                  <>
                    {smaMandates.map((m) => (
                      <MandateSummaryCard key={m.id} mandate={m} />
                    ))}
                    <NewMandateTile onClick={() => setHandoff({ variant: 'new' })} />
                  </>
                )}
              </div>
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
                <div className={styles.agentsHeadRight}>
                  {/* Filter chips only — the "Add agent" CTA lives as
                      the trailing tile in the card grid, so there's no
                      need for a duplicate button in the section head.
                      Hidden in live mode (a single real agent process). */}
                  {!liveMode && (
                    <FilterChips active={filter} counts={counts} onChange={setFilter} />
                  )}
                </div>
              </header>

              <div className={styles.mandateCards}>
                {liveMode ? (
                  <LiveAgentCard running={agentRunning} pid={agentPid} />
                ) : (
                  <>
                    {visibleMandates.map((m) => (
                      <MandateCard
                        key={m.id}
                        mandate={m}
                        onView={() => { window.location.hash = `#/agent/${m.id}` }}
                      />
                    ))}
                    {visibleMandates.length === 0 && (
                      <EmptyAgentsState
                        filter={filter}
                        onNew={() => setHandoff({ variant: 'new' })}
                      />
                    )}
                  </>
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
                <LiveActivityFeed events={liveActivity} />
              ) : liveMode ? (
                <div className={styles.emptyAgents}>
                  <p className={styles.emptyAgentsBody}>
                    No activity yet — run <code>sailor run</code> to start
                  </p>
                </div>
              ) : (
                <>
                  <ul className={agentStyles.journalList}>
                    {mockDashboardJournal.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          className={`${agentStyles.journalRow} ${
                            e.status === 'rejected' ? agentStyles.journalRowRejected : ''
                          }`}
                          onClick={() => { window.location.hash = `#/journal/${e.id}` }}
                        >
                          <span className={agentStyles.journalTime}>{e.time}</span>
                          <span
                            className={`${agentStyles.journalMark} ${agentStyles[`jStatus_${e.status}`] ?? ''}`}
                            aria-hidden
                          >
                            {e.status === 'success' && <CheckSm />}
                            {e.status === 'rejected' && <CrossSm />}
                            {(e.status === 'info' || e.status === 'warn') && <DotSm />}
                          </span>
                          <span className={agentStyles.journalBody}>
                            <span className={agentStyles.journalTitle}>
                              <span className={agentStyles.journalActor}>{e.actor}</span>
                              <span className={agentStyles.journalAction}> {e.action}</span>
                            </span>
                            <span className={agentStyles.journalMeta}>{e.meta}</span>
                          </span>
                          <span className={`${agentStyles.journalKind} ${agentStyles[`jKind_${e.kind}`] ?? ''}`}>
                            {e.kindLabel}
                          </span>
                          <span className={agentStyles.journalChevron} aria-hidden>
                            <ChevronRight />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>

                  <button type="button" className={agentStyles.journalViewAll}>
                    View full activity log
                    <ArrowRightSm />
                  </button>
                </>
              )}
            </section>

            {/* Local-first disclosure — calm footer so the user knows
                Sail runs entirely on their machine. No hosted backend,
                no remote state. The Studio they're looking at lives at
                localhost; all project state is under .sail/ on disk. */}
            <footer className={styles.localFootnote}>
              <span className={styles.localFootnoteDot} aria-hidden />
              Running locally at <code>localhost:3333</code> · project state lives in
              {' '}<code>.sail/</code>. There is no Sail-hosted backend; your wallet
              talks to the chain directly.
            </footer>
          </>
        )}
      </main>

      {/* Journal detail used to open here as a right-side drawer.
          It now lives at /journal/:entryId as a full page so the user
          gets the same chrome as the Mandate and Agent pages. */}

      <ConfirmStopModal
        open={stopAllOpen}
        count={counts.active}
        onCancel={() => setStopAllOpen(false)}
        onConfirm={stopAll}
      />

      {/* Per-permission revoke modal retired — revoking is mandate-
          level only. The mandate detail page hosts the proper
          contract-fade + REVOKED stamp animation. */}

      <PendingDrawer
        open={pendingDrawerOpen}
        pending={pending}
        selectedId={pendingDrawerSel}
        onClose={() => {
          setPendingDrawerOpen(false)
          setTimeout(() => setPendingDrawerSel(null), 320)
        }}
        onSelect={(id) => setPendingDrawerSel(id)}
        onBack={() => setPendingDrawerSel(null)}
        onAuthorize={authorizePending}
        onReject={rejectPending}
      />

      <AIHandoffModal
        open={!!handoff}
        variant={handoff?.variant}
        mandate={handoff?.mandate}
        onClose={() => setHandoff(null)}
      />

      <ProfileModal
        open={profileOpen}
        wallet={mockWallet}
        safes={resolvedSafes}
        currentSafeId={currentSafeId}
        hasSMA={hasSMA}
        onClose={() => setProfileOpen(false)}
        onCreateSMA={() => { setProfileOpen(false); setCreateSMAOpen(true) }}
        onRenameSafe={(id, name) => setSafeNames((m) => ({ ...m, [id]: name }))}
        onSelectSafe={(s) => setCurrentSafeId(s.id)}
      />

      <PendingModal
        open={pendingModalOpen}
        pending={pending}
        onClose={() => setPendingModalOpen(false)}
        onAuthorize={(id) => {
          authorizePending(id)
          if (pending.length <= 1) setPendingModalOpen(false)
        }}
        onReject={(id) => {
          rejectPending(id)
          if (pending.length <= 1) setPendingModalOpen(false)
        }}
      />

      <CreateSMAModal
        open={createSMAOpen}
        onClose={() => setCreateSMAOpen(false)}
        onComplete={() => {
          window.location.hash = '#/dashboard?demo=funded-empty'
        }}
      />

      {/* Revoke via the signed contract itself — the destructive
          confirmation IS the contract fading out with a REVOKED stamp.
          That animation was the previous build's strongest trust signal;
          we preserve it intact. */}
      <ContractModal
        open={!!revokeTarget}
        mode="revoke"
        mandate={revokeTarget}
        signedDate={revokeTarget ? '2026-04-27' : ''}
        onClose={() => setRevokeTarget(null)}
        onRevoke={confirmRevokeMandate}
      />

      {/* Contract preview modal retired — viewing the signed contract
          now lives inside MandatePage at /mandate/:id, which the
          Your mandate card on the dashboard routes to. */}
    </div>
  )
}

/* ────────── No-SMA hero ────────── */
function NoSMAHero({ onCreate }) {
  return (
    <section className={styles.noSMAHero}>
      <div className={styles.noSMAMascot} aria-hidden>
        <Sai size={64} animate />
      </div>
      <div className={styles.noSMAStatus}>
        <span className={styles.noSMAStatusDot} aria-hidden />
        No SMA created yet
      </div>
      <h2 className={styles.noSMATitle}>Your wallet is connected.</h2>
      <p className={styles.noSMASub}>
        Sail deploys your Separately Managed Account the moment you create your first agent — so you only pay gas when there&rsquo;s something for your AI to do.
      </p>
      <div className={styles.noSMACta}>
        <SailButton onClick={onCreate}>Create your first agent</SailButton>
      </div>
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

/* ────────── Journal detail drawer ────────── */
function JournalDrawer({ entry, open, onClose }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div
        className={`${agentStyles.drawerScrim} ${open ? agentStyles.drawerScrimOpen : ''}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`${agentStyles.drawer} ${open ? agentStyles.drawerOpen : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Decision detail"
      >
        {entry && (
          <>
            <header className={agentStyles.drawerHead}>
              <div className={agentStyles.drawerHeadLeft}>
                <span className={`${agentStyles.drawerKindChip} ${agentStyles[`jKind_${entry.kind}`] ?? ''}`}>
                  {entry.kindLabel}
                </span>
                <span className={agentStyles.drawerTime}>{entry.time} · {entry.dateLabel}</span>
              </div>
              <button
                type="button"
                className={agentStyles.drawerClose}
                onClick={onClose}
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <div className={agentStyles.drawerBody}>
              <h3 className={agentStyles.drawerTitle}>
                <span className={agentStyles.drawerActor}>{entry.actor}</span>
                <span className={agentStyles.drawerAction}> {entry.action}</span>
              </h3>

              <DrawerSection kicker="Why" title="Agent reasoning">
                <p className={agentStyles.drawerProse}>{entry.detail.reasoning}</p>
              </DrawerSection>

              {entry.detail.evidence?.length > 0 && (
                <DrawerSection kicker="What it saw" title="Evidence path">
                  <dl className={agentStyles.evidenceList}>
                    {entry.detail.evidence.map((row, i) => (
                      <div key={i} className={agentStyles.evidenceRow}>
                        <dt>{row.k}</dt>
                        <dd>{row.v}</dd>
                      </div>
                    ))}
                  </dl>
                </DrawerSection>
              )}

              {entry.detail.authorization && (
                <DrawerSection kicker="Authorization" title="Which permission allowed this">
                  <div className={agentStyles.authRow}>
                    <span className={agentStyles.authMark} aria-hidden>
                      {entry.status === 'rejected' ? <CrossMark /> : <CheckMark />}
                    </span>
                    <div className={agentStyles.authBody}>
                      <span className={agentStyles.authLabel}>{entry.detail.authorization.label}</span>
                      <span className={agentStyles.authSub}>{entry.detail.authorization.sub}</span>
                    </div>
                  </div>
                </DrawerSection>
              )}

              {entry.detail.artifact && (
                <DrawerSection kicker="Artifact" title="Onchain receipt">
                  <dl className={agentStyles.artifactList}>
                    {Object.entries(entry.detail.artifact).map(([k, v]) => (
                      <div key={k} className={agentStyles.evidenceRow}>
                        <dt>{k}</dt>
                        <dd className={agentStyles.mono}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </DrawerSection>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  )
}

function DrawerSection({ kicker, title, children }) {
  return (
    <section className={agentStyles.drawerSection}>
      <header className={agentStyles.drawerSectionHead}>
        <span className={agentStyles.drawerSectionKicker}>{kicker}</span>
        <h4 className={agentStyles.drawerSectionTitle}>{title}</h4>
      </header>
      {children}
    </section>
  )
}

/* ────────── Confirmation modals ────────── */
function ConfirmStopModal({ open, count, onCancel, onConfirm }) {
  if (!open) return null
  return (
    <div className={agentStyles.confirmScrim} onClick={onCancel}>
      <div
        className={agentStyles.confirmCard}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={agentStyles.confirmTitle}>Stop all agents?</h3>
        <p className={agentStyles.confirmBody}>
          Pauses each of the {count} agent{count === 1 ? '' : 's'} running under
          this SMA. This is local and reversible — the agents' schedules stop
          firing, but nothing onchain changes. Open positions stay put; you can
          resume any agent individually without re-signing. For a stronger,
          onchain kill switch that halts all dispatch in one signed action,
          open the mandate and use <strong>Revoke mandate</strong>.
        </p>
        <div className={agentStyles.confirmActions}>
          <button type="button" className={agentStyles.confirmCancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={agentStyles.confirmDanger} onClick={onConfirm}>
            Stop all agents
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmRevokePermissionModal({ permission, onCancel, onConfirm }) {
  if (!permission) return null
  return (
    <div className={agentStyles.confirmScrim} onClick={onCancel}>
      <div
        className={agentStyles.confirmCard}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={agentStyles.confirmTitle}>Revoke this permission?</h3>
        <p className={agentStyles.confirmBody}>
          <span className={agentStyles.confirmPerm}>“{permission.label}”</span>
          {' '}will be removed from the mandate. Your agents lose authority to
          take this action immediately. This can&rsquo;t be undone — to restore it,
          ask your AI to draft a replacement mandate.
        </p>
        <div className={agentStyles.confirmActions}>
          <button type="button" className={agentStyles.confirmCancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={agentStyles.confirmDanger} onClick={onConfirm}>
            Revoke
          </button>
        </div>
      </div>
    </div>
  )
}

/* ────────── Filter chips ──────────
   Lifted from the previous Dashboard. Lets the user scope the agent
   grid to Active / Revoked / Expired without losing the All count. */
function FilterChips({ active, counts, onChange }) {
  // Agents are *stopped*, never revoked. The legacy `revoked` status
  // (back-compat with older mock data) really means "the parent mandate
  // was revoked, so the agent ended" — surfaced to users as "Ended".
  const options = [
    { id: 'all',     label: 'All',     count: counts.all },
    { id: 'active',  label: 'Active',  count: counts.active },
    { id: 'paused',  label: 'Stopped', count: counts.paused },
    { id: 'revoked', label: 'Ended',   count: counts.revoked },
    { id: 'expired', label: 'Expired', count: counts.expired },
  ].filter((o) => o.id === 'all' || o.count > 0)
  return (
    <div className={styles.filterChips} role="tablist" aria-label="Filter agents">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={active === o.id}
          className={`${styles.filterChip} ${active === o.id ? styles.filterChipActive : ''}`}
          onClick={() => onChange(o.id)}
        >
          <span>{o.label}</span>
          <span className={styles.filterChipCount}>{o.count}</span>
        </button>
      ))}
    </div>
  )
}

/* ────────── Mandate card ──────────
   The "agent card" the user asked us to restore: brand mark + status
   on top, mandate title + duration below, animated Sai in the middle,
   View / Edit / overflow-Revoke in the footer. Same visual language as
   before; it just lives inside the new SMA-centric dashboard. */
/* ────────── Mandate summary card ──────────
   Wide stacked card representing one signed mandate on the dashboard.
   Title + status + permissions count in the header; up to N allowed
   permissions listed inline (no disallowed rows — anything not
   listed is forbidden by the contract). Whole card is a click target
   into /mandate/:id where the full receipt + revoke action live. */
function MandateSummaryCard({ mandate }) {
  const go = () => { window.location.hash = `#/mandate/${mandate.id}` }
  const aiClass = brandClass(mandate.aiName)
  return (
    <article
      className={`${styles.mandateSummary} ${aiClass}`}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          go()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${mandate.title}`}
    >
      <header className={styles.mandateSummaryHead}>
        <div className={styles.mandateSummaryHeadText}>
          <span className={styles.mandateSummaryKicker}>
            <BrandMark name={mandate.aiName} size={14} />
            Drafted in {mandate.aiName} · {mandate.signedAt}
          </span>
          <h3 className={styles.mandateSummaryTitle}>{mandate.title}</h3>
        </div>
        <div className={styles.mandateSummaryHeadRight}>
          <MandateStatus status={mandate.status} />
          <span className={styles.mandateSummaryCount}>
            {mandate.permissionsAllowed.length} permission
            {mandate.permissionsAllowed.length === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      <ul className={styles.mandateSummaryPerms}>
        {mandate.permissionsAllowed.map((p) => (
          <li key={p.id} className={styles.mandateSummaryPermRow}>
            <span className={styles.mandateSummaryCheck} aria-hidden>
              <CheckMark />
            </span>
            <span className={styles.mandateSummaryPermBody}>
              <span className={styles.mandateSummaryPermLabel}>{p.label}</span>
              <span className={styles.mandateSummaryPermSub}>{p.sub}</span>
              {(p.template || p.version) && (
                <span className={styles.mandateSummaryPermMeta}>
                  {p.template && (
                    <span className={styles.mandateSummaryPermMetaTpl}>{p.template}</span>
                  )}
                  {p.template && p.version && (
                    <span className={styles.mandateSummaryPermMetaSep} aria-hidden>·</span>
                  )}
                  {p.version && (
                    <span className={styles.mandateSummaryPermMetaVer}>v{p.version}</span>
                  )}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <footer className={styles.mandateSummaryFoot}>
        <span className={styles.mandateSummaryFootMeta}>
          {mandate.agentIds.length} delegated signer
          {mandate.agentIds.length === 1 ? '' : 's'} running
        </span>
        <span className={styles.mandateSummaryOpenHint}>
          View full mandate
          <ArrowRightSm />
        </span>
      </footer>
    </article>
  )
}

function MandateCard({ mandate, onView }) {
  const isActive = mandate.status === 'active'
  const aiClass = brandClass(mandate.aiName)
  // The role is now the primary identity — "USDC Yield Specialist",
  // "ETH Hedge Operator", etc. The mandate scope (e.g. "$500 USDC
  // yield on Arbitrum") becomes the subtitle.
  const role = mandate.role ?? mandate.title

  return (
    <article
      className={`${styles.mCard} ${styles.mCardClickable} ${aiClass} ${isActive ? styles.mCardActive : styles.mCardMuted}`}
      onClick={onView}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onView?.()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`View ${role}`}
    >
      <header className={styles.mCardTop}>
        <span className={styles.mAiRow}>
          <BrandMark name={mandate.aiName} size={20} />
          <span className={styles.mAiText}>Created in {mandate.aiName}</span>
        </span>
        <MandateStatus status={mandate.status} kind="agent" />
      </header>

      <div className={styles.mTitleBlock}>
        <h3 className={`${shared.displayHeadline} ${styles.mTitle}`}>{role}</h3>
        <span className={styles.mScope}>{mandate.title}</span>
        <span className={styles.mDuration}>{mandate.duration}</span>
        <span className={styles.mDelegatedTag}>delegated signer</span>
      </div>

      <div className={styles.mCardMid}>
        <span
          className={`${styles.mascot} ${isActive ? styles.mascotLive : styles.mascotMuted}`}
          aria-hidden
        >
          <Sai size={48} animate={isActive} />
        </span>
      </div>

      <footer className={styles.mCardFoot}>
        <button
          type="button"
          className={`${styles.mBtn} ${styles.mBtnPrimary} ${styles.mBtnFull}`}
          onClick={(e) => { e.stopPropagation(); onView?.() }}
        >
          View
        </button>
      </footer>
    </article>
  )
}

/* Edit + Overflow components retired — the card is now a single View
   target. Provider tinting still lives on the card body via `brandClass`
   so each agent retains its AI-provider visual signature, but Edit and
   Revoke moved entirely to the rich AgentPage detail. */

/* New-mandate tile — wide, dashed-border card that sits at the end of
   the Your-mandates stack. Adding a mandate is a new signed bundle of
   permissions on the SMA, not a per-agent action — so the affordance
   lives in the mandate section, parallel to the MandateSummaryCards. */
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

/* Legacy alias preserved in case any modal still references it. */
function NewMandateCard({ onClick }) {
  return <NewMandateTile onClick={onClick} />
}

function EmptyAgentsState({ filter, onNew }) {
  const labels = {
    active:  { title: 'No active agents',  body: 'When your AI drafts one, it appears here for you to authorize.', cta: 'Create an agent' },
    paused:  { title: 'No stopped agents', body: 'Agents you stop land here. You can resume them at any time.', cta: null },
    revoked: { title: 'No ended agents',   body: 'Agents whose parent mandate was revoked land here as a record.', cta: null },
    expired: { title: 'No expired agents', body: 'When an agent hits its end date, it moves here.', cta: null },
    all:     { title: 'No agents yet',     body: 'Ask your AI to draft your first agent.', cta: 'Create your first agent' },
  }
  const meta = labels[filter] ?? labels.all
  return (
    <div className={styles.emptyAgents}>
      <h3 className={styles.emptyAgentsTitle}>{meta.title}</h3>
      <p className={styles.emptyAgentsBody}>{meta.body}</p>
      {meta.cta && (
        <SailButton onClick={onNew}>{meta.cta}</SailButton>
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
function ChevronRight() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 3l4 4-4 4" />
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
function CrossMark() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 4l8 8M12 4L4 12" />
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
