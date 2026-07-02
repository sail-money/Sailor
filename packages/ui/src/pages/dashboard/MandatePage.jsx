import { useEffect, useMemo, useState } from 'react'
import {
  BrandMark,
  HorizonBackground,
  MandateStatus,
  Sai,
  SailButton,
} from '../shared'
import ConfirmDestructiveModal from '../shared/ConfirmDestructiveModal'
import shared from '../shared/shared.module.css'
import layout from './SharedLayout.module.css'
import styles from './MandatePage.module.css'
import { useSailorAccount, useSailorMandate } from '../../hooks/useSailorData'
import { useAccount } from 'wagmi'
import { getSailDeployment } from '@sail/sdk/deployments'
import { explorerTxUrl, explorerAddressUrl, explorerCodeUrl } from '../../lib/explorer'
import SessionControlModal from './SessionControlModal'

// SailKernel protocol constants (from SailProtocol source)
const GOVERNANCE = {
  maxPermissionsPerAccount: 10,
  permissionRegistrationFeeEth: '0.001',
  permissionGasCapK: 100,
  protocolCutBps: 0,
  MAX_PROTOCOL_CUT_BPS: 1000,
}
import ContractModal from './ContractModal'
import AIHandoffModal from './AIHandoffModal'

/**
 * Mandate detail page — the canonical home for everything contract-
 * shaped. One signed mandate per SMA; many agents (agent wallets)
 * run under it.
 *
 * Hierarchy:
 *   Top — identity (mandate title, status, signed metadata)
 *   1. Contract summary (plain-language recital, key terms)
 *   2. Permissions (✓ allowed / ✗ disallowed, with selectors)
 *   3. Receipt & signatures
 *   4. Agents under this mandate (cards → AgentPage)
 *   Bottom — Revoke mandate (triggers contract animation)
 *
 * Important: there is no per-permission revoke here. The mandate is an
 * atomic signed contract. Revoking it cancels all permissions and all
 * agents at once. Individual agents can be Stopped/Resumed via their
 * own AgentPage — that's a separate, reversible action.
 */
/* ─────────── Capabilities at a glance (F11) ───────────
   Renders the mandate's permissions as a plain-language "can do" list beside a
   fixed "cannot do" list. The cannot side states the protocol's deny-by-default
   guarantees — the trust-building half a flat permission list doesn't surface. */
function CapabilitiesGlance({ mandate }) {
  const active = (mandate?.permissionsAllowed ?? []).filter((p) => !p.revoked)
  const CANNOT = [
    'Move funds to any address outside the mandate’s allowlists',
    'Exceed the per-transaction caps or slippage bounds set below',
    'Trade tokens or call contracts that aren’t explicitly permitted',
    'Act at all while the session is paused or the mandate is revoked',
  ]
  const colStyle = { display: 'flex', flexDirection: 'column', gap: 8 }
  const itemStyle = { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, lineHeight: 1.45 }
  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <div className={styles.cardHeadText}>
          <h2 className={styles.cardTitle}>What this agent can — and cannot — do</h2>
          <p className={styles.cardSub}>
            A plain-language summary. The “cannot” side is enforced by the protocol’s
            deny-by-default model: anything not permitted below is impossible, not merely discouraged.
          </p>
        </div>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
        <div style={colStyle}>
          <span style={{ fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase', color: 'rgba(120,220,160,0.95)' }}>Can do</span>
          {active.length === 0 ? (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: 0 }}>No active permissions.</p>
          ) : (
            active.map((p) => (
              <div key={p.id} style={itemStyle}>
                <span aria-hidden style={{ color: 'rgba(120,220,160,0.95)' }}>✓</span>
                <span>
                  <span style={{ color: 'rgba(255,255,255,0.92)' }}>{p.label}</span>
                  {p.sub && <span style={{ color: 'rgba(255,255,255,0.5)' }}> — {p.sub}</span>}
                </span>
              </div>
            ))
          )}
        </div>
        <div style={colStyle}>
          <span style={{ fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase', color: 'rgba(255,180,120,0.95)' }}>Cannot do</span>
          {CANNOT.map((line) => (
            <div key={line} style={itemStyle}>
              <span aria-hidden style={{ color: 'rgba(255,180,120,0.95)' }}>✗</span>
              <span style={{ color: 'rgba(255,255,255,0.82)' }}>{line}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default function MandatePage({ mandateId, onBack, onRevoke }) {
  // Bumped after a session pause/resume lands so the mandate + account state re-fetch.
  const [refreshTick, setRefreshTick] = useState(0)
  const { mandate: liveMandate } = useSailorMandate(refreshTick)
  const { account } = useSailorAccount(refreshTick)
  const { address: walletAddress } = useAccount()
  const chainId = account?.chainId
  // Resolve the kernel for this chain from the bundled deployment registry (getSailDeployment
  // throws for an unknown chain, so guard it). Needed to submit the session kill switch.
  let kernel = null
  try { kernel = chainId ? getSailDeployment(chainId)?.kernel ?? null : null } catch { kernel = null }
  // Session kill-switch modal: null | 'pause' | 'resume'.
  const [sessionMode, setSessionMode] = useState(null)

  const baseMandate = useMemo(() => {
    if (!liveMandate) return null
    return { id: mandateId ?? 'live', ...liveMandate }
  }, [liveMandate, mandateId])
  // Local revocation state — which individual permissions the user has
  // revoked since the page mounted. The mandate itself stays signed;
  // these are surgical opt-outs of specific lines inside it.
  const [revokedPermIds, setRevokedPermIds] = useState(() => new Set())
  const [permRevokeTarget, setPermRevokeTarget] = useState(null)

  const mandate = useMemo(() => {
    if (!baseMandate) return null
    const perms = baseMandate.permissionsAllowed ?? baseMandate.permissions ?? []
    return {
      ...baseMandate,
      permissionsAllowed: perms.map((p) => ({
        ...p,
        revoked: revokedPermIds.has(p.id) || p.revoked === true,
      })),
    }
  }, [baseMandate, revokedPermIds])

  const sma = account ? { name: 'My SMA', address: account.safe } : null
  const agents = []

  const [contractOpen, setContractOpen] = useState(false)
  const [expandedPermId, setExpandedPermId] = useState(null)
  const [handoffOpen, setHandoffOpen] = useState(false)

  function confirmPermissionRevoke() {
    if (!permRevokeTarget) return
    setRevokedPermIds((prev) => {
      const next = new Set(prev)
      next.add(permRevokeTarget.id)
      return next
    })
    setPermRevokeTarget(null)
  }

  const activePermissionCount = mandate?.permissionsAllowed?.filter((p) => !p.revoked).length ?? 0
  const revokedPermissionCount = (mandate?.permissionsAllowed?.length ?? 0) - activePermissionCount

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [mandateId])

  if (!mandate) {
    return (
      <div className={`${shared.pageShell} ${styles.shell}`}>
        <HorizonBackground />
        <main className={styles.notFound}>
          <Sai size={48} />
          <h1 className={styles.notFoundTitle}>Mandate not found</h1>
          <p className={styles.notFoundBody}>The URL points to a mandate that doesn’t exist.</p>
          <SailButton onClick={onBack}>Back to dashboard</SailButton>
        </main>
      </div>
    )
  }

  const isActive = mandate.status === 'active'
  const isRevoked = mandate.status === 'revoked'
  // On-chain session kill switch: sessionActive === false means dispatch is halted.
  const sessionPaused = mandate.sessionActive === false

  return (
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <HorizonBackground />

      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={onBack}
          aria-label="Back to dashboard"
        >
          <ChevronLeft />
          <span>Dashboard</span>
        </button>
      </header>

      <main className={styles.main}>

        {/* ── Title block ─────────────────────────────────────── */}
        <section className={styles.titleBlock}>
          <div className={styles.titleHeadRow}>
            <h1 className={styles.title}>{mandate.title}</h1>
            <MandateStatus status={mandate.status} />
          </div>
          <p className={styles.titleMeta}>
            Signed for <strong>{sma.name}</strong> · {mandate.signedAt}
            <span className={styles.titleMetaSep} aria-hidden>·</span>
            {agents.length} agent wallet{agents.length === 1 ? '' : 's'} running under it
          </p>
        </section>

        {/* ── Mandate summary (draft) ──────────────────────────
            The plain-language recital from the drafter. Lives at the
            top of the page because this IS the mandate as the user
            understood it when they authorized it — everything below
            is the protocol-precise realization of this draft. */}
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <div className={styles.cardHeadText}>
              <h2 className={styles.cardTitle}>
                <DocGlyph />
                Mandate summary
              </h2>
              <p className={styles.cardSub}>
                The plain-language recital you signed when authorizing this mandate.
              </p>
            </div>
            <button
              type="button"
              className={styles.viewContractBtn}
              onClick={() => setContractOpen(true)}
            >
              View mandate detail
              <ArrowOutIcon />
            </button>
          </header>

          <blockquote className={styles.recital}>
            <span className={styles.recitalMark} aria-hidden>“</span>
            <p className={styles.recitalBody}>{mandate.summary}</p>
            <footer className={styles.recitalFoot}>
              <BrandMark name={mandate.aiName} size={14} />
              <span>Drafted by {mandate.aiName} · first registered {mandate.signedAt}</span>
            </footer>
          </blockquote>
        </section>

        {/* ── Capabilities at a glance (F11) ───────────────────
            A plain-language "can / cannot" summary above the detailed
            permission list. The deny side is what builds trust: the
            protocol enforces it by deny-by-default. */}
        <CapabilitiesGlance mandate={mandate} />

        {/* ── Permissions ──────────────────────────────────────
            Comes right after the draft because permissions ARE the
            mandate's substance — what the agents below can actually
            do. The numeric metadata (slot count, policy hash, NAV) is
            interpretation; this is the content. */}
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <div className={styles.cardHeadText}>
              <h2 className={styles.cardTitle}>
                <ListGlyph />
                Permissions
              </h2>
              <p className={styles.cardSub}>
                What the agents under this mandate are authorized to do.
                Anything not listed below is forbidden by the mandate.
              </p>
              {mandate.permissionsCap && (
                <span className={styles.permSlotPill}>
                  <span className={styles.permSlotPillStrong}>
                    {activePermissionCount} of {mandate.permissionsCap}
                  </span>
                  <span>slots active</span>
                  {revokedPermissionCount > 0 && (
                    <>
                      <span className={styles.permSlotPillDot} aria-hidden>·</span>
                      <span className={styles.permSlotPillRevoked}>
                        {revokedPermissionCount} revoked
                      </span>
                    </>
                  )}
                  <span className={styles.permSlotPillDot} aria-hidden>·</span>
                  <span>{mandate.registrationFeeEth} ETH each at registration</span>
                </span>
              )}
            </div>
            <span className={styles.cardHeadMeta}>
              {activePermissionCount} active
            </span>
          </header>

          <ul className={layout.permList}>
            {mandate.permissionsAllowed.map((p) => {
              const isRevoked = !!p.revoked
              const isOpen = expandedPermId === p.id
              return (
                <li
                  key={p.id}
                  className={`${styles.permListItem} ${isOpen ? styles.permListItemOpen : ''}`}
                >
                  <div
                    className={`${layout.permRow} ${isRevoked ? layout.permRowRevoked : layout.permRowAllow} ${isRevoked ? styles.permRowDimmed : ''} ${styles.permRowClickable}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => setExpandedPermId(isOpen ? null : p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setExpandedPermId(isOpen ? null : p.id)
                      }
                    }}
                  >
                    <span className={layout.permMark} aria-hidden>
                      {isRevoked ? <CrossMark /> : <CheckMark />}
                    </span>
                    <span className={layout.permBody}>
                      <span className={layout.permLabel}>{p.label}</span>
                      <span className={layout.permSub}>{p.sub}</span>
                      {(p.template || p.permissionId) && (
                        <span className={styles.permMetaLine}>
                          {p.template && (
                            <span className={styles.permMetaTpl}>{p.template}</span>
                          )}
                          {p.permissionId && (
                            <>
                              <span className={styles.permMetaSep} aria-hidden>·</span>
                              <span className={styles.permMetaId}>{p.permissionId}</span>
                            </>
                          )}
                          {p.version && (
                            <>
                              <span className={styles.permMetaSep} aria-hidden>·</span>
                              <span className={styles.permMetaVer}>v{p.version}</span>
                            </>
                          )}
                          {p.address && (
                            <>
                              <span className={styles.permMetaSep} aria-hidden>·</span>
                              <span className={styles.permMetaAddr}>
                                {p.address.slice(0, 6)}…{p.address.slice(-4)}
                              </span>
                            </>
                          )}
                        </span>
                      )}
                    </span>
                    <span className={styles.permRowTrailing}>
                      {isRevoked ? (
                        <span className={styles.permRevokedBadge}>Revoked</span>
                      ) : (
                        <span className={styles.permTech} title={p.signature}>
                          <code className={styles.permSelector}>{p.selector}</code>
                        </span>
                      )}
                      <span
                        className={`${styles.permExpandChevron} ${isOpen ? styles.permExpandChevronOpen : ''}`}
                        aria-hidden
                      >
                        <ChevronRight />
                      </span>
                    </span>
                  </div>

                  {isOpen && (
                    <div className={styles.permDetail} role="region" aria-label={`${p.label} details`}>
                      {p.description && (
                        <p className={styles.permDescription}>{p.description}</p>
                      )}

                      <dl className={styles.permFieldGrid}>
                        <PermField k="Function signature" v={p.signature}     mono dim />
                        <PermField k="Selector"           v={p.selector}      mono />
                        <PermField k="Contract address"   v={p.address ? `${p.address.slice(0, 8)}…${p.address.slice(-6)}` : '—'} mono />
                        <PermField k="Registered at"      v={p.registeredAt}  />
                        <PermField
                          k="Registration tx"
                          v={p.registeredTxHash}
                          mono
                          link={explorerTxUrl(chainId, p.registeredTxHash)}
                        />
                      </dl>

                      <div className={styles.permDetailActions}>
                        <a
                          href={explorerCodeUrl(chainId, p.address) ?? explorerAddressUrl(chainId, p.address)}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.permActionGhost}
                          onClick={(e) => e.stopPropagation()}
                        >
                          View code on scanner
                          <ArrowOutIcon />
                        </a>
                        {!isRevoked && isActive && (
                          <button
                            type="button"
                            className={styles.permActionDanger}
                            onClick={(e) => { e.stopPropagation(); setPermRevokeTarget(p) }}
                          >
                            Revoke permission
                          </button>
                        )}
                        {isRevoked && (
                          <span className={styles.permRevokedNote}>
                            This permission was revoked. The rest of the mandate remains signed and active.
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {/* ── At-a-glance metrics ──────────────────────────────
            Three load-bearing facts the user should always see:
              · the mandate state (the kill switch — sessionActive in protocol)
              · how many permission slots are in use against the cap
              · the policy-hash fingerprint
            Compact glass cards, each with a kicker + headline + a
            short explainer. Same visual rhythm as the existing
            summary card so the page reads as one composition. */}
        <section className={styles.metricsRow} aria-label="Mandate status at a glance">
          <article className={styles.metricCard}>
            <span className={styles.metricKicker}>Mandate</span>
            <span className={`${styles.metricValue} ${mandate.sessionActive === false ? styles.metricValueDanger : ''}`}>
              {mandate.sessionActive === false ? 'Revoked' : 'Active'}
            </span>
            <p className={styles.metricSub}>
              Kill switch for the whole mandate. Setting it off halts <em>all</em> dispatch but
              leaves permissions registered — you can re-activate without re-signing anything.
            </p>
            <span className={`${styles.metricPill} ${mandate.sessionActive === false ? styles.metricPillDanger : styles.metricPillSuccess}`}>
              <span className={styles.metricPillDot} aria-hidden />
              {mandate.sessionActive === false ? 'Dispatch halted' : 'Dispatch allowed'}
            </span>
          </article>

          <article className={styles.metricCard}>
            <span className={styles.metricKicker}>Permission slots</span>
            <span className={styles.metricValue}>
              {activePermissionCount}
              <span className={styles.metricValueDim}> / {mandate.permissionsCap ?? GOVERNANCE.maxPermissionsPerAccount}</span>
            </span>
            <div className={styles.metricBar} aria-hidden>
              <div
                className={styles.metricBarFill}
                style={{ width: `${Math.min(100, (activePermissionCount / (mandate.permissionsCap ?? GOVERNANCE.maxPermissionsPerAccount)) * 100)}%` }}
              />
            </div>
            <p className={styles.metricSub}>
              Per-account ceiling set by governance. Registration fee:{' '}
              <strong>{mandate.registrationFeeEth ?? GOVERNANCE.permissionRegistrationFeeEth} ETH</strong> per permission.
            </p>
          </article>

          <article className={styles.metricCard}>
            <span className={styles.metricKicker}>Policy hash</span>
            <span className={`${styles.metricValue} ${styles.metricValueMono}`}>
              {mandate.policyHash}
            </span>
            <p className={styles.metricSub}>
              Composite fingerprint of all registered permission templates. Any drift
              from this hash invalidates the mandate's enforcement guarantees.
            </p>
            <span className={styles.metricFootnote}>
              Block <strong>{mandate.blockNumber.toLocaleString()}</strong> · {mandate.signedAt}
            </span>
          </article>
        </section>

        {/* ── Agent endpoint ────────────────────────────────────
            The actual runtime decision source for every agent under
            this mandate. Drafted by Claude (etc.), but the runtime
            choices come from this signed endpoint — not the AI that
            wrote the policy. Pinned URL + publicKey; the runner
            verifies every recommendation before dispatch. */}
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <div className={styles.cardHeadText}>
              <h2 className={styles.cardTitle}>
                <ManagerGlyph />
                Agent endpoint
              </h2>
              <p className={styles.cardSub}>
                Where dispatch decisions come from. Every recommendation is
                signed by this endpoint and verified before your runner sends it
                onchain. Drafters (Claude, Cursor, etc.) write the policy — this
                endpoint runs it.
              </p>
            </div>
            <span className={`${styles.attestationPill} ${styles.attestationPillSuccess}`}>
              <span className={styles.attestationDot} aria-hidden />
              Verified · pinned
            </span>
          </header>

          <dl className={styles.bookGrid}>
            <BookRow k="URL" v={account?.manager ?? "—"} mono />
            <BookRow k="Public key" v={`${account?.manager?.slice(0, 10)}…${account?.manager?.slice(-6) ?? "—"}`} mono />
            <BookRow k="Last seen" v={"—"} />
            <BookRow
              k="Recommendations verified"
              v={
                <>
                  {"—"}
                  {false && (
                    <span className={styles.endpointFailCount}> · {mockManagerEndpoint.signaturesFailed} failed</span>
                  )}
                </>
              }
            />
          </dl>
        </section>

        {/* ── SMA registration ─────────────────────────────────
            The SMA-registration event is the one truly singular thing
            on this page: it created the account, locked in the
            permission-signer + manager + fee-policy roles, and
            anchored custody in the Safe. Each individual permission
            was added later, with its own signed message — those tx
            hashes live on the expanded permission detail above.

            Renamed from "Receipt & signatures" because that phrase
            implied a single mandate-signing event. There isn't one. */}
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <div className={styles.cardHeadText}>
              <h2 className={styles.cardTitle}>
                <SealGlyph />
                SMA registration
              </h2>
              <p className={styles.cardSub}>
                The onchain record that created this account and locked in
                its signing roles. Each permission above was added later
                with its own signed message — see the expanded detail of
                any permission for its registration receipt.
              </p>
            </div>
          </header>

          <dl className={styles.receiptGrid}>
            <ReceiptRow k="Permission signer" v={truncate(mandate.signedBy)} mono />
            <ReceiptRow k="Manager"           v={truncate(sma.address ?? '')} mono />
            <ReceiptRow k="Fee policy"        v={mandate.feePolicyKind ?? 'StandardFeePolicy'} mono />
            <ReceiptRow k="Policy hash"       v={mandate.policyHash} mono />
            <ReceiptRow k="Block"             v={mandate.blockNumber != null ? mandate.blockNumber.toLocaleString() : '—'} />
            <ReceiptRow k="Tx hash"           v={
              <a
                href={explorerTxUrl(chainId, mandate.txHash)}
                target="_blank"
                rel="noreferrer"
                className={styles.receiptLink}
              >
                {truncateTx(mandate.txHash)}
                <ArrowOutIcon />
              </a>
            } />
            <ReceiptRow k="Registered"        v={mandate.signedAt} />
            <ReceiptRow k="Custody"           v="Held by the SMA Safe" />
            <ReceiptRow
              k="Permission slots"
              v={
                revokedPermissionCount > 0
                  ? `${activePermissionCount} active · ${revokedPermissionCount} revoked · ${mandate.permissionsCap ?? 20} cap`
                  : `${activePermissionCount} of ${mandate.permissionsCap ?? 20}`
              }
            />
          </dl>
        </section>

        {/* ── Agents under this mandate ───────────────────────── */}
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <div className={styles.cardHeadText}>
              <h2 className={styles.cardTitle}>
                <RobotGlyph />
                Agents running under this mandate
              </h2>
              <p className={styles.cardSub}>
                Agent wallets operating within the permissions above. Each can be stopped individually without revoking the mandate.
              </p>
            </div>
            <span className={styles.cardHeadMeta}>
              {agents.filter((a) => a.status === 'active').length} active · {agents.length} total
            </span>
          </header>

          <ul className={styles.agentList}>
            {agents.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={styles.agentRow}
                  onClick={() => { window.location.hash = `#/agent/${a.id}` }}
                >
                  <span
                    className={`${styles.agentDot} ${a.status === 'active' ? styles.agentDotActive : styles.agentDotIdle}`}
                    aria-hidden
                  />
                  <BrandMark name={a.aiName} size={20} />
                  <span className={styles.agentBody}>
                    <span className={styles.agentName}>{a.role ?? a.title}</span>
                    <span className={styles.agentSub}>{a.title}</span>
                  </span>
                  <MandateStatus status={a.status} kind="agent" />
                  <span className={styles.agentChevron} aria-hidden><ChevronRight /></span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* ── About this mandate ──────────────────────────────────
            The protocol-level mental model in four sentences. Lives
            below the agent list (which is local context) and above the
            destructive revoke surface so anyone reaching for the
            revoke lever passes this explainer first. */}
        <section className={`${styles.card} ${styles.aboutCard}`}>
          <header className={styles.cardHead}>
            <div className={styles.cardHeadText}>
              <h2 className={styles.cardTitle}>
                <InfoGlyph />
                About this mandate
              </h2>
              <p className={styles.cardSub}>
                The protocol-level guarantees this mandate gives you.
              </p>
            </div>
          </header>

          <ul className={styles.aboutList}>
            <li>
              <strong>Per-permission revocation is supported.</strong> Each permission was
              added with its own signed message, so you can surgically revoke one line
              without touching the rest of the mandate.
            </li>
            <li>
              <strong>Selective dispatch.</strong> At call time the manager <em>names</em>{' '}
              which permission authorizes the call. There is no AND-across-permissions
              enforcement — the named permission either accepts the call or the call reverts.
            </li>
            <li>
              <strong>Fail-closed evaluation.</strong> The kernel reads each permission's{' '}
              <code className={styles.aboutMono}>evaluate(...)</code> via a static call under a{' '}
              <strong>{GOVERNANCE.permissionGasCapK}k gas cap</strong>. Revert or gas exhaustion blocks the dispatch.
            </li>
            <li>
              <strong>Bounded protocol fee.</strong> Sail's protocol cut is currently{' '}
              <strong>{GOVERNANCE.protocolCutBps} bps</strong> on manager-collected fees, capped immutably at{' '}
              <strong>{GOVERNANCE.MAX_PROTOCOL_CUT_BPS} bps</strong> in the kernel source.
            </li>
          </ul>
        </section>

        {/* ── Redraft mandate (non-destructive) ────────────────────
            Opens the AI handoff so the user can describe a new version
            of the mandate. Nothing changes onchain until the user signs
            the replacement registrations. The current mandate keeps
            firing in the meantime. Lives here on the Mandate page
            because redrafting changes the bundle of permissions, not
            any individual agent. */}
        <section className={`${styles.card} ${styles.redraftCard}`}>
          <header className={styles.cardHead}>
            <div className={styles.cardHeadText}>
              <span className={styles.redraftKicker}>Editable · reversible</span>
              <h2 className={styles.cardTitle}>Redraft this mandate</h2>
              <p className={styles.cardSub}>
                Opens {mandate.aiName} to draft a new version of this mandate.
                Nothing changes onchain until you sign the replacement.
                The current mandate keeps running in the meantime.
              </p>
            </div>
            <button
              type="button"
              className={`${styles.editBtn} ${styles[`editBtn_${mandate.aiName?.toLowerCase()}`] ?? ''}`}
              onClick={() => setHandoffOpen(true)}
              disabled={!isActive}
            >
              Edit with {mandate.aiName}
            </button>
          </header>
        </section>

        {/* ── Kill switch (destructive) ────────────────────────────
            Maps to the protocol's revokeSession primitive — flips
            sessionActive=false. We surface it as "Revoke mandate" for
            retail clarity: the mandate is the bundle the user signed,
            and revoking it stops all dispatch immediately. It is
            reversible — permissions stay registered, just dormant —
            so re-activation needs no new signatures. Exempt from
            governance pause: this lever always works. */}
        <section className={`${styles.card} ${styles.dangerCard}`}>
          <header className={styles.cardHead}>
            <div className={styles.cardHeadText}>
              <span className={styles.dangerKicker}>Reversible · halts all dispatch</span>
              <h2 className={styles.cardTitle}>{sessionPaused ? 'Resume session' : 'Pause session'}</h2>
              <p className={styles.cardSub}>
                The kill switch for this mandate. Pausing halts <em>all</em> agent dispatch
                immediately — permissions stay registered, so you can resume at any time without
                re-signing anything. Any transaction the agent pre-signed is invalidated. Always
                exempt from protocol pause.
              </p>
            </div>
            <button
              type="button"
              className={styles.revokeBtn}
              onClick={() => setSessionMode(sessionPaused ? 'resume' : 'pause')}
              disabled={!kernel || !sma}
            >
              {sessionPaused ? 'Resume session' : 'Pause session'}
            </button>
          </header>
        </section>
      </main>

      {/* Read-only contract preview — opened from "View signed contract". */}
      <ContractModal
        open={contractOpen}
        mandate={mandate}
        readOnly
        signedDate={mandate.signedAt}
        onClose={() => setContractOpen(false)}
      />

      {/* Session kill switch — pause (revokeSession) / resume (activateSession) on-chain.
          The owner signs the RevokeSession/ActivateSession digest and submits the tx. */}
      <SessionControlModal
        open={!!sessionMode}
        mode={sessionMode}
        sma={sma?.address}
        kernel={kernel}
        chainId={chainId}
        onClose={() => setSessionMode(null)}
        onDone={() => {
          setSessionMode(null)
          setRefreshTick((t) => t + 1)
        }}
      />

      {/* Redraft handoff — opens the user's AI to draft a replacement
          mandate. Reversible until signed. */}
      <AIHandoffModal
        open={handoffOpen}
        variant="redraft"
        mandate={mandate}
        onClose={() => setHandoffOpen(false)}
      />

      {/* Per-permission revoke — surgical opt-out of one line without
          touching the rest of the signed mandate. */}
      <ConfirmDestructiveModal
        open={!!permRevokeTarget}
        title="Revoke this permission?"
        body={
          permRevokeTarget
            ? `Agents under this mandate will lose authority to call "${permRevokeTarget.label}". The rest of the mandate stays signed and active. This action is not reversible.`
            : ''
        }
        confirmLabel="Revoke permission"
        cancelLabel="Keep permission"
        onCancel={() => setPermRevokeTarget(null)}
        onConfirm={confirmPermissionRevoke}
      />
    </div>
  )
}

/* ────────── Small helpers ────────── */
function ReceiptRow({ k, v, mono }) {
  return (
    <div className={styles.receiptRow}>
      <dt>{k}</dt>
      <dd className={mono ? styles.mono : ''}>{v}</dd>
    </div>
  )
}

/* Bookkeeping row — pairs label with a value, with optional accent
   styling for the headline NAV figure and mono treatment for codes. */
function BookRow({ k, v, mono, accent }) {
  return (
    <div className={`${styles.bookRow} ${accent ? styles.bookRowAccent : ''}`}>
      <dt>{k}</dt>
      <dd className={mono ? styles.mono : ''}>{v}</dd>
    </div>
  )
}

/* Field in the expanded permission detail grid. Same look-and-feel as
   the Receipt grid above but tighter — used for the 12 fields per
   permission. Optional `link` wraps the value in an external link with
   an out-arrow glyph. */
function PermField({ k, v, mono, dim, link }) {
  let value = v ?? '—'
  if (link && v) {
    value = (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className={styles.permFieldLink}
        onClick={(e) => e.stopPropagation()}
      >
        {v}
        <ArrowOutIcon />
      </a>
    )
  }
  return (
    <div className={styles.permFieldRow}>
      <dt>{k}</dt>
      <dd className={`${mono ? styles.permFieldValueMono : ''} ${dim ? styles.permFieldValueDim : ''}`}>
        {value}
      </dd>
    </div>
  )
}
function truncate(addr) {
  if (!addr) return ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
function truncateTx(h) {
  if (!h) return ''
  return `${h.slice(0, 10)}…${h.slice(-6)}`
}

/* ────────── Icons ────────── */
function ChevronLeft() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3l-4 4 4 4" />
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
function ArrowOutIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 9 L9 5" />
      <path d="M5.4 5 H9 V8.6" />
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
function CrossMark() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 4l8 8M12 4L4 12" />
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
function ListGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 4h8M5 8h8M5 12h8" />
      <circle cx="2.5" cy="4" r="0.7" fill="currentColor" />
      <circle cx="2.5" cy="8" r="0.7" fill="currentColor" />
      <circle cx="2.5" cy="12" r="0.7" fill="currentColor" />
    </svg>
  )
}
function SealGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="7" r="4" />
      <path d="M6 10.5L5.2 13.4l2.8-1.6 2.8 1.6L10 10.5" />
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
function CustodyGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="6.5" width="9" height="6.5" rx="1.2" />
      <path d="M5.5 6.5V4.8a2.5 2.5 0 015 0v1.7" />
      <circle cx="8" cy="9.6" r="0.9" fill="currentColor" />
    </svg>
  )
}
function InfoGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.6" />
      <circle cx="8" cy="5.2" r="0.5" fill="currentColor" />
    </svg>
  )
}
function ManagerGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6.5l5.5-3 5.5 3-5.5 3-5.5-3z" />
      <path d="M2.5 9.5l5.5 3 5.5-3" />
      <path d="M2.5 12.5l5.5 3 5.5-3" opacity="0.55" />
    </svg>
  )
}
function CoinGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M6.5 6.5h2.4a1.3 1.3 0 010 2.6H6.5" />
      <path d="M6.5 9.1h2.4a1.3 1.3 0 010 2.6H6.5" />
      <path d="M7.6 5.4v5.6" />
    </svg>
  )
}
