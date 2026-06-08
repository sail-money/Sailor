import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BrandMark,
  ConnectGate,
  FluidBackground,
  InfoTip,
  Sai,
} from '../shared'
import shared from '../shared/shared.module.css'
import styles from './Dashboard.module.css'
import agentStyles from './SharedLayout.module.css'
import {
  explorerUrl,
  txExplorerUrl,
  safeAppUrl,
  debankUrl,
  getOwnerProfile,
} from '../../data/studioClient'
import {
  getPending,
  getMandateDraft,
  getOnboardState,
  getOverview,
  getAccount,
  getAccounts,
  switchAccount,
  getActivity,
  renameAccount,
} from '../../data/sailorClient'
import { createPublicClient, http } from 'viem'
import { chains } from '../../wagmi'
import { useOwnerWallet } from '../../hooks/useOwnerWallet'
import { useSigningChannel } from '../../hooks/useSigningChannel'
import { useRevokePermission } from '../../hooks/useRevokePermission'
import ProfileModal from './ProfileModal'
import ContractModal from './ContractModal'
import PendingSigningModal from './PendingSigningModal'
import RpcSection from './RpcSection'
import AutomationSection from './AutomationSection'
import RotateSignerModal from './RotateSignerModal'
import FundModal from './FundModal'

/* ──────────────────────────────────────────────────────────────
   Data bridges · map the framework's SMA/mandate shape into the
   shape ProfileModal and ContractModal expect.
   ────────────────────────────────────────────────────────────── */

const CHAIN_NAMES = { 1: 'Ethereum', 130: 'Unichain', 8453: 'Base', 42161: 'Arbitrum', 84532: 'Base Sepolia', 421614: 'Arbitrum Sepolia', 11155111: 'Sepolia' }
const chainName = (id) => CHAIN_NAMES[Number(id)] ?? (id ? `Chain ${id}` : '')

/** ProfileModal expects an array of `safes` with id/name/address/
 *  network/networks/mandateCount/createdAt. Build it from the FULL accounts
 *  list (state/accounts.json via /api/accounts) so every SMA the owner has
 *  shows and is selectable · not just the active one. The active SMA is
 *  enriched with the live overview's chain + mandate count; the others use
 *  what's recorded locally (name, chainId). */
function buildSafesForProfile(accounts, activeSma, mandates) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    // Fall back to the single active SMA if the list isn't loaded yet.
    if (!activeSma) return []
    const net = activeSma.chain?.name || activeSma.chain?.short || ''
    return [{ id: activeSma.id, name: activeSma.name, address: activeSma.address, network: net, networks: net ? [net] : [], mandateCount: mandates.length, agentCount: mandates.length, createdAt: activeSma.createdAt }]
  }
  return accounts.map((a) => {
    const net = a.active ? (activeSma?.chain?.name || chainName(a.chainId)) : chainName(a.chainId)
    const count = a.active ? mandates.length : (a.mandateCount ?? 0)
    return {
      id: a.safe,
      name: a.name || `SMA ${a.safe.slice(0, 6)}…${a.safe.slice(-4)}`,
      address: a.safe,
      network: net,
      networks: net ? [net] : [],
      mandateCount: count,
      agentCount: count,
      createdAt: a.active ? (activeSma?.createdAt ?? a.createdAt) : a.createdAt,
      active: !!a.active,
    }
  })
}

/** ContractModal expects a richer mandate shape (title, aiName,
 *  summary, networks, assets, caps, duration, endsAt, actions).
 *  Fill the gaps from the local mandate + SMA. */
function asContractMandate(m, sma) {
  if (!m || !sma) return null
  return {
    id: m.id,
    title: m.name,
    aiName: null,
    requestedAgo: m.signedAt,
    summary: m.brief,
    networks: [sma.chain?.name || sma.chain?.short].filter(Boolean),
    assets: [],
    caps: [],
    duration: null,
    endsAt: null,
    actions: [],
    allowed: Array.from({ length: m.permissionsCount }, (_, i) => `Permission #${i + 1}`),
    // Onchain references so the contract surface can link to the
    // deployed code the user is about to authorize.
    address: m.address,
    chain: sma.chain,
    smaAddress: sma.address,
  }
}

/* ──────────────────────────────────────────────────────────────
   LIVE adapters · map the real on-chain data (sailorClient:
   getOverview/getAccount) into the studio-shaped records the
   render body expects.
   ────────────────────────────────────────────────────────────── */

const SIGNER_META = {
  manager: { label: 'Manager', description: 'The dispatcher. Signs and pays gas for every run.' },
  owner:   { label: 'Owner',   description: 'Holds the Safe and signs mandates.' },
}

/** Map the SERVER's live balanceStatus to the UI's three funding states.
 *  The server emits 'ok' | 'low' | 'critical' (server.js balanceStatus):
 *    eth ≥ 0.002 → 'ok'  ·  0.0005–0.002 → 'low'  ·  < 0.0005 → 'critical'.
 *  We render: 'funded' | 'low' | 'empty' (empty = critical/zero/unknown). */
function liveStatus(s, balanceEth) {
  if (s === 'funded' || s === 'ok') return 'funded'
  // Anything below the funded threshold but with a visible balance is "low";
  // genuinely zero is "empty" (Not funded).
  const zero = !balanceEth || Number(balanceEth) === 0
  if (zero) return 'empty'
  return 'low'
}

/** User-facing label per funding state. */
const STATUS_LABEL = {
  funded: 'Funded',
  low: 'Low balance',
  empty: 'Not funded',
}
function statusLabel(status) { return STATUS_LABEL[status] ?? 'Not funded' }

/** Pill class per funding state. Funded=blue; low=blue (act-on-me);
 *  empty=coral (zero · needs gas before it can run). */
function statusPillClass(status) {
  if (status === 'low') return styles.gasPillLow
  if (status === 'empty') return styles.gasPillEmpty
  return styles.gasPillFunded
}

/** Map an overview.signers entry (role-keyed) to the wallet shape the
 *  GasCard renders. Falls back to a zero-balance placeholder when the
 *  signer is missing (edge: overview present but signer absent). */
function fromSigner(overview, account, role) {
  const meta = SIGNER_META[role]
  const s = overview?.signers?.find((x) => x.role === role)
  const fallbackAddr = role === 'manager' ? account?.manager : account?.owner
  const status = liveStatus(s?.status, s?.balanceEth)
  return {
    address: s?.address ?? fallbackAddr ?? '',
    balanceEth: s?.balanceEth ?? '0',
    status,
    label: meta.label,
    description: meta.description,
    // Show a fund CTA whenever the wallet isn't comfortably funded.
    refillSuggestionEth: status === 'funded' ? null : 0.002,
    refillHint: fundHint(status),
  }
}

/** Resolve the SMA's creation DATE from its `createdAtBlock` (account.json has
 *  no timestamp · only the block). One light RPC read via the chain's default
 *  endpoint; returns '' on any failure so the chip just stays empty. */
async function fetchCreatedDate(chainId, blockNumber) {
  try {
    if (!chainId || blockNumber == null) return ''
    const chain = chains.find((c) => c.id === chainId)
    if (!chain) return ''
    const client = createPublicClient({ chain, transport: http() })
    const block = await client.getBlock({ blockNumber: BigInt(blockNumber) })
    return new Date(Number(block.timestamp) * 1000)
      .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

/** Capitalize a single word (e.g. live chain name 'base' → 'Base'). */
function capitalizeWord(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

/** Footer hint copy per funding state. */
function fundHint(status) {
  if (status === 'empty') return 'Not funded · top up to run.'
  if (status === 'low') return 'Low balance · top up to keep running.'
  return null
}

/** Build the studio-shaped `sma` record from live overview + account.json.
 *  When overview.sma is missing while hasAccount is true, fall back to
 *  account.json fields for address/owner/manager. */
function buildLiveSma(overview, account) {
  const oSma = overview?.sma ?? null
  const chainId = overview?.chainId ?? account?.chainId ?? null
  const chainName = overview?.network ?? oSma?.network ?? ''
  return {
    id: oSma?.address ?? account?.safe ?? 'sma',
    name: account?.name ?? 'My SMA',
    address: oSma?.address ?? account?.safe ?? '',
    chain: { id: chainId, name: chainName, short: chainName },
    createdAt: account?.createdAt ?? '',
    config: { sessionActive: Boolean(oSma?.sessionActive) },
  }
}

/** Build the studio-shaped `gas` record (sma/agent/owner) from live data. */
function buildLiveGas(overview, account) {
  const oSma = overview?.sma ?? null
  return {
    sma: {
      balanceEth: oSma?.balanceEth ?? '0',
      status: liveStatus(oSma?.balanceStatus, oSma?.balanceEth),
      description: 'Holds your funds. Native ETH shown; tokens not counted.',
    },
    agent: fromSigner(overview, account, 'manager'),
    owner: fromSigner(overview, account, 'owner'),
  }
}

/** Format an ISO timestamp to a short date (e.g. "Jun 7, 2026"); '' on failure. */
function fmtMandateDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

/** Map overview.mandates (the server's history ledger) into the studio-shaped
 *  mandate rows the list renders. `status` (active / revoked) and the dates come
 *  from real recorded events; the rich brief still has no endpoint. */
function buildLiveMandates(overview) {
  return (overview?.mandates ?? []).map((m) => ({
    id: m.address,
    name: m.name,
    address: m.address,
    template: m.template,
    status: m.status ?? 'active',
    drafter: null,
    signedAt: fmtMandateDate(m.registeredAt),
    revokedAt: fmtMandateDate(m.revokedAt),
    permissionsCount: 1,
    brief: '',
  }))
}

/** Mandate list filters · mirrors the activity actor switcher. */
const MANDATE_FILTERS = [
  { id: 'all',     label: 'All' },
  { id: 'active',  label: 'Active' },
  { id: 'revoked', label: 'Revoked' },
  { id: 'expired', label: 'Expired' },
]

/**
 * Dashboard · local-UI dashboard for an AI-managed SMA.
 *
 * Anchored on the data the protocol + framework actually expose.
 * FluidBackground, glass cards, sparing blue accent, MD Nichrome
 * for display, DM Sans for body.
 */
export default function Dashboard() {

  const wallet = useOwnerWallet()
  const { isConnected } = wallet
  // Revoke seam · owner-signed, owner-submitted kernel.revokePermissions.
  const { revoke: revokePermission } = useRevokePermission()

  // ── Live on-chain load state ──
  // `onboard` (null until loaded) drives the 3-way gate below: it tells us
  // whether a REAL SMA exists yet. `overview`/`account` are the live records
  // (getOverview/getAccount) the dashboard body reads through the adapters.
  const [onboard, setOnboard] = useState(null)
  const [overview, setOverview] = useState(null)
  const [account, setAccount] = useState(null)
  // Every SMA the owner has (state/accounts.json), so the profile menu can
  // list + switch between them · not just the active one.
  const [accounts, setAccounts] = useState([])

  // Recent activity is LIVE (GET /api/activity). Owner profile has no live endpoint.
  const [journal, setJournal] = useState([])
  const [ownerProfile, setOwnerProfile] = useState(null)
  useEffect(() => {
    let alive = true
    Promise.all([getActivity().catch(() => []), getOwnerProfile()]).then(([events, o]) => {
      if (!alive) return
      setJournal(mapActivityEvents(events))
      setOwnerProfile(o)
    })
    return () => { alive = false }
  }, [])

  // The live loader. Runs on mount, whenever the wallet connects, and on
  // New-SMA completion reloads live state. Reads onboard state first; only
  // when an account exists do we fetch overview + account.json. getOverview /
  // getAccount are wrapped so a 404 before deploy is treated as "no account".
  const reloadSeq = useRef(0)
  const loadLive = useCallback(async () => {
    const seq = ++reloadSeq.current
    let ob = null
    try {
      ob = await getOnboardState()
    } catch {
      // Couldn't reach the server · DON'T assume "no account" (that would bounce
      // a real user into onboarding). Mark it unknown so the redirect holds off.
      ob = { hasAccount: false, unknown: true }
    }
    if (seq !== reloadSeq.current) return
    setOnboard(ob)
    if (!ob?.hasAccount) {
      setOverview(null)
      setAccount(null)
      return
    }
    const [ov, acc, accts] = await Promise.all([
      // fresh: re-read on-chain (bypass the stale-while-revalidate cache) so a
      // load/reconnect/refocus always reflects current balances + mandates.
      getOverview({ fresh: true }).catch(() => null),
      getAccount().catch(() => null),
      getAccounts().catch(() => []),
    ])
    if (seq !== reloadSeq.current) return
    // The display name lives in the accounts LIST (account.json itself has no
    // `name`), so merge it onto the active account record.
    if (acc?.safe) {
      const match = (accts ?? []).find((a) => a.safe?.toLowerCase() === acc.safe.toLowerCase())
      if (match?.name) acc.name = match.name
    }
    setOverview(ov)
    setAccount(acc)
    setAccounts(Array.isArray(accts) ? accts : [])
    // Resolve the creation date from the block (async, best-effort).
    if (acc?.createdAtBlock != null && (acc?.chainId ?? ov?.chainId)) {
      fetchCreatedDate(acc.chainId ?? ov?.chainId, acc.createdAtBlock).then((date) => {
        if (seq === reloadSeq.current && date) {
          setAccount((prev) => (prev ? { ...prev, createdAt: date } : prev))
        }
      })
    }
  }, [])

  useEffect(() => { loadLive() }, [loadLive])
  // Re-run the loader whenever the wallet connects.
  useEffect(() => { if (isConnected) loadLive() }, [isConnected, loadLive])

  // Switch the active SMA from the profile menu. Sets the chosen account active
  // server-side, then reloads everything so the dashboard reflects the new SMA.
  const handleSelectSafe = useCallback(async (safe) => {
    const id = safe?.id ?? safe?.address
    if (!id) { setProfileOpen(false); return }
    const activeSafe = accounts.find((a) => a.active)?.safe
    if (activeSafe && id.toLowerCase() === activeSafe.toLowerCase()) { setProfileOpen(false); return }
    try {
      await switchAccount({ safe: id })
      setProfileOpen(false)
      await loadLive()
    } catch { /* leave the menu open so the user can retry */ }
  }, [accounts, loadLive])

  // Light refresh of just the overview (balances + mandate ledger), without the
  // full loadLive (onboard/account/block-date). `fresh` forces a synchronous
  // on-chain recompute server-side (bypasses the stale-while-revalidate cache).
  const refreshOverview = useCallback(async ({ fresh = false } = {}) => {
    try {
      const ov = await getOverview({ fresh })
      if (ov) setOverview(ov)
    } catch { /* transient · keep the last known overview rather than blanking */ }
  }, [])

  // Derive the studio-shaped records the render body reads from LIVE data.
  const hasAccount = !!onboard?.hasAccount
  const sma = hasAccount ? buildLiveSma(overview, account) : null
  const gas = hasAccount ? buildLiveGas(overview, account) : null

  // Keep balances live without a manual reconnect. loadLive only runs on
  // mount/connect, so without this the dashboard would freeze its balances until
  // the user disconnected/reconnected. Poll on a light interval (cached path),
  // and force a FRESH on-chain read whenever the tab regains focus · e.g. the
  // user just funded a wallet in another window and switches back.
  useEffect(() => {
    if (!hasAccount) return undefined
    // Passive: a light overview poll every 15s keeps balances trickling in.
    const id = setInterval(() => refreshOverview({ fresh: false }), 15_000)
    // Active: when the user returns to the tab (e.g. after funding/signing in
    // their wallet), do a FULL fresh reload · the exact thing a reconnect does,
    // so they never have to disconnect/reconnect to see current state.
    const onFocus = () => loadLive()
    const onVisible = () => { if (document.visibilityState === 'visible') loadLive() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hasAccount, refreshOverview, loadLive])

  // First-run routing: connected but no on-chain SMA yet → send the user to
  // the new design's onboarding wizard (the Signing page). It drives the real
  // deploy and returns to #/dashboard, where loadLive flips hasAccount true.
  useEffect(() => {
    // Only redirect when we DEFINITIVELY know there's no account · never on a
    // transient load failure (onboard.unknown), which would falsely eject a
    // real user with an SMA into onboarding.
    if (isConnected && onboard && !onboard.hasAccount && !onboard.unknown) {
      window.location.hash = '#/signing'
    }
  }, [isConnected, onboard])

  // ── Pending signing queue (Surface 4) ── sourced from the seam
  // (GET /api/station/pending), polled ~3s, mirroring Sailor's useSailorPending.
  // These are SigningRequest[] (@sail/sdk/signing.ts), NOT the old dashboard
  // mandate shape · the signing surface standardizes on the real protocol type.
  const [pending, setPending] = useState([])
  const [mandateDraft, setMandateDraft] = useState(null)

  // The signing channel · bridge between the agent/CLI and the Owner's wallet
  // (replaces the standalone station page). When the daemon resolves a request
  // it echoes `request-resolved`; drop it from local state so the banner clears.
  const handleChannelMessage = useCallback((msg) => {
    if (msg?.type === 'request-resolved') {
      setPending((list) => list.filter((r) => r.id !== msg.requestId))
    } else if (msg?.type === 'pending') {
      setPending(msg.requests ?? [])
    } else if (msg?.type === 'request') {
      setPending((list) =>
        list.find((r) => r.id === msg.request.id) ? list : [...list, msg.request])
    }
  }, [])
  const { status: channelStatus, send } = useSigningChannel({ onMessage: handleChannelMessage })

  // Poll the pending queue — stays consistent with the optimistic local removal above.
  const pollRef = useRef()
  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const [reqs, draft] = await Promise.all([getPending(), getMandateDraft()])
        if (!alive) return
        setPending(reqs)
        setMandateDraft(draft)
      } catch { /* transient · keep last known queue */ }
    }
    tick()
    pollRef.current = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(pollRef.current) }
  }, [])

  // Relay the Owner's connection state to the daemon (sailor owner connect),
  // mirroring SigningStation.jsx:115–119.
  useEffect(() => {
    if (channelStatus !== 'connected') return
    if (isConnected && wallet.address) send({ type: 'wallet-connected', address: wallet.address })
    else send({ type: 'wallet-disconnected' })
  }, [channelStatus, isConnected, wallet.address, send])

  const pendingCount = pending.length + (mandateDraft ? 1 : 0)

  const [copiedAddr, setCopiedAddr] = useState(false)
  const [editMandateId, setEditMandateId] = useState(null)
  // The mandate contract surface (ContractModal) drives both viewing
  // and revoking. `contractFlow.id` selects the mandate; `mode` is
  // `'view'` for inspect or `'revoke'` for the destructive flow.
  const [contractFlow, setContractFlow] = useState({ id: null, mode: 'view' })
  const [profileOpen, setProfileOpen] = useState(false)
  // In-dashboard "Create new SMA" flow.
  // Pending signatures modal · opened from the announcement bar.
  // Shows the queue of operations the user's AI has drafted and is
  // waiting for the user to sign. Drilling into any item opens the
  // mandate as a contract document. Replaces the previous
  // "router.push('/signing')" jump-out so the user stays on the
  // dashboard while triaging the queue.
  const [signingOpen, setSigningOpen] = useState(false)
  // Manager-key rotation surface · opens from the agent (Manager) wallet card.
  const [rotateOpen, setRotateOpen] = useState(false)
  // Manual hard-refresh (the header "resync" control). A full page reload is the
  // nuclear option that guarantees fresh data + latest code · no reconnect dance.
  const [resyncing, setResyncing] = useState(false)
  const hardRefresh = useCallback(async () => {
    setResyncing(true)
    // Drop any cached assets so a stale bundle can't survive the reload.
    try {
      if (typeof caches !== 'undefined' && caches.keys) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch { /* no Cache API · fine */ }
    window.location.reload()
  }, [])
  // Fund (receive ETH) surface · opens from the SMA hero + operator wallet cards.
  // null when closed, else { kind, label, role, address, chain }.
  const [fundTarget, setFundTarget] = useState(null)
  // Local copy so we can flip an active mandate to revoked without
  // reloading. Seeded from the LIVE overview mandate list whenever it loads.
  const [mandateList, setMandateList] = useState([])
  // Mandate status filter (All / Active / Revoked / Expired).
  const [mandateFilter, setMandateFilter] = useState('all')
  useEffect(() => {
    if (hasAccount && overview) setMandateList(buildLiveMandates(overview))
    else setMandateList([])
  }, [hasAccount, overview])

  // ProfileModal reads the same list (active-mandate count). Keep it aligned.
  const mandates = mandateList

  const contractMandate = mandateList.find((m) => m.id === contractFlow.id) ?? null
  const editingMandate  = mandateList.find((m) => m.id === editMandateId)   ?? null

  const isSessionActive = sma?.config?.sessionActive

  function copySma() {
    if (!sma?.address) return
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(sma.address)
    setCopiedAddr(true)
    setTimeout(() => setCopiedAddr(false), 1400)
  }

  function openPending() {
    if (pendingCount === 0) return
    setSigningOpen(true)
  }

  const safeUrl = sma ? safeAppUrl(sma.chain, sma.address) : '#'
  const debank = sma ? debankUrl(sma.address) : '#'

  // Hold the dashboard body until the live SMA/gas records are derived so
  // nothing dereferences a null record. The chrome/connect/onboarding gates
  // still render via the guards below.
  const dashboardReady = !!(sma && gas)

  return (
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <FluidBackground />

      {/* ── Top bar ──
          Reads "[Sai] / SAIL LOCAL DASHBOARD" · the slash is the
          breadcrumb tick the user asked for, an explicit beat
          between the brand mark and the surface name. */}
      <header className={styles.header}>
        <button
          type="button"
          className={styles.brand}
          onClick={() => { window.scrollTo({ top: 0 }); window.location.hash = '#/dashboard'; window.location.reload() }}
          aria-label="Sail dashboard · refresh"
          title="Refresh dashboard"
        >
          <span className={styles.brandWrap}>
            <Sai size={42} animate />
            <span className={styles.brandSep} aria-hidden>/</span>
            <span className={styles.brandWord}>
              <span className={styles.brandWordPrimary}>SAIL</span>
              <span className={styles.brandWordSecondary}>LOCAL DASHBOARD</span>
            </span>
          </span>
        </button>

        <div className={styles.topActionsPill}>
          {/* Manual hard-refresh · "resync". Re-pulls on-chain state (and the
              latest build) with one click, so balances never look stale. */}
          <button
            type="button"
            className={styles.resyncBtn}
            onClick={hardRefresh}
            title="$ resync · hard refresh, re-pull on-chain state"
            aria-label="Resync: hard refresh the dashboard"
          >
            <span className={`${styles.resyncGlyph} ${resyncing ? styles.resyncGlyphSpin : ''}`} aria-hidden>
              <RefreshIcon />
            </span>
            <span className={styles.resyncLabel}>{resyncing ? 'resyncing…' : 'resync'}</span>
          </button>
          <button
            type="button"
            className={`${styles.notifBtn} ${pendingCount > 0 ? styles.notifBtnLive : ''}`}
            onClick={openPending}
            aria-label={pendingCount > 0 ? `${pendingCount} pending signatures` : 'Notifications'}
          >
            <BellIcon />
            {pendingCount > 0 && (
              <span className={styles.notifBadge}>{pendingCount}</span>
            )}
          </button>
          {isConnected ? (
            <button
              type="button"
              className={styles.avatarBtn}
              onClick={() => setProfileOpen(true)}
              aria-label={`Profile (${truncateAddr(wallet.address)})`}
              title={truncateAddr(wallet.address)}
            >
              <span className={styles.avatarBtnMonogram} aria-hidden>
                {wallet.address.slice(2, 4).toUpperCase()}
              </span>
              <span className={styles.avatarBtnAddr}>{truncateAddr(wallet.address)}</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.connectBtn}
              onClick={wallet.connect}
              aria-label="Connect wallet"
            >
              <span className={styles.connectBtnDot} aria-hidden />
              Connect wallet
            </button>
          )}
        </div>
      </header>

      <main className={agentStyles.main}>
        {!isConnected ? (
          // (a) Wallet not connected · the connect gate.
          <ConnectGate onConnect={wallet.connect} />
        ) : onboard == null ? (
          // (b) Connected, but the live onboard state hasn't loaded yet.
          <div className={styles.onboardWait} aria-busy="true" />
        ) : !hasAccount ? (
          // (c) Connected, but NO real on-chain SMA exists yet → onboarding.
          // The new design's first-run experience is the dedicated Signing
          // wizard (welcome → connect → network → password → deploy). We route
          // there (see the redirect effect above); Signing drives the real
          // deploy and returns to #/dashboard, where loadLive flips hasAccount.
          null
        ) : !dashboardReady ? null : (
        // (d) Connected with a real SMA → the live dashboard.
        <>
        {pendingCount > 0 && (
          <PendingBanner
            count={pendingCount}
            onReview={openPending}
          />
        )}

        {/* ── SMA title block ──
            The SMA *is* the Safe · there's no daylight between "this
            account" and "your funds". So the title section doubles as
            the SMA balance card: native ETH balance, Funded/Low pill,
            address with copy + explorer, and the chain/created meta.
            The dedicated SMA gas card is merged in here; the gas grid
            below shows only the operational wallets (Agent + Owner). */}
        <section className={`${agentStyles.titleBlock} ${styles.smaHero}`}>
          <div className={styles.smaHeroTop}>
            <div className={styles.smaHeroLead}>
              <span className={styles.smaHeroKicker}>
                Separately Managed Account
                <InfoTip label="What is an SMA?" side="bottom">
                  A Separately Managed Account is a self-custody smart account (a Safe) that
                  your AI agents operate inside. You own it outright · Sail and the AI only
                  ever act within the limits you sign. It&rsquo;s deployed once and bound to one chain.
                </InfoTip>
              </span>
              <h1 className={`${agentStyles.title} ${styles.smaHeroTitle}`}>{sma.name}</h1>
              <p className={styles.smaHeroDesc}>{gas.sma.description}</p>
            </div>

            <div className={styles.smaHeroBalanceBlock}>
              <div className={styles.smaHeroBalanceTop}>
                <span className={styles.smaHeroBalanceLabel}>SMA balance</span>
                <span className={statusPillClass(gas.sma.status)}>
                  <span className={styles.gasPillDot} aria-hidden />
                  {statusLabel(gas.sma.status)}
                </span>
              </div>
              <div className={styles.smaHeroBalanceRow}>
                <EthGlyph />
                <span className={styles.smaHeroBalance}>{fmtEth(gas.sma.balanceEth)}</span>
                <span className={styles.smaHeroBalanceUnit}>ETH</span>
              </div>
              <div className={styles.smaHeroBalanceFoot}>
                <span className={styles.smaHeroBalanceCaption}>NATIVE ETH ONLY</span>
                <button
                  type="button"
                  className={styles.gasFundQuiet}
                  onClick={() => setFundTarget({ kind: 'sma', label: 'SMA', role: 'the account that holds your funds', address: sma.address, chain: sma.chain })}
                >
                  Fund
                </button>
              </div>
            </div>
          </div>

          <div className={styles.smaHeroMetaRow}>
            <button
              type="button"
              className={agentStyles.addrPill}
              onClick={copySma}
              aria-label="Copy SMA address"
              title={sma.address}
            >
              <span className={agentStyles.addrMono}>{truncateSma(sma.address)}</span>
              <span className={agentStyles.addrIcon} aria-hidden>
                {copiedAddr ? <CheckSm /> : <CopyGlyph />}
              </span>
              <a
                href={explorerUrl(sma.chain, sma.address)}
                target="_blank"
                rel="noreferrer"
                className={agentStyles.addrOpen}
                onClick={(e) => e.stopPropagation()}
                aria-label="Open SMA on block explorer"
              >
                <ArrowOutIcon />
              </a>
            </button>

            <span className={styles.smaHeroSep} aria-hidden>·</span>

            <span className={styles.smaHeroChip}>
              {capitalizeWord(sma.chain.name)}
            </span>

            {sma.createdAt && (
              <>
                <span className={styles.smaHeroSep} aria-hidden>·</span>
                <span className={styles.smaHeroChip}>
                  <ClockGlyph />
                  Created {sma.createdAt}
                </span>
              </>
            )}

            <span className={styles.smaHeroSep} aria-hidden>·</span>

            <span className={`${styles.smaHeroChip} ${isSessionActive ? styles.smaHeroChipActive : styles.smaHeroChipPaused}`}>
              <span className={styles.gasPillDot} aria-hidden />
              {isSessionActive ? 'Session active' : 'Session paused'}
              <InfoTip label="What is the session?" side="bottom">
                The session is the kernel&rsquo;s master switch for this account. When
                <strong> active</strong>, your agent can execute actions within its mandates;
                when <strong>paused</strong>, every dispatch is blocked on-chain · a one-flag
                kill switch. A new SMA starts paused; resume it (you sign) to let the agent run.
              </InfoTip>
            </span>
          </div>

          {/* ── In-hero quick links ── DeBank + Safe.
              Plain, logo-free links out to the two places users inspect the
              account from outside: portfolio view (DeBank) and custody
              management (Safe). No third-party brand marks · just labelled
              links bound to the SMA they act on. */}
          <div className={styles.smaHeroLinks}>
            <a
              className={`${styles.smaHeroLink} ${styles.smaHeroLinkDebank}`}
              href={debank}
              target="_blank"
              rel="noreferrer"
            >
              <span className={styles.smaHeroLinkText}>
                <span className={styles.smaHeroLinkTitle}>View portfolio</span>
                <span className={styles.smaHeroLinkSub}>opens DeBank</span>
              </span>
              <span className={styles.smaHeroLinkArrow} aria-hidden><ArrowOutIcon /></span>
            </a>
            <a
              className={`${styles.smaHeroLink} ${styles.smaHeroLinkSafe}`}
              href={safeUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span className={styles.smaHeroLinkText}>
                <span className={styles.smaHeroLinkTitle}>Manage SMA</span>
                <span className={styles.smaHeroLinkSub}>opens Safe</span>
              </span>
              <span className={styles.smaHeroLinkArrow} aria-hidden><ArrowOutIcon /></span>
            </a>
          </div>

          {/* ── Network / RPC ──
              The chain connection lives on the account it serves. Compact
              readout (endpoint + chain + health) by default; Edit expands the
              onboarding-style provider picker. Single source of truth · moved
              out of Settings. Maps to /api/onboard/* via sailorClient. */}
          <RpcSection />
          <AutomationSection />
        </section>

        {/* ── Agent wallets · operational gas balances ──
            Only the wallets the user has to top up themselves: the
            Agent wallet that pays per-dispatch gas, and the Owner EOA
            that signs mandate changes. The SMA's balance lives in the
            title hero above (it's the account itself, not a wallet you
            "fund" the same way). */}
        <section className={styles.gasSection} aria-label="Agent wallets">
          <header className={styles.gasSectionHead}>
            <h2 className={styles.gasSectionTitle}>
              <span className={styles.sectionTile} aria-hidden><FuelGlyph /></span>
              <span className={styles.sectionIndex}>01</span>
              <span className={styles.sectionName}>Your wallets</span>
              <InfoTip label="What are your wallets?">
                The two wallets that run your account. The <strong>Manager</strong> is your
                agent&rsquo;s wallet · it submits each action and pays gas. The <strong>Owner</strong>
                is your own wallet · it holds the Safe and signs mandate changes. Keep both
                funded with a little ETH for gas.
              </InfoTip>
            </h2>
            <span className={styles.gasSectionMeta}>LIVE BALANCES</span>
          </header>

          <div className={styles.gasGridTwo}>
            <GasCard
              wallet={gas.agent}
              chain={sma.chain}
              primary="agent"
              onRotate={() => setRotateOpen(true)}
              onFund={() => setFundTarget({ kind: 'manager', label: 'manager wallet', role: 'gas for every agent run', address: gas.agent.address, chain: sma.chain })}
            />
            <GasCard
              wallet={gas.owner}
              chain={sma.chain}
              primary="owner"
              onFund={() => setFundTarget({ kind: 'owner', label: 'owner wallet', role: 'gas for your signatures', address: gas.owner.address, chain: sma.chain })}
            />
          </div>
        </section>

        {/* ── Your mandates · simplified list ──
            Each mandate is one row: LLM brand mark · name · address ·
            expand. Expand reveals the LLM-written brief and the three
            actions: Revoke (opens the contract revoke animation),
            Check on chain (block explorer), Edit (opens an info-only
            redraft modal). Modelled after the permissions list · the
            row stays calm; everything dense lives behind the chevron. */}
        <section className={styles.mandatesSection} aria-label="Your mandates">
          <header className={styles.mandatesSectionHead}>
            <h2 className={styles.mandatesSectionTitle}>
              <span className={styles.sectionTile} aria-hidden><DocGlyph /></span>
              <span className={styles.sectionIndex}>02</span>
              <span className={styles.sectionName}>Your mandates</span>
              <InfoTip label="What is a mandate?">
                A mandate is a permission contract registered on-chain that bounds exactly what
                your agent may do · which contracts it can call, which functions, and within
                what limits. Your agent can never act outside its mandates, and you can revoke
                one at any time.
              </InfoTip>
            </h2>
            {/* Active / Revoked / Expired / All switcher · mirrors the
                activity filter. Mandate CREATION is intentionally NOT a button
                here · new mandates are authored through the AI chat (the
                origination flow), which drives the deploy+register engine
                (useCreateMandate). The dashboard only reflects + manages them. */}
            <div className={styles.actSwitcher} role="tablist" aria-label="Filter mandates by status">
              {MANDATE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={mandateFilter === f.id}
                  className={`${styles.actSwitcherBtn} ${mandateFilter === f.id ? styles.actSwitcherBtnActive : ''}`}
                  onClick={() => setMandateFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </header>

          <ul className={styles.mandateList}>
            {(() => {
              const visible = mandateFilter === 'all'
                ? mandateList
                : mandateList.filter((m) => m.status === mandateFilter)
              if (visible.length === 0) {
                return (
                  <li className={styles.mandateEmpty}>
                    {mandateFilter === 'all' ? 'No mandates yet.' : `No ${mandateFilter} mandates.`}
                  </li>
                )
              }
              return visible.map((m) => (
                <li key={m.id}>
                  <MandateRow
                    mandate={m}
                    chain={sma.chain}
                    onView={() => setContractFlow({ id: m.id, mode: 'view' })}
                    onRevoke={() => setContractFlow({ id: m.id, mode: 'revoke' })}
                    onEdit={() => setEditMandateId(m.id)}
                  />
                </li>
              ))
            })()}
          </ul>
        </section>

        {/* ── Recent activity ──
            Each row expands inline to reveal the actor's processing ·
            the manager's reasoning + evidence, or the owner's signed
            action · plus an on-chain link when there's a real artifact.
            Filterable by actor (All / Manager / Owner) with a Load-more
            pager. No navigation away; everything stays on this surface. */}
        <RecentActivity journal={journal} chain={sma.chain} />

        <footer className={styles.localFootnote}>
          <span className={styles.localFootnoteDot} aria-hidden />
          Running locally at <code>{typeof window !== 'undefined' ? window.location.host : 'localhost'}</code> · project state lives in
          {' '}<code>.sail/</code>. There is no Sail-hosted backend; your wallet talks to the chain directly.
        </footer>
        </>
        )}
      </main>

      {/* ── Mandate contract surface ──
          One modal does double duty: 'view' inspects a signed mandate
          as the formal contract document; 'revoke' opens the same
          surface with the destructive footer + stamp animation. Both
          flows replace the older inline RevokeMandateModal. */}
      <ContractModal
        open={!!contractMandate}
        mode={contractFlow.mode}
        readOnly={contractFlow.mode === 'view'}
        signedDate={contractMandate?.signedAt}
        mandate={asContractMandate(contractMandate, sma)}
        onClose={() => setContractFlow({ id: null, mode: 'view' })}
        onAuthorize={() => setContractFlow({ id: null, mode: 'view' })}
        onReject={() => setContractFlow({ id: null, mode: 'view' })}
        onRevoke={async (permission, onStatus) => {
          // REAL revoke: owner signs RevokePermissions + submits
          // kernel.revokePermissions from their wallet. Resolves only when the
          // tx confirms · the modal plays its stamp on success and re-throws to
          // its own error state on failure. We refresh live data so the row
          // flips to Revoked from on-chain truth (getPermissions), not a guess.
          await revokePermission({
            chainId: sma?.chain?.id,
            permission,
            onStatus,
          })
          await loadLive()
        }}
      />

      {/* ── Pending signing surface (Surface 4) ──
          Opens from the announcement bar / bell. Renders each pending
          SigningRequest (from GET /api/station/pending) as a reviewable
          contract · kind, summary, details, and a calldata reveal · and
          wires Authorize/Reject through the signing channel + Owner wallet.
          Replaces the standalone signing-station PAGE; the daemon bridge
          (channel) stays. A mandate draft, when present, is surfaced here too. */}
      <PendingSigningModal
        open={signingOpen}
        requests={pending}
        draft={mandateDraft}
        wallet={wallet}
        send={send}
        onClose={() => setSigningOpen(false)}
        onDraftSubmitted={() => setMandateDraft(null)}
      />

      {/* ── Manager-key rotation surface ──
          Rotates the SMA's delegated signer (the agent wallet) via the
          owner-signed setManager flow. Opens from the Manager wallet card.
          Refreshes live data on success so the new signer shows. */}
      <RotateSignerModal
        open={rotateOpen}
        chain={sma?.chain}
        currentManager={gas?.agent?.address}
        onClose={() => setRotateOpen(false)}
        onRotated={() => loadLive()}
      />


      {/* ── Fund (receive ETH) surface ──
          A focused receive screen for a gas wallet: network + address + copy.
          Opened from the SMA hero and the operator wallet cards. */}
      <FundModal
        open={!!fundTarget}
        target={fundTarget}
        onClose={() => setFundTarget(null)}
      />

      {/* ── SMA Profile menu ── EOA hero + SMAs list with copy,
          deposit, withdraw, rename. Opens from the avatar button. */}
      <ProfileModal
        open={profileOpen}
        wallet={wallet.address ?? ownerProfile?.address}
        safes={buildSafesForProfile(accounts, sma, mandates)}
        currentSafeId={accounts.find((a) => a.active)?.safe ?? sma?.id}
        hasSMA
        onClose={() => setProfileOpen(false)}
        onCreateSMA={() => { setProfileOpen(false); window.location.hash = '#/signing?new=1' }}
        onOpenSMA={handleSelectSafe}
        onDeposit={() => setProfileOpen(false)}
        onWithdraw={() => setProfileOpen(false)}
        onRenameSafe={(safe, name) => { renameAccount({ safe, name }).then(loadLive).catch(() => {}) }}
        onSelectSafe={handleSelectSafe}
        onDisconnect={wallet.disconnect}
      />

      <EditMandateModal
        open={!!editingMandate}
        mandate={editingMandate}
        onClose={() => setEditMandateId(null)}
      />

    </div>
  )
}

/* ────────── Mandate row ──────────
   Collapsed: brand mark + name + address + chevron.
   Expanded: LLM-written brief + three actions (Revoke / Check on
   chain / Edit). Modeled after the permissions list · the row is
   quiet by default and reveals detail behind the chevron. */
function MandateRow({ mandate, chain, onView, onRevoke, onEdit }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const explorer = explorerUrl(chain, mandate.address)
  const isActive = mandate.status === 'active'
  const isPaused = mandate.status === 'paused'
  const isExpired = mandate.status === 'expired'
  const isRevoked = mandate.status === 'revoked'

  function copyAddr(e) {
    e.stopPropagation()
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(mandate.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const statusLabel = isRevoked ? 'Revoked' : isPaused ? 'Paused' : isExpired ? 'Expired' : 'Active'

  return (
    <article className={`${styles.mandateRow} ${open ? styles.mandateRowOpen : ''} ${styles[`mandateRow_${mandate.status}`] ?? ''}`}>
      <button
        type="button"
        className={styles.mandateRowHead}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {/* Leading mascot. A drafted mandate shows its LLM brand mark; an
            on-chain permission flies Sai · animated when active (alive),
            static + desaturated when revoked/expired. Vertically centered
            against the title+subtitle block by the row's align-items. */}
        {mandate.drafter ? (
          <span className={styles.mandateRowAvatar} aria-hidden>
            <BrandMark name={mandate.drafter} size={20} />
          </span>
        ) : (
          <span
            className={`${styles.mandateRowSaiAvatar} ${isActive ? '' : styles.mandateRowSaiIdle}`}
            aria-label={statusLabel}
            title={statusLabel}
          >
            <Sai size={38} animate={isActive} />
          </span>
        )}

        <span className={styles.mandateRowBody}>
          <span className={styles.mandateRowNameLine}>
            <span className={styles.mandateRowName}>{mandate.name}</span>
          </span>
          <span className={styles.mandateRowSub}>
            {mandate.permissionsCount} permission{mandate.permissionsCount === 1 ? '' : 's'}
            {mandate.signedAt ? (
              <>
                <span className={styles.mandateRowSubDot} aria-hidden>·</span>
                {mandate.signedAt}
              </>
            ) : null}
            <span className={styles.mandateRowSubDot} aria-hidden>·</span>
            <span className={styles.mandateRowSubMono}>{truncateAddr(mandate.address)}</span>
          </span>
        </span>

        <span className={`${styles.mandateRowChevron} ${open ? styles.mandateRowChevronOpen : ''}`} aria-hidden>
          <ChevronDown />
        </span>
      </button>

      {/* ── Expanded detail ──
          Restructured as a proper contract container: three
          sectional blocks (recital · onchain · actions) separated
          by dotted blueprint dividers, with a left blue bar that
          carries the "this is the contract speaking" cue. */}
      <div
        className={`${styles.mandateRowDetail} ${open ? styles.mandateRowDetailOpen : ''}`}
        aria-hidden={!open}
      >
        <div className={styles.mandateRowDetailInner}>
          {/* Block 1 · recital + provenance, framed as a quote
              card with a left blue rail. */}
          {(mandate.brief || mandate.drafter || mandate.signedAt) ? (
            <>
              <section className={styles.mandateRecitalBlock}>
                <span className={styles.mandateBlockEyebrow}>BRIEF /</span>
                {mandate.brief ? (
                  <p className={styles.mandateRowBrief}>{mandate.brief}</p>
                ) : null}
                <p className={styles.mandateRowProvenance}>
                  {mandate.drafter ? <BrandMark name={mandate.drafter} size={14} /> : null}
                  <span>
                    {mandate.drafter ? (
                      <>Drafted by <strong>{mandate.drafter}</strong></>
                    ) : (
                      <>On-chain permission</>
                    )}
                    {mandate.signedAt ? (
                      <>
                        <span className={styles.mandateRowProvenanceSep} aria-hidden>·</span>
                        first registered {mandate.signedAt}
                      </>
                    ) : null}
                  </span>
                </p>
              </section>

              <div className={styles.mandateBlockDivider} aria-hidden />
            </>
          ) : null}

          {/* Block 2 · onchain meta. Address as a wide blueprint
              chip + status pinned right. Mono throughout. */}
          <section className={styles.mandateOnchainBlock}>
            <span className={styles.mandateBlockEyebrow}>ONCHAIN /</span>
            <div className={styles.mandateRowMetaRow}>
              <button
                type="button"
                className={styles.mandateRowAddrChip}
                onClick={copyAddr}
                title={mandate.address}
                aria-label="Copy mandate address"
              >
                <span className={styles.mandateRowAddrChipLabel}>address</span>
                <span className={styles.mandateRowAddrChipMono}>{mandate.address}</span>
                <span className={styles.mandateRowAddrChipIcon} aria-hidden>
                  {copied ? <CheckSm /> : <CopyGlyph />}
                </span>
              </button>

              <span className={styles.mandateRowStatusChip}>
                <span className={`${styles.mandateRowDot} ${styles[`mandateRowDot_${mandate.status}`] ?? ''}`} aria-hidden />
                {statusLabel}
              </span>
            </div>
          </section>

          <div className={styles.mandateBlockDivider} aria-hidden />

          {/* Actions toolbar · no eyebrow. The dotted divider above
              + VIEW CONTRACT's filled blue weight already mark this
              as the action band; a separate ACTIONS / label was
              labelling-for-labelling's-sake. */}
          <div className={styles.mandateActionsBar}>
            <div className={styles.mandateRowActions}>
              <button
                type="button"
                className={`${styles.mandateAction} ${styles.mandateActionView}`}
                onClick={onView}
              >
                <DocGlyph />
                View contract
              </button>
              <a
                className={`${styles.mandateAction} ${styles.mandateActionExplore}`}
                href={explorer}
                target="_blank"
                rel="noreferrer"
              >
                View on explorer
                <ArrowOutIcon />
              </a>
              <button
                type="button"
                className={`${styles.mandateAction} ${styles.mandateActionEdit}`}
                onClick={onEdit}
              >
                <PencilGlyph />
                Edit
              </button>
              <button
                type="button"
                className={`${styles.mandateAction} ${styles.mandateActionRevoke}`}
                onClick={onRevoke}
                disabled={!isActive && !isPaused}
              >
                Revoke
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

/* ────────── Edit modal ──────────
   Informational only. No "Open in {LLM}" CTA · just the prompt the
   user should send their AI, with copy-to-clipboard. */
function EditMandateModal({ open, mandate, onClose }) {
  const [copied, setCopied] = useState(false)
  if (!open || !mandate) return null
  const prompt = `Sail, redraft my "${mandate.name}". I want to change [describe the change].`
  function copyPrompt() {
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div className={styles.modalScrim} onClick={onClose} role="presentation">
      <div
        className={`${styles.modalCard} ${styles.modalCardEdit}`}
        role="dialog"
        aria-modal="true"
        aria-label="Edit mandate"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <header className={styles.editHead}>
          <h2 className={styles.editTitle}>Edit “{mandate.name}”</h2>
          <p className={styles.editBody}>
            Tell <strong>{mandate.drafter}</strong> what to change. It will redraft the mandate and a new signature request will appear here on the dashboard.
          </p>
        </header>

        <div className={styles.promptCard}>
          <span className={styles.promptKicker}>TRY SAYING</span>
          <p className={styles.promptText}>“{prompt}”</p>
          <button
            type="button"
            className={styles.copyPromptBtn}
            onClick={copyPrompt}
          >
            {copied ? (
              <>
                <CheckSm />
                Copied
              </>
            ) : (
              <>
                <CopyGlyph />
                Copy prompt
              </>
            )}
          </button>
        </div>

        <ul className={styles.editTips}>
          <li>Open the chat where you drafted this mandate ({mandate.drafter}) and paste the prompt.</li>
          <li>Describe the change in plain language: caps, venues, time limits, anything in the scope.</li>
          <li>{mandate.drafter} will draft a new signed request. Authorize it from this dashboard to replace the live mandate.</li>
        </ul>

        <p className={styles.modalFootnote}>
          Or run <code>/sail</code> in any Sail-enabled AI client.
        </p>
      </div>
    </div>
  )
}

/* ────────── Pending banner ────────── */
function PendingBanner({ count, onReview }) {
  return (
    <button
      type="button"
      className={styles.pendingBanner}
      onClick={onReview}
      aria-label={`Review ${count} pending operations`}
    >
      <span className={styles.pendingBannerPulse} aria-hidden />
      <span className={styles.pendingBannerBody}>
        <span className={styles.pendingBannerKicker}>Awaiting your signature</span>
        <span className={styles.pendingBannerTitle}>
          <strong>{count}</strong> operation{count === 1 ? '' : 's'} drafted by your AI · ready for review
        </span>
      </span>
      <span className={styles.pendingBannerCta}>
        Review
        <ArrowRightSm />
      </span>
    </button>
  )
}


/* ────────── Gas card ──────────
   Visual architecture: every card in the grid is geometrically
   identical regardless of status. The footer slot at the bottom
   always renders · Low shows the refill CTA, Funded shows a quiet
   mono status line · so the two cards never disagree on height.
   Address row sits on a flex spacer so it floats to the same
   baseline whether the description is one line or two. */
function GasCard({ wallet, chain, primary, onRotate, onFund }) {
  const needsGas = wallet.status !== 'funded'
  const [copied, setCopied] = useState(false)
  function copyAddr(e) {
    e.stopPropagation()
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(wallet.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <article
      className={`${styles.gasCard} ${needsGas ? styles.gasCardLow : ''} ${styles[`gasCard_${primary}`] ?? ''}`}
    >
      {/* Top: label + status chip. */}
      <header className={styles.gasCardHead}>
        <span className={styles.gasCardLabel}>
          {wallet.label}
          <InfoTip label={`What is the ${wallet.label}?`}>
            {primary === 'owner'
              ? 'Your own wallet · the custody anchor. It owns the Safe and is the only key that can authorize mandates or resume/pause the session. It only needs a little ETH for the occasional signature.'
              : 'Your agent’s wallet (the dispatcher). It submits every on-chain action your agent takes and pays the gas. Keep it topped up so runs don’t stall.'}
          </InfoTip>
        </span>
        <span className={statusPillClass(wallet.status)}>
          <span className={styles.gasPillDot} aria-hidden />
          {statusLabel(wallet.status)}
        </span>
      </header>

      {/* Balance · mono console readout, with the ETH mark (matches the SMA hero). */}
      <div className={styles.gasBalanceRow}>
        <EthGlyph />
        <span className={styles.gasBalance}>{fmtEth(wallet.balanceEth)}</span>
        <span className={styles.gasUnit}>ETH</span>
      </div>

      <p className={styles.gasDesc}>{wallet.description}</p>

      {/* Address strip · pushed to the bottom via .gasAddrRow flex
          rule so it lands at the same y in both cards. */}
      <div className={styles.gasAddrRow}>
        <button
          type="button"
          className={styles.gasAddrPill}
          onClick={copyAddr}
          title={wallet.address}
          aria-label={`Copy ${wallet.label} address`}
        >
          <span className={styles.gasAddrMono}>{truncateAddr(wallet.address)}</span>
          <span className={styles.gasAddrIcon} aria-hidden>
            {copied ? <CheckSm /> : <CopyGlyph />}
          </span>
        </button>
        <a
          href={explorerUrl(chain, wallet.address)}
          target="_blank"
          rel="noreferrer"
          className={styles.gasAddrOpen}
          aria-label={`Open ${wallet.label} in explorer`}
          onClick={(e) => e.stopPropagation()}
        >
          <ArrowOutIcon />
        </a>
        {/* Manager card only: rotate the delegated signer (agent wallet). */}
        {onRotate && (
          <button
            type="button"
            className={styles.gasRotateBtn}
            onClick={(e) => { e.stopPropagation(); onRotate() }}
            title="Rotate the agent wallet (replace this signer)"
          >
            <RotateGlyph />
            Rotate
          </button>
        )}
      </div>

      {/* Footer slot · always rendered, fixed geometry. Low gets
          the refill CTA; Funded gets a quiet "in good standing"
          mono line. Both occupy the same vertical footprint so
          the two cards stay coplanar. */}
      {/* One consistent footer in every state: a quiet status readout + a
          calm Fund link. Urgency is carried by the status pill above, not by
          a big button · same clean treatment across SMA, Manager, Owner. */}
      <div className={styles.gasFooter}>
        <span className={styles.gasFooterStatus}>
          <span
            className={`${styles.gasFooterStatusDot} ${needsGas ? styles.gasFooterStatusDotIdle : ''}`}
            aria-hidden
          />
          {wallet.status === 'funded' ? 'SUFFICIENT GAS' : wallet.status === 'low' ? 'LOW BALANCE' : 'NOT FUNDED'}
        </span>
        {onFund && (
          <button type="button" className={styles.gasFundQuiet} onClick={onFund}>
            Fund
          </button>
        )}
      </div>
    </article>
  )
}

/* ────────── Recent activity ──────────
   A filterable, paginated feed. Each row expands inline to show the
   actor's processing (the manager's reasoning + evidence, or the
   owner's signed action) and a link to the onchain artifact when one
   exists. Replaces the old "route to /journal" rows. */

/** Which actor drove this event · the manager (the agent/dispatcher)
 *  or the owner (the EOA that signs). Sail-runtime/system events fall
 *  through to neither and only appear under "All". */
/** Map raw /api/activity events (append-only jsonl) to the row shape the
 *  Recent Activity surface renders. Newest first (the log is oldest-first). */
function mapActivityEvents(events) {
  if (!Array.isArray(events)) return []
  return [...events].reverse().map((e, i) => {
    const isOwner = e.actor === 'owner'
    const isAgent = e.actor === 'agent'
    const type = e.type ?? ''
    const success = /signed|deployed|registered|success|confirmed|attached/i.test(type)
    const rejected = /reject|block|fail|revert|error/i.test(type)
    let time = ''
    try { time = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { /* keep '' */ }
    return {
      id: `${e.ts ?? 'evt'}-${i}`,
      time,
      dateLabel: '',
      actor: isOwner ? 'You' : isAgent ? 'Agent' : 'System',
      agentId: isAgent ? 'agent' : null,
      action: e.title || e.name || e.msg || (e.type ? e.type.replace(/_/g, ' ') : 'event'),
      summary: e.reason || e.type || '',
      source: e.type ?? '',
      sourceLabel: isOwner ? 'Owner action' : isAgent ? 'Run' : 'System',
      status: success ? 'success' : rejected ? 'rejected' : 'info',
      detail: {
        reasoning: e.reason || e.msg || '',
        evidence: [
          e.address && { k: 'Address', v: e.address },
          e.name && { k: 'Name', v: e.name },
        ].filter(Boolean),
        artifact: e.txHash ? { 'Tx hash': e.txHash } : undefined,
      },
    }
  })
}

function activityRole(e) {
  if (e.actor === 'You') return 'owner'
  if (e.agentId) return 'manager'
  return 'system'
}

/** Pull a tx hash from the entry's artifact or evidence, if any. */
function activityTxHash(e) {
  const a = e.detail?.artifact
  if (a && a['Tx hash']) return a['Tx hash']
  const ev = e.detail?.evidence?.find((x) => /tx hash/i.test(x.k))
  return ev?.v ?? null
}

const ACTIVITY_FILTERS = [
  { id: 'all',     label: 'All' },
  { id: 'manager', label: 'Manager' },
  { id: 'owner',   label: 'Owner' },
]
const ACTIVITY_PAGE = 4

function RecentActivity({ journal, chain }) {
  const [filter, setFilter] = useState('all')
  const [visible, setVisible] = useState(ACTIVITY_PAGE)
  const [openId, setOpenId] = useState(null)

  const filtered = journal.filter((e) =>
    filter === 'all' ? true : activityRole(e) === filter,
  )
  const shown = filtered.slice(0, visible)
  const remaining = filtered.length - shown.length

  function changeFilter(id) {
    setFilter(id)
    setVisible(ACTIVITY_PAGE)
    setOpenId(null)
  }

  return (
    <section className={styles.actSection} aria-label="Recent activity">
      <header className={styles.actSectionHead}>
        <div className={styles.actSectionHeadText}>
          <h2 className={styles.actSectionTitle}>
            <span className={styles.sectionTile} aria-hidden><ClockGlyph /></span>
            <span className={styles.sectionIndex}>03</span>
            <span className={styles.sectionName}>Recent activity</span>
          </h2>
          <p className={styles.actSectionSub}>
            Runs, recommendations, rehearsals, sessions, audit. Expand any row for the reasoning and evidence.
          </p>
        </div>

        {/* All / Manager / Owner switcher */}
        <div className={styles.actSwitcher} role="tablist" aria-label="Filter activity by actor">
          {ACTIVITY_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`${styles.actSwitcherBtn} ${filter === f.id ? styles.actSwitcherBtnActive : ''}`}
              onClick={() => changeFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {shown.length === 0 ? (
        <div className={styles.actEmpty}>
          No {filter === 'all' ? '' : `${filter} `}activity yet. Your agent hasn&rsquo;t run.
        </div>
      ) : (
        <ul className={styles.actList}>
          {shown.map((e) => (
            <li key={e.id}>
              <ActivityRow
                entry={e}
                chain={chain}
                open={openId === e.id}
                onToggle={() => setOpenId((id) => (id === e.id ? null : e.id))}
              />
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <button
          type="button"
          className={styles.actLoadMore}
          onClick={() => setVisible((v) => v + ACTIVITY_PAGE)}
        >
          Load more
          <span className={styles.actLoadMoreCount}>{remaining} more</span>
        </button>
      )}
    </section>
  )
}

function ActivityRow({ entry: e, chain, open, onToggle }) {
  const txHash = activityTxHash(e)
  const role = activityRole(e)
  const roleLabel = role === 'manager' ? 'Manager' : role === 'owner' ? 'Owner' : 'System'

  return (
    <article className={`${styles.actItem} ${open ? styles.actItemOpen : ''} ${e.status === 'rejected' ? styles.actItemRejected : ''}`}>
      <button
        type="button"
        className={styles.actHead}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={styles.actTime}>{e.time}</span>
        <span className={`${styles.actMark} ${styles[`actMark_${e.status}`] ?? ''}`} aria-hidden>
          {e.status === 'success' && <CheckSm />}
          {e.status === 'rejected' && <CrossSm />}
          {(e.status === 'info' || e.status === 'warn') && <DotSm />}
        </span>
        <span className={styles.actBody}>
          <span className={styles.actTitle}>
            <span className={styles.actActor}>{e.actor}</span>
            <span className={styles.actAction}> {e.action}</span>
          </span>
          <span className={styles.actMetaLine}>{e.summary}</span>
        </span>
        <span className={`${styles.actKind} ${styles[`actKind_${mapKind(e.source)}`] ?? ''}`}>
          {e.sourceLabel}
        </span>
        <span className={`${styles.actChevron} ${open ? styles.actChevronOpen : ''}`} aria-hidden>
          <ChevronDown />
        </span>
      </button>

      <div className={`${styles.actDetail} ${open ? styles.actDetailOpen : ''}`} aria-hidden={!open}>
        <div className={styles.actDetailInner}>
          {/* Processing · the manager's reasoning, or the owner's note. */}
          {e.detail?.reasoning && (
            <div className={styles.actBlock}>
              <span className={styles.actBlockLabel}>
                {role === 'owner' ? 'OWNER ACTION /' : 'MANAGER PROCESSING /'}
              </span>
              <p className={styles.actReasoning}>{e.detail.reasoning}</p>
            </div>
          )}

          {/* Evidence · the structured k/v the actor logged. */}
          {e.detail?.evidence?.length > 0 && (
            <div className={styles.actBlock}>
              <span className={styles.actBlockLabel}>EVIDENCE /</span>
              <dl className={styles.actEvidence}>
                {e.detail.evidence.map((row) => (
                  <div key={row.k} className={styles.actEvidenceRow}>
                    <dt className={styles.actEvidenceK}>{row.k}</dt>
                    <dd className={styles.actEvidenceV}>{row.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Footer · role chip + onchain link when there's an artifact. */}
          <div className={styles.actDetailFoot}>
            <span className={`${styles.actRoleChip} ${styles[`actRoleChip_${role}`] ?? ''}`}>
              <span className={styles.actRoleDot} aria-hidden />
              {roleLabel}
            </span>
            {txHash ? (
              <a
                className={styles.actOnchain}
                href={txExplorerUrl(chain, String(txHash).replace(/…|\.\.\./g, ''))}
                target="_blank"
                rel="noreferrer"
                onClick={(ev) => ev.stopPropagation()}
              >
                Check on chain
                <span className={styles.actOnchainMono}>{txHash}</span>
                <ArrowOutIcon />
              </a>
            ) : (
              <span className={styles.actNoOnchain}>No onchain transaction</span>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

/* ────────── Formatting helpers ────────── */
function truncateAddr(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
function truncateSma(addr) {
  if (!addr) return ''
  if (addr.length <= 14) return addr
  return `${addr.slice(0, 10)}…${addr.slice(-7)}`
}
function fmtEth(n) {
  if (n == null) return '0'
  const num = Number(n)
  if (num === 0) return '0'
  // Keep 5 sig figs for the small numbers that matter (0.00150),
  // but trim trailing zeros so 0.01700 stays readable as 0.01700.
  if (num >= 1) return num.toFixed(3)
  return num.toFixed(5)
}
function smaBalancePillClass(status) {
  return status === 'low' ? styles.gasPillLow : styles.gasPillFunded
}
function mapKind(source) {
  if (source.startsWith('tx.submit-live-blocked')) return 'permission'
  if (source.startsWith('tx.submit-live')) return 'run'
  if (source === 'manager-recommendation') return 'recommendation'
  if (source === 'fork.rehearsal') return 'rehearsal'
  if (source === 'operation.prepare') return 'prepared'
  if (source === 'sail.audit.v1') return 'audit'
  if (source.startsWith('session')) return 'permission'
  return 'audit'
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
function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.4 8a5.4 5.4 0 1 1-1.5-3.8" />
      <path d="M13.6 2.4V5h-2.6" />
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
/* Circular-arrows glyph for the Rotate-signer action. */
function RotateGlyph() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11.5 6a4.5 4.5 0 1 0-1.2 3.4" />
      <path d="M11.6 2.8V6H8.4" />
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
function DotSm() {
  return (
    <svg viewBox="0 0 14 14" width="8" height="8" aria-hidden>
      <circle cx="7" cy="7" r="3.2" fill="currentColor" />
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
function FuelGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="2.5" width="6" height="11" rx="1.2" />
      <path d="M3 6.6h6" />
      <path d="M9 5.5l2.4 1.6v4a1 1 0 001 1h.6a1 1 0 001-1V8.4l-1.8-2.1" />
      <path d="M11.4 4.2v1.5" />
    </svg>
  )
}
function EthGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden>
      <path d="M8 1.4L3.4 8 8 10.6 12.6 8z" opacity="0.85" />
      <path d="M8 11.6L3.4 9 8 14.6 12.6 9z" opacity="0.55" />
    </svg>
  )
}
function ChevronDown() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 5l4 4 4-4" />
    </svg>
  )
}
function PencilGlyph() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.2 2.6l2.2 2.2-7 7-2.5.3.3-2.5z" />
      <path d="M8.4 3.4l2.2 2.2" />
    </svg>
  )
}
function ChainGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 9.5l-2 2a2.5 2.5 0 003.5 3.5l2-2" />
      <path d="M9 6.5l2-2a2.5 2.5 0 00-3.5-3.5l-2 2" />
      <path d="M6.4 9.6l3.2-3.2" />
    </svg>
  )
}

