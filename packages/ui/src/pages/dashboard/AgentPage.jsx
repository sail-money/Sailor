import { useEffect, useMemo, useState } from 'react'
import {
  BrandMark,
  FluidBackground,
  MandateStatus,
  Sai,
  SailButton,
} from '../shared'
import shared from '../shared/shared.module.css'
import styles from './AgentPage.module.css'
import { useSailorAccount, useSailorMandate } from '../../hooks/useSailorData'
import { useAccount } from 'wagmi'
import ContractModal from './ContractModal'

/**
 * Dedicated rich page for a single agent.
 *
 * Layout: title block on top, then a two-column body. The sidebar carries
 * everything that defines *who* this agent is — current health, account
 * chain (EOA → SMA → Agent wallet), schedule, networks, identity, gas,
 * and the action stack (Edit / Pause / Revoke). The main column carries
 * *what* this agent does — the mandate explainer + fingerprint,
 * permissions, activity, runs, custom pages, and the original
 * recommendation.
 */
export default function AgentPage({ agentId, onBack, onEdit, onRevoke }) {
  const { mandate: liveMandate } = useSailorMandate()
  const { account } = useSailorAccount()
  const { address: mockWallet } = useAccount()
  const mockSafe = account?.safe ?? null
  const mockSafes = account ? [{ name: 'My SMA', address: account.safe }] : []

  const mandate = liveMandate ?? null
  const view = useMemo(() => buildAgentView(mandate), [mandate])
  const agentPermissions = (liveMandate?.permissions ?? []).map((p) => ({ ...p, usedByThisAgent: true }))
  const [schedules, setSchedules] = useState([])

  function toggleSchedule(scheduleId) {
    setSchedules((arr) =>
      arr.map((s) => (s.id === scheduleId ? { ...s, enabled: !s.enabled } : s)),
    )
  }

  // Dry-run rehearsal freshness — locally-resettable. Per the framework,
  // the rehearsal is a ForkRehearsalRecord that must be ≤ 24h old for the
  // live-ready gate. Clicking the dry-run pill mocks `sail schedule run
  // --mode fork` (resets the hours-ago to 0).
  const initialRehearsalHours = mandate?.lastRehearsalHoursAgo ?? 3
  const [rehearsalHoursAgo, setRehearsalHoursAgo] = useState(initialRehearsalHours)
  const [rehearsing, setRehearsing] = useState(false)
  useEffect(() => { setRehearsalHoursAgo(initialRehearsalHours) }, [initialRehearsalHours])

  function runDryRun() {
    if (rehearsing) return
    setRehearsing(true)
    setTimeout(() => {
      setRehearsalHoursAgo(0)
      setRehearsing(false)
    }, 900)
  }

  const [runId, setRunId] = useState(null)
  const [paused, setPaused] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [contractOpen, setContractOpen] = useState(false)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [agentId])

  if (!mandate) {
    return (
      <div className={`${shared.pageShell} ${styles.shell}`}>
        <FluidBackground />
        <main className={styles.notFound}>
          <Sai size={48} />
          <h1 className={styles.notFoundTitle}>Agent not found</h1>
          <p className={styles.notFoundBody}>The URL points to an agent that doesn’t exist.</p>
          <SailButton onClick={onBack}>Back to agents</SailButton>
        </main>
      </div>
    )
  }

  const isActive = mandate.status === 'active'
  const effective = paused ? 'paused' : mandate.status
  const selectedRun = runId ? view.runs.find((r) => r.id === runId) : null
  const health = deriveHealth(effective)
  const lastCheck = deriveLastCheck(mandate)
  const nextCheck = deriveNextCheck(mandate, effective)
  const endsCell = deriveEnds(mandate)

  return (
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <FluidBackground />

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

        {/* Sibling-page shortcut — agents always operate UNDER a mandate.
            The link names the specific mandate so the relationship is
            visible without leaving the page. */}
        {parentMandate && (
          <a
            href={`#/mandate/${parentMandate.id}`}
            className={styles.mandateLinkPill}
          >
            <DocBadgeIcon />
            <span>Operating under: {parentMandate.title}</span>
            <ChevronRightInline />
          </a>
        )}
      </header>

      <main className={styles.main}>
        {/* Title block. Role is the primary identity; the mandate
            scope ("$500 USDC yield on Arbitrum") becomes secondary.
            The readiness sentence + drafter≠runtime disclosure sit
            beneath the title so the user immediately knows whether
            this agent is firing and where its decisions come from. */}
        <section className={styles.titleBlock}>
          <div className={styles.identityRow}>
            <BrandMark name={mandate.aiName} size={22} />
            <span className={styles.identityName}>Created in {mandate.aiName}</span>
            <span className={styles.identityDot} aria-hidden>·</span>
            <MandateStatus status={effective} kind="agent" />
            <ChainChips networks={mandate.networks} />
          </div>
          <h1 className={`${shared.displayHeadline} ${styles.title}`}>
            {mandate.role ?? mandate.title}
          </h1>
          {mandate.role && (
            <p className={styles.titleScope}>{mandate.title}</p>
          )}
          {/* Canonical agent identity per the framework: slug + numeric
              registry id (deterministic-hashed from slug at create time).
              The same identity is shared across drafters — Claude or
              Cursor opens the same agentId from the project files. */}
          {view.agentId != null && (
            <p className={styles.identityFootnote}>
              <code>{mandate.id}</code>
              <span className={styles.identityDot} aria-hidden>·</span>
              <span>agentId <code>{view.agentId.toLocaleString()}</code></span>
            </p>
          )}

          {/* Readiness sentence + runtime-source disclosure */}
          <AgentReadinessLine
            status={effective}
            mandate={mandate}
            hasMpcWallet={!!view.mpcWallet?.address}
            lastRehearsalHoursAgo={rehearsalHoursAgo}
            rehearsing={rehearsing}
            onRehearse={runDryRun}
            managerEndpoint={mockManagerEndpoint}
          />
        </section>

        <div className={styles.body}>
          {/* "Your brief" sits at the very top of the body — the origin
              story. The page reads: what you asked for → what was built
              (Agent / Mandate / Permissions) → what it has done. */}
          <Section
            title="Your brief"
            kicker="What you asked for"
            hint={`A summary of everything you told ${mandate.aiName} across your conversation — your goal, plus any follow-up details ${mandate.aiName} asked for while drafting this mandate. The mandate itself is ${mandate.aiName}'s interpretation of this brief into onchain rules.`}
          >
            <blockquote className={styles.recoQuote}>
              <span className={styles.recoMark} aria-hidden>“</span>
              <p className={styles.recoBody}>{view.recommendation.body}</p>
              <footer className={styles.recoFoot}>
                <BrandMark name={mandate.aiName} size={16} />
                <span>Interpreted by {mandate.aiName} · {view.recommendation.ago}</span>
              </footer>
            </blockquote>
          </Section>

          {/* ── Two focused sections: Agent ▸ Permissions.
              Everything mandate-level (fingerprint, signatures, full
              receipt) lives on the Mandate page. This page is exclusively
              about the agent itself: who it is, what it has done, and
              which specific permissions in its parent mandate it uses. */}
          <div className={styles.tierStack}>

            <TierCard
              tier="1"
              depth={0}
              label="Agent"
              primary={view.erc8004.handle}
              summary={`${truncate(view.mpcWallet.address)} · ${view.runs.length} execution${view.runs.length === 1 ? '' : 's'} · last ${view.activity[0]?.ago ?? '—'}`}
              defaultOpen
            >
              <div className={styles.tierGrid}>
                <SubSection title="Verified handle" kicker="ERC-8004 · optional">
                  <a
                    href={view.erc8004.url}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.identityLink}
                  >
                    <span className={styles.identityHandle}>{view.erc8004.handle}</span>
                    <ArrowOutIcon />
                  </a>
                  <span className={styles.sidebarHint}>
                    Template-layer metadata only — the kernel doesn't read this.
                    The canonical agent identity is the agentId above.
                  </span>
                </SubSection>

                <SubSection title="Gas balance" kicker="Agent wallet">
                  <div className={styles.gasRow}>
                    <span className={styles.gasChain}><NetIcon /> Arbitrum</span>
                    <span className={styles.gasValue}>{view.mpcWallet.gas} ETH</span>
                  </div>
                  {view.mpcWallet.threshold && (
                    <div className={styles.signerShareRow}>
                      <span className={styles.signerShareLabel}>
                        Signed by {view.mpcWallet.threshold.replace('-of-', ' of ')}
                      </span>
                      <span className={styles.signerShareList}>
                        {(view.mpcWallet.keyShares ?? []).map((s) => (
                          <span key={s} className={styles.signerShareChip}>{s}</span>
                        ))}
                      </span>
                    </div>
                  )}
                </SubSection>
              </div>

              {/* Schedules — the cron triggers the runner consumes to fire
                  this agent. Local-only: flipping enabled doesn't touch
                  onchain state, just the runner's firing loop. Mode 'fork'
                  rehearses against a chain fork; 'live' broadcasts onchain. */}
              {schedules.length > 0 && (
                <SubSection
                  title="Schedules"
                  kicker={`${schedules.filter((s) => s.enabled).length} of ${schedules.length} enabled`}
                >
                  <ul className={styles.scheduleList}>
                    {schedules.map((s) => (
                      <li
                        key={s.id}
                        className={`${styles.scheduleRow} ${!s.enabled ? styles.scheduleRowDisabled : ''}`}
                      >
                        <div className={styles.scheduleMain}>
                          <div className={styles.scheduleHeadRow}>
                            <span className={styles.scheduleId}>{s.id}</span>
                            <span className={`${styles.scheduleMode} ${s.mode === 'live' ? styles.scheduleModeLive : styles.scheduleModeFork}`}>
                              {s.mode}
                            </span>
                          </div>
                          <span className={styles.scheduleCron}>
                            {s.cronHuman} · <code>{s.cron}</code>
                          </span>
                        </div>
                        <div className={styles.scheduleRuns}>
                          <span>Last <code>{s.lastRun?.at ?? '—'}</code></span>
                          <span>Next <code>{s.nextRun ?? '—'}</code></span>
                        </div>
                        <button
                          type="button"
                          className={`${styles.scheduleToggle} ${s.enabled ? styles.scheduleToggleOn : ''}`}
                          onClick={() => toggleSchedule(s.id)}
                          aria-pressed={s.enabled}
                          aria-label={`${s.enabled ? 'Disable' : 'Enable'} schedule ${s.id}`}
                        >
                          {s.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </SubSection>
              )}

              {/* Activity — what this agent has been doing. Lives inside
                  the Agent card because it's the agent's own log of
                  events (deposits, simulations, permission checks). */}
              <SubSection title="Activity" kicker="Recent events">
                <ul className={styles.activityList}>
                  {view.activity.map((e) => (
                    <li key={e.id} className={styles.activityRow}>
                      <span
                        className={`${styles.activityDot} ${styles[`actDot_${e.kind}`] ?? ''}`}
                        aria-hidden
                      />
                      <span className={styles.activityLabel}>{e.label}</span>
                      <span className={styles.activityAgo}>{e.ago}</span>
                    </li>
                  ))}
                  {view.activity.length === 0 && (
                    <li className={styles.activityEmpty}>No recent activity.</li>
                  )}
                </ul>
              </SubSection>

              {/* Runs — the agent's executions of its permitted actions.
                  Each row opens a detail drawer. */}
              <SubSection
                title="Runs"
                kicker={`${view.runs.length} execution${view.runs.length === 1 ? '' : 's'}`}
              >
                <ul className={styles.runList}>
                  {view.runs.map((run) => (
                    <li key={run.id}>
                      <button
                        type="button"
                        className={`${styles.runRow} ${run.status === 'failed' ? styles.runFailed : ''}`}
                        onClick={() => setRunId(run.id)}
                      >
                        <span
                          className={`${styles.runStatus} ${styles[`runStatus_${run.status}`]}`}
                          aria-hidden
                        >
                          {run.status === 'success' ? <CheckSm /> : run.status === 'failed' ? <CrossSm /> : <DotSm />}
                        </span>
                        <span className={styles.runId}>{run.id}</span>
                        <span className={styles.runLabel}>{run.label}</span>
                        <span className={styles.runMeta}>
                          <span className={styles.runGas}>{run.gas}</span>
                          <span className={styles.runAgo}>{run.ago}</span>
                        </span>
                        <span className={styles.runChevron} aria-hidden><ChevronRight /></span>
                      </button>
                    </li>
                  ))}
                  {view.runs.length === 0 && (
                    <li className={styles.activityEmpty}>This agent hasn’t executed yet.</li>
                  )}
                </ul>
              </SubSection>
            </TierCard>

            <TierCard
              tier="2"
              depth={1}
              label="Permissions"
              primary={
                parentMandate
                  ? `${usedPermissionIds.size} of ${agentPermissions.filter((p) => !p.revoked).length} active permissions`
                  : 'No mandate'
              }
              summary={
                parentMandate
                  ? `Operating under ${parentMandate.title} · this agent uses the highlighted lines below`
                  : 'This agent is not bound to a signed mandate.'
              }
              defaultOpen
            >
              {parentMandate ? (
                <>
                  <div className={styles.permRelation}>
                    <div className={styles.permRelationText}>
                      <span className={styles.permRelationKicker}>Role</span>
                      <span className={styles.permRelationRole}>
                        {mandate.role ?? mandate.title}
                      </span>
                      <span className={styles.permRelationBody}>
                        Operates as an agent wallet under{' '}
                        <strong>{parentMandate.title}</strong>. The mandate above
                        defines the full permission set; this agent uses the
                        <strong> {usedPermissionIds.size}</strong> highlighted below.
                      </span>
                    </div>
                    <a
                      href={`#/mandate/${parentMandate.id}`}
                      className={styles.permRelationLink}
                    >
                      <span>Open mandate</span>
                      <ChevronRightInline />
                    </a>
                  </div>

                  <SubSection
                    title="Permissions this agent uses"
                    kicker="Inherited from the mandate"
                  >
                    <ul className={styles.agentPermList}>
                      {agentPermissions.map((p) => (
                        <li
                          key={p.id}
                          className={`${styles.agentPermRow} ${p.usedByThisAgent ? styles.agentPermUsed : styles.agentPermUnused} ${p.revoked ? styles.agentPermRevoked : ''}`}
                        >
                          <span className={styles.agentPermMark} aria-hidden>
                            {p.revoked ? <CrossSm /> : p.usedByThisAgent ? <CheckSm /> : <DotSm />}
                          </span>
                          <span className={styles.agentPermBody}>
                            <span className={styles.agentPermLabel}>{p.label}</span>
                            <span className={styles.agentPermSub}>{p.sub}</span>
                            {p.template && (
                              <span className={styles.agentPermMeta}>
                                <span className={styles.agentPermMetaTpl}>{p.template}</span>
                                {p.version && (
                                  <>
                                    <span className={styles.agentPermMetaSep} aria-hidden>·</span>
                                    <span className={styles.agentPermMetaVer}>v{p.version}</span>
                                  </>
                                )}
                              </span>
                            )}
                          </span>
                          <span className={styles.agentPermTag}>
                            {p.revoked
                              ? 'Revoked on mandate'
                              : p.usedByThisAgent
                                ? 'Used by this agent'
                                : 'Available · not used'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </SubSection>

                  <p className={styles.permRelationHint}>
                    To revoke an individual permission, open the parent mandate.
                    Revocation always happens at the mandate level so every agent
                    operating under it loses authority for that line at once.
                  </p>
                </>
              ) : (
                <p className={styles.permRelationEmpty}>
                  This agent is not currently bound to a signed mandate.
                </p>
              )}
            </TierCard>
          </div>

            <Section
              title="Custom pages"
              kicker={`${view.pages.length} created by your AI`}
              note="Ask your AI to build a page for this agent — a dashboard, a watchlist, anything you want."
            >
              {view.pages.length > 0 ? (
                <ul className={styles.pagesList}>
                  {view.pages.map((p) => (
                    <li key={p.id} className={styles.pageRow}>
                      <span className={styles.pageIcon} aria-hidden>{p.icon}</span>
                      <div className={styles.pageBody}>
                        <span className={styles.pageTitle}>{p.title}</span>
                        <span className={styles.pageMeta}>
                          <BrandMark name={p.maker} size={12} />
                          <span>{p.maker} · {p.updated}</span>
                        </span>
                      </div>
                      <a
                        className={styles.pageOpen}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span>Open</span>
                        <ArrowOutIcon />
                      </a>
                    </li>
                  ))}
                  <li className={styles.pageNew}>
                    <span className={styles.pageNewIcon} aria-hidden>+</span>
                    <div className={styles.pageNewBody}>
                      <span className={styles.pageNewTitle}>Ask your AI to build a page</span>
                      <span className={styles.pageNewSub}>
                        Try: “Sailor, build me a yield-history page for this agent.”
                      </span>
                    </div>
                  </li>
                </ul>
              ) : (
                <div className={styles.pagesEmpty}>
                  <span className={styles.pagesEmptyIcon} aria-hidden>+</span>
                  <span className={styles.pagesEmptyTitle}>No custom pages yet</span>
                  <span className={styles.pagesEmptySub}>
                    Ask your AI to design one for this agent — Sail will serve it locally.
                  </span>
                </div>
              )}
            </Section>

            {/* ── Action cards, ordered by severity ───────────────
                The three management actions get their own cards stacked
                from least to most destructive: Edit (non-destructive)
                → Pause (reversible) → Revoke (permanent). Each card's
                tint escalates the severity signal so the user reads the
                cost of each action before clicking. */}

            {/* Redraft (Edit with your AI) lives on the Mandate page now —
                redrafting changes the signed bundle of permissions, not the
                agent. Agents are stopped here; mandates are edited there. */}

            <ActionCard
              tone="warn"
              kicker="Reversible · agent only"
              title={paused ? 'Resume this agent' : 'Stop this agent'}
              description={paused
                ? 'This agent is stopped. Resume to let it dispatch again — no re-signing required.'
                : 'Stops this agent. Other agents under the same mandate keep running. You can resume at any time without re-signing. Agents are never revoked; only mandates and individual permissions are.'}
              action={
                <button
                  type="button"
                  className={`${styles.pauseBtn} ${paused ? styles.pauseBtnPaused : ''}`}
                  onClick={() => setPaused((p) => !p)}
                  disabled={!isActive && !paused}
                >
                  {paused ? 'Resume this agent' : 'Stop this agent'}
                </button>
              }
            />
        </div>
      </main>

      <RunDetailDrawer
        run={selectedRun}
        open={!!selectedRun}
        onClose={() => setRunId(null)}
      />

      <ContractModal
        open={contractOpen}
        mandate={mandate}
        readOnly
        signedDate={view.receipt.signedAt}
        onClose={() => setContractOpen(false)}
      />

      {/* Revocation surface — the signed contract itself becomes the
          confirmation. The user sees what they're revoking; clicking
          the destructive footer button triggers the contract-fade +
          REVOKED stamp animation, which finishes before the agent
          page tears down. */}
      <ContractModal
        open={revokeOpen}
        mode="revoke"
        mandate={mandate}
        signedDate={view.receipt.signedAt}
        onClose={() => setRevokeOpen(false)}
        onRevoke={() => { setRevokeOpen(false); onRevoke?.() }}
      />
    </div>
  )
}

/* ─────────── Section primitives ─────────── */
function Section({ title, kicker, note, hint, headerAction, accent, children }) {
  return (
    <section className={`${styles.section} ${accent ? styles[`sectionAccent_${accent}`] : ''}`}>
      <header className={styles.sectionHead}>
        <div className={styles.sectionHeadText}>
          <span className={styles.sectionKicker}>{kicker}</span>
          <h2 className={styles.sectionTitle}>
            {title}
            {hint && (
              <span
                className={styles.sectionTitleHint}
                title={hint}
                aria-label={hint}
                role="img"
              >i</span>
            )}
          </h2>
          {note && <p className={styles.sectionNote}>{note}</p>}
        </div>
        {headerAction && (
          <div className={styles.sectionHeadAction}>{headerAction}</div>
        )}
      </header>
      {children}
    </section>
  )
}

/* Expandable tier card — Agent / Mandate / Permissions. Each card is
   a self-contained section that collapses to a one-line summary and
   expands to its full detail body. A vertical spine on the left of
   the stack connects all three cards; the chevron on the right rotates
   when open. */
function TierCard({ tier, depth = 0, label, primary, summary, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const headingId = `tier-${tier}-heading`
  const bodyId = `tier-${tier}-body`
  return (
    <section
      className={`${styles.tierCard} ${styles[`tierCardDepth_${depth}`] ?? ''} ${open ? styles.tierCardOpen : ''}`}
      aria-labelledby={headingId}
    >
      {/* L-curve connector — same SVG language as the Ownership
          chain in the sidebar, so the page's two hierarchies
          (Agent → Mandate → Permissions and EOA → SMA → Agent wallet)
          read in the same visual grammar. */}
      {depth > 0 && (
        <span className={styles.tierCardConnector} aria-hidden>
          <TierConnector />
        </span>
      )}
      <button
        type="button"
        className={styles.tierCardHead}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        id={headingId}
      >
        <div className={styles.tierCardHeadText}>
          <span className={styles.tierCardLabel}>{label}</span>
          <span className={styles.tierCardPrimary}>{primary}</span>
          {summary && <span className={styles.tierCardSummary}>{summary}</span>}
        </div>
        <span className={`${styles.tierCardChevron} ${open ? styles.tierCardChevronOpen : ''}`} aria-hidden>
          <ChevronDown />
        </span>
      </button>
      {open && (
        <div className={styles.tierCardBody} id={bodyId} role="region">
          {children}
        </div>
      )}
    </section>
  )
}

/* L-curve connector for nested TierCards. Same path as the
   ownership-chain connector but sized for the larger tier-card
   spacing (24px indent step, ~52px height to bridge the gap). */
function TierConnector() {
  return (
    <svg
      viewBox="0 0 24 52"
      width="24"
      height="52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="tier-conn" x1="0" y1="0" x2="0" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="35%"  stopColor="#FFFFFF" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1990FF" stopOpacity="0.65" />
        </linearGradient>
      </defs>
      <path
        d="M 1.5 0 L 1.5 36 Q 1.5 44 11 44 L 22 44"
        stroke="url(#tier-conn)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="22" cy="44" r="2" fill="#1990FF" fillOpacity="0.75" />
    </svg>
  )
}

/* Action card — single management action with a severity tone.
   Used at the bottom of the page for Edit / Pause / Revoke, ordered
   from least to most destructive. Tone tints the kicker label and
   gives the card a faint accent border so the user reads the cost
   of each action before clicking. */
function ActionCard({ tone, kicker, title, description, action }) {
  return (
    <section className={`${styles.actionCard} ${styles[`actionCard_${tone}`]}`}>
      <div className={styles.actionCardText}>
        <span className={`${styles.actionCardKicker} ${styles[`actionCardKicker_${tone}`]}`}>
          {kicker}
        </span>
        <h3 className={styles.actionCardTitle}>{title}</h3>
        <p className={styles.actionCardDescription}>{description}</p>
      </div>
      <div className={styles.actionCardAction}>{action}</div>
    </section>
  )
}

/* Horizontal status stat used inside the Mandate card's "Current state"
   strip. Four cells side-by-side: Status / Last check / Next check /
   Ends. Color tone is applied to the status dot only — backgrounds
   stay neutral so the strip reads as a calm telemetry row. */
function StatusStat({ label, value, sub, tone, dot }) {
  return (
    <div className={styles.statusCell}>
      <span className={styles.statusCellKicker}>{label}</span>
      <span className={styles.statusCellValue}>
        {dot && (
          <span className={`${styles.statusCellDot} ${styles[`statusDot_${tone}`] ?? ''}`} aria-hidden />
        )}
        {value}
      </span>
      {sub && <span className={styles.statusCellSub}>{sub}</span>}
    </div>
  )
}

function SubSection({ title, kicker, children }) {
  return (
    <section className={styles.subsection}>
      <header className={styles.subsectionHead}>
        <span className={styles.subsectionKicker}>{kicker}</span>
        <h3 className={styles.subsectionTitle}>{title}</h3>
      </header>
      {children}
    </section>
  )
}

function SidebarBlock({ title, kicker, children }) {
  return (
    <section className={styles.sidebarBlock}>
      <header className={styles.sidebarBlockHead}>
        <span className={styles.sidebarKicker}>{kicker}</span>
        <span className={styles.sidebarBlockTitle}>{title}</span>
      </header>
      <div className={styles.sidebarBody}>{children}</div>
    </section>
  )
}

/* StatusRow — a single line in the sidebar's Status card. Two modes:
   - "prominent" with a colored dot + large label (used for health)
   - default with a small uppercase kicker on the left + value + sub */
function StatusRow({ kicker, label, sub, tone, dot, prominent }) {
  return (
    <div className={`${styles.statusRow} ${prominent ? styles.statusRowProminent : ''} ${tone ? styles[`statusTone_${tone}`] : ''}`}>
      {prominent ? (
        <>
          <div className={styles.statusHeadProminent}>
            {dot && <span className={`${styles.statusDot} ${styles[`statusDot_${tone}`] ?? ''}`} aria-hidden />}
            <span className={styles.statusValueLarge}>{label}</span>
          </div>
          {sub && <span className={styles.statusSub}>{sub}</span>}
        </>
      ) : (
        <>
          <div className={styles.statusHead}>
            <span className={styles.statusKicker}>{kicker}</span>
            <span className={styles.statusValue}>{label}</span>
          </div>
          {sub && <span className={styles.statusSub}>{sub}</span>}
        </>
      )}
    </div>
  )
}

/* ─────────── Hierarchy header ───────────
   Five nested tiers — EOA ▸ SMA ▸ Agent ▸ Mandate ▸ Permissions —
   rendered as a single Russian-doll block at the top of the main column.
   Each tier sits one indent step deeper than its parent and carries an
   L-curve connector on its left edge so the nesting is unmistakable.

   Color coding:
     - EOA / SMA / Agent → "identity" tone (cyan family) — ownership chain
     - Mandate          → "mandate" tone (violet) — the binding contract
     - Permissions      → "permissions" tone (brand blue) — the active rules
   Same color language is reused throughout the page on the sections
   tied to each tier, so the eye learns the system. */
function HierarchyHeader({ mandate, view }) {
  const netCount = mandate.networks?.length ?? 0
  const assetCount = mandate.assets?.length ?? 0
  const actionCount = mandate.actions?.length ?? 0
  const smaCount = mockSafes.length
  const sma = mockSafes[0]

  return (
    <section className={styles.hierarchyHeader} aria-label="EOA, SMA, Agent, Mandate, and Permissions hierarchy">
      <HierarchyTier
        depth={0}
        tone="identity"
        label="EOA"
        primary="Owner wallet"
        secondary="Your self-custody externally owned account. Owns every SMA below."
        addressLabel="Address"
        address={mockWallet}
        chips={[
          { label: `${smaCount} ${smaCount === 1 ? 'SMA' : 'SMAs'}` },
          { label: 'Self-custody' },
        ]}
      />
      <HierarchyTier
        depth={1}
        tone="identity"
        label="SMA"
        primary={sma.name}
        secondary="Self-custody smart account on Arbitrum. Holds funds; only the EOA above can change ownership."
        addressLabel="Address"
        address={mockSafe}
        chips={[
          { label: capitalize(sma.network) },
          { label: `${sma.agentCount} agent${sma.agentCount === 1 ? '' : 's'}` },
        ]}
      />
      <HierarchyTier
        depth={2}
        tone="identity"
        label="Agent"
        primary={view.erc8004.handle}
        secondary="ERC-8004 onchain identity. The agent wallet your AI acts through."
        addressLabel="Address"
        address={view.mpcWallet.address}
        active
        chips={[
          { label: 'ERC-8004' },
          { label: `${view.mpcWallet.gas} ETH gas`, mono: true },
        ]}
      />
      <HierarchyTier
        depth={3}
        tone="mandate"
        label="Mandate"
        primary={mandate.title}
        secondary="The signed onchain mandate that bounds what this agent can do."
        chips={[
          { label: mandate.duration },
          { label: `Template ${view.templateHash.slice(0, 10)}…`, mono: true },
          { label: `${netCount} ${netCount === 1 ? 'chain' : 'chains'}` },
        ]}
      />
      <HierarchyTier
        depth={4}
        tone="permissions"
        label="Permissions"
        primary={`${actionCount} ${actionCount === 1 ? 'action' : 'actions'} allowed`}
        secondary="Enforced onchain by Template Logic at every call."
        chips={[
          { label: `${netCount} ${netCount === 1 ? 'network' : 'networks'}` },
          { label: `${assetCount} ${assetCount === 1 ? 'asset' : 'assets'}` },
          ...(mandate.caps ?? []).slice(0, 2).map((c) => ({
            label: `≤ ${c.currency === 'USD' ? '$' + c.amount.toLocaleString() : c.amount + ' ' + c.asset}`,
          })),
        ]}
      />
    </section>
  )
}

function HierarchyTier({ depth, tone, label, primary, secondary, chips, address, addressLabel, active }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    if (!address) return
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div
      className={`${styles.hierTier} ${styles[`hierTier_${tone}`]} ${styles[`hierTier_depth_${depth}`]} ${active ? styles.hierTierActive : ''}`}
    >
      {depth > 0 && (
        <span className={styles.hierTierConnector} aria-hidden>
          <ChainConnector active={active} />
        </span>
      )}
      <div className={styles.hierTierHead}>
        <span className={styles.hierTierKicker}>{label}</span>
        <span className={styles.hierTierPrimary}>{primary}</span>
        {secondary && (
          <span className={styles.hierTierSecondary}>{secondary}</span>
        )}
        {address && (
          <button
            type="button"
            className={styles.hierTierAddress}
            onClick={copy}
            aria-label={`Copy ${label} address`}
            title={address}
          >
            <span className={styles.hierTierAddressKicker}>{addressLabel ?? 'Address'}</span>
            <span className={styles.hierTierAddressValue}>{truncate(address)}</span>
            <span className={styles.hierTierAddressIcon} aria-hidden>
              {copied ? <CheckSm /> : <CopyGlyph />}
            </span>
          </button>
        )}
      </div>
      {chips && chips.length > 0 && (
        <div className={styles.hierTierChips}>
          {chips.map((c, i) => (
            <span
              key={i}
              className={`${styles.hierTierChip} ${c.mono ? styles.hierTierChipMono : ''}`}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* Chain chip — small pill per network shown inline in the identity row. */
/* ── Agent readiness line ──
   One sentence that answers "is this agent firing right now, and if
   not, why?" — derived from agent status, MPC wallet presence, and
   dry-run (fork rehearsal) freshness.

   Beneath it: the drafter≠runtime disclosure + the manager endpoint
   that actually makes runtime decisions. Two small lines, cleanly
   separated from the title above. */
function AgentReadinessLine({ status, mandate, hasMpcWallet, lastRehearsalHoursAgo, rehearsing, onRehearse, managerEndpoint }) {
  const readiness = computeAgentReadiness({ status, hasMpcWallet, lastRehearsalHoursAgo })
  const stale = lastRehearsalHoursAgo != null && lastRehearsalHoursAgo > 24
  return (
    <div className={styles.readinessLine}>
      <div className={styles.readinessStatusRow}>
        <span
          className={`${styles.readinessDot} ${styles[`readinessDot_${readiness.tone}`]}`}
          aria-hidden
        />
        <span className={styles.readinessLabel}>{readiness.headline}</span>
        {readiness.detail && (
          <span className={styles.readinessDetail}>{readiness.detail}</span>
        )}
        {lastRehearsalHoursAgo != null && (
          <button
            type="button"
            className={`${styles.readinessRehearsal} ${stale ? styles.readinessRehearsalStaleBtn : ''} ${rehearsing ? styles.readinessRehearsalBusy : ''}`}
            onClick={onRehearse}
            disabled={rehearsing}
            title="Click to re-run the dry run — runs against a local chain fork. Live dispatch requires a rehearsal ≤ 24h old."
            aria-label="Re-run dry run on a chain fork"
          >
            <DryRunGlyph />
            {rehearsing ? (
              <>Re-running dry run…</>
            ) : (
              <>
                Dry run · {formatHoursAgo(lastRehearsalHoursAgo)}
                {stale && <span className={styles.readinessRehearsalStale}> · stale · re-run</span>}
              </>
            )}
          </button>
        )}
      </div>
      <p className={styles.readinessAttribution}>
        Drafted in <strong>{mandate.aiName}</strong>. Runtime decisions come from
        your manager endpoint at <code>{managerEndpoint.url}</code> — not from
        {' '}{mandate.aiName}. Switching drafters doesn't change who runs the agent.
      </p>
    </div>
  )
}

function computeAgentReadiness({ status, hasMpcWallet, lastRehearsalHoursAgo }) {
  if (status === 'revoked') {
    return { headline: 'Ended', detail: 'parent mandate was revoked', tone: 'muted' }
  }
  if (status === 'expired') {
    return { headline: 'Expired', detail: 'window closed', tone: 'muted' }
  }
  if (status === 'paused') {
    return { headline: 'Stopped', detail: 'schedules disabled · resume any time', tone: 'warn' }
  }
  if (!hasMpcWallet) {
    return { headline: 'Awaiting signer', detail: 'delegated MPC wallet not yet bound', tone: 'warn' }
  }
  if (lastRehearsalHoursAgo != null && lastRehearsalHoursAgo > 24) {
    return { headline: 'Dry run stale', detail: 'rerun on a chain fork to resume live dispatch', tone: 'warn' }
  }
  return { headline: 'Live · dispatching', detail: 'schedules firing onchain', tone: 'success' }
}

function formatHoursAgo(h) {
  if (h < 1)  return 'just now'
  if (h < 24) return `${Math.round(h)}h ago`
  const d = Math.round(h / 24)
  return d === 1 ? '1 day ago' : `${d} days ago`
}

function DryRunGlyph() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9.5c2-3.6 6-3.6 8 0" />
      <path d="M5.5 7l-2.5 2.5L5.5 12" />
      <circle cx="11" cy="3.5" r="1" fill="currentColor" />
    </svg>
  )
}

function ChainChips({ networks }) {
  if (!networks || networks.length === 0) return null
  return (
    <span className={styles.chainChips} aria-label={`Networks: ${networks.map(capitalize).join(', ')}`}>
      {networks.map((id) => (
        <span key={id} className={styles.chainChip}>
          <span className={`${styles.chainChipDot} ${styles[`netDot_${id}`] ?? ''}`} aria-hidden />
          <span>{capitalize(id)}</span>
        </span>
      ))}
    </span>
  )
}

function ChainStep({ kicker, title, address, tone, active, depth = 0 }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <li className={`${styles.chainStep} ${styles[`chainTone_${tone}`] ?? ''} ${styles[`chainDepth_${depth}`] ?? ''} ${active ? styles.chainStepActive : ''}`}>
      {depth > 0 && <ChainConnector active={active} />}
      <span className={styles.chainKicker}>{kicker}</span>
      <span className={styles.chainTitle}>{title}</span>
      <button
        type="button"
        className={styles.chainAddress}
        onClick={copy}
        aria-label={`Copy ${title} address`}
      >
        <span>{truncate(address)}</span>
        <span className={styles.chainCopyIcon} aria-hidden>
          {copied ? <CheckSm /> : <CopyGlyph />}
        </span>
      </button>
    </li>
  )
}

function ChainConnector({ active }) {
  const id = active ? 'chain-active' : 'chain-default'
  return (
    <span className={styles.chainConnector} aria-hidden>
      <svg
        className={styles.chainConnectorSvg}
        viewBox="0 0 16 36"
        width="16"
        height="36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="0" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0%"  stopColor={active ? '#1990FF' : '#FFFFFF'} stopOpacity="0" />
            <stop offset="35%" stopColor={active ? '#1990FF' : '#FFFFFF'} stopOpacity={active ? '0.35' : '0.18'} />
            <stop offset="100%" stopColor={active ? '#1990FF' : '#FFFFFF'} stopOpacity={active ? '0.7' : '0.32'} />
          </linearGradient>
        </defs>
        <path
          d="M 1.25 0 L 1.25 22 Q 1.25 30 9 30 L 14 30"
          stroke={`url(#${id}-stroke)`}
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle
          cx="14"
          cy="30"
          r="1.6"
          fill={active ? '#1990FF' : '#FFFFFF'}
          fillOpacity={active ? '0.85' : '0.34'}
        />
      </svg>
    </span>
  )
}

function SpecCell({ k, v, mono, action, hint }) {
  return (
    <div className={styles.specCell}>
      <span className={styles.specKey}>
        {k}
        {hint && (
          <span className={styles.specHintIcon} title={hint} aria-label={hint}>i</span>
        )}
      </span>
      <span className={styles.specValRow}>
        <span className={`${styles.specVal} ${mono ? styles.specValMono : ''}`}>{v}</span>
        {action}
      </span>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" />
      <circle cx="7" cy="7" r="1.6" />
    </svg>
  )
}

function ReceiptRow({ k, v, mono }) {
  return (
    <div className={styles.receiptRow}>
      <dt>{k}</dt>
      <dd className={mono ? styles.specValMono : ''}>{v}</dd>
    </div>
  )
}

/* Provider-tinted Edit button. Lives inside the sidebar's Actions stack. */
const PROVIDER_TINTS = {
  claude: { bg: 'rgba(204, 120, 92, 0.16)', border: 'rgba(204, 120, 92, 0.42)', text: '#F2C5B0' },
  cursor: { bg: 'rgba(200, 210, 225, 0.14)', border: 'rgba(220, 225, 240, 0.42)', text: '#DCE2EE' },
  codex:  { bg: 'rgba(16, 163, 127, 0.16)',  border: 'rgba(16, 163, 127, 0.46)', text: '#5FD6B4' },
  default: { bg: 'rgba(255, 255, 255, 0.06)', border: 'rgba(255, 255, 255, 0.16)', text: 'var(--text-primary)' },
}
function providerKey(name) {
  const n = (name ?? '').toLowerCase()
  if (n === 'claude' || n === 'anthropic') return 'claude'
  if (n === 'cursor') return 'cursor'
  if (n === 'codex' || n === 'chatgpt' || n === 'openai' || n === 'gpt') return 'codex'
  return 'default'
}
function ProviderEditButton({ aiName, disabled, onClick }) {
  const key = providerKey(aiName)
  const tint = PROVIDER_TINTS[key]
  const style = {
    '--p-bg': tint.bg,
    '--p-border': tint.border,
    '--p-text': tint.text,
  }
  return (
    <button
      type="button"
      className={styles.editBtnProvider}
      style={style}
      onClick={onClick}
      disabled={disabled}
    >
      Edit with {aiName}
    </button>
  )
}

/* ─────────── Run detail drawer ─────────── */
function RunDetailDrawer({ run, open, onClose }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <>
      <div
        className={`${styles.drawerScrim} ${open ? styles.drawerScrimOpen : ''}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Run detail"
      >
        {run && (
          <>
            <header className={styles.drawerHead}>
              <div className={styles.drawerHeadLeft}>
                <span className={styles.drawerKicker}>Execution</span>
                <span className={styles.drawerTitle}>{run.id}</span>
              </div>
              <button
                type="button"
                className={styles.drawerClose}
                onClick={onClose}
                aria-label="Close"
              >×</button>
            </header>

            <div className={styles.drawerBody}>
              <dl className={styles.drawerGrid}>
                <DrawerRow k="Status" v={
                  <span className={`${styles.drawerStatus} ${styles[`runStatus_${run.status}`]}`}>
                    {run.status === 'success' ? 'Success' : run.status === 'failed' ? 'Failed' : 'Pending'}
                  </span>
                } />
                <DrawerRow k="Action" v={run.label} />
                <DrawerRow k="Tx hash" v={
                  <a className={styles.drawerLink} href={`https://arbiscan.io/tx/${run.txHash}`} target="_blank" rel="noreferrer">
                    {truncateTx(run.txHash)}
                    <ArrowOutIcon />
                  </a>
                } />
                <DrawerRow k="Block"  v={run.block} />
                <DrawerRow k="Gas"    v={run.gas} />
                <DrawerRow k="When"   v={`${run.ts} · ${run.ago}`} />
                {run.error && <DrawerRow k="Error" v={<span className={styles.drawerError}>{run.error}</span>} />}
              </dl>

              <section className={styles.drawerSection}>
                <h3 className={styles.drawerSectionTitle}>Simulation</h3>
                <p className={styles.drawerNote}>
                  {run.status === 'failed'
                    ? 'Simulation passed before broadcast. The revert was triggered onchain.'
                    : 'Simulation matched the executed result exactly.'}
                </p>
              </section>

              <section className={styles.drawerSection}>
                <h3 className={styles.drawerSectionTitle}>Log</h3>
                <pre className={styles.drawerLog}>{run.log}</pre>
              </section>
            </div>
          </>
        )}
      </aside>
    </>
  )
}

function DrawerRow({ k, v }) {
  return (
    <div className={styles.drawerRow}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

/* ─────────── helpers / mock derivers ─────────── */

function deriveHealth(status) {
  if (status === 'active')  return { label: 'Healthy',  sub: 'Last check passed.',  tone: 'success' }
  if (status === 'paused')  return { label: 'Paused',   sub: 'No new executions.',  tone: 'warn'    }
  if (status === 'expired') return { label: 'Expired',  sub: 'Mandate complete.',   tone: 'muted'   }
  if (status === 'revoked') return { label: 'Revoked',  sub: 'Permanently stopped.',tone: 'danger'  }
  return                          { label: status,     sub: '',                    tone: 'muted'   }
}

function deriveLastCheck(mandate) {
  if (!mandate.lastAction) return { value: '—', sub: 'No checks yet.' }
  return {
    value: mandate.lastAction.ago,
    sub: mandate.lastAction.label,
  }
}

function deriveNextCheck(mandate, effective) {
  if (effective !== 'active') {
    return { value: '—', sub: effective === 'paused' ? 'Paused' : 'Not running' }
  }
  const ago = mandate.lastAction?.ago ?? '0h ago'
  const hoursAgo = parseAgoHours(ago)
  const cadenceH = 6
  if (hoursAgo == null) {
    return { value: '~6h', sub: 'Continuous · every 6h' }
  }
  const inH = Math.max(0, cadenceH - hoursAgo)
  const v = inH <= 0 ? 'soon' : `in ${inH}h`
  return { value: v, sub: 'Continuous · every 6h' }
}

function parseAgoHours(s) {
  if (!s) return null
  if (/just now/i.test(s)) return 0
  const m = s.match(/(\d+)\s*([mhd])/i)
  if (!m) return null
  const n = Number(m[1])
  const u = m[2].toLowerCase()
  if (u === 'm') return n / 60
  if (u === 'h') return n
  if (u === 'd') return n * 24
  return null
}

function deriveEnds(mandate) {
  const d = mandate.duration ?? ''
  const inMatch = d.match(/Ends in (.+)/i)
  if (inMatch) return { value: inMatch[1], sub: 'Auto-revokes at expiry.' }
  if (/^expired/i.test(d)) return { value: 'Expired', sub: d.replace(/^expired\s*/i, '') }
  if (/^revoked/i.test(d)) return { value: 'Revoked', sub: d.replace(/^revoked\s*/i, '') }
  return { value: d || '—', sub: '' }
}

function buildAgentView(mandate) {
  if (!mandate) return {
    mpcWallet: {}, runs: [], activity: [], schedule: {}, erc8004: {},
    agentId: null,
    templateHash: '', policyHash: '', templateDeployed: false,
    targets: [], receipt: {}, pages: [], recommendation: {},
  }

  const seed = hashStr(mandate.id)
  const seedHex = seed.toString(16).padStart(8, '0')
  const mpc = `0x${seedHex}${(seed * 7).toString(16).padStart(8, '0')}${(seed * 11).toString(16).padStart(8, '0')}${seedHex}`
  const mpcWallet = {
    address: pad40(mpc),
    gas: (0.005 + (seed % 30) / 1000).toFixed(4),
    threshold: '2-of-3',
    provenance: 'sail-mpc-lab',
    keyShares: ['operator-a', 'operator-b', 'paper-backup'],
  }

  // Canonical agent identity per the framework: a deterministic numeric
  // registry id (`deterministicAgentRegistryId`) derived from the slug
  // at create time. Same across drafters — Claude or Cursor opens the
  // same agentId from the project files. We base it on the slug-derived
  // seed so a stable id is shown in the UI.
  const agentId = 8_004_000 + (seed % 1000)

  // ERC-8004 handle is template-layer metadata only — never read by the
  // kernel. Surface as a secondary "verified" badge, not as identity.
  const erc8004 = {
    handle: `sail-agent#${mpcWallet.address.slice(2, 8)}`,
    url: `https://identity.erc8004.org/${mpcWallet.address}`,
  }

  const schedule = mandate.status === 'active'
    ? { label: 'Continuous · checks every 6h' }
    : { label: 'Stopped' }

  const lastAction = mandate.lastAction?.label ?? 'Mandate signed'
  const activity = mandate.status === 'active'
    ? [
        { id: 'a1', label: lastAction,                              ago: mandate.lastAction?.ago ?? 'just now', kind: 'exec' },
        { id: 'a2', label: 'Simulation passed before broadcast',    ago: mandate.lastAction?.ago ?? '2h ago',  kind: 'sim'  },
        { id: 'a3', label: 'Permission check ok',                   ago: '4h ago',                              kind: 'check' },
        { id: 'a4', label: 'Gas balance refreshed',                 ago: '4h ago',                              kind: 'sys'  },
        { id: 'a5', label: 'Agent authorized',                      ago: '1d ago',                              kind: 'auth' },
      ]
    : [
        { id: 'a1', label: mandate.status === 'revoked' ? 'Agent revoked' : 'Agent expired', ago: mandate.lastAction?.ago ?? '—', kind: 'auth' },
      ]

  const runs = (mandate.actions ?? []).slice(0, 6).map((a, i) => ({
    id: `run-${String(seed % 900 + 70 + i).padStart(3, '0')}`,
    label: a.label,
    status: i === 2 && mandate.status === 'active' ? 'failed' : 'success',
    ago: ['just now', '2h ago', '6h ago', '1d ago', '2d ago', '4d ago'][i] ?? `${i + 1}d ago`,
    ts: '2026-05-21 12:08 UTC',
    block: 23_481_004 - i * 13,
    txHash: `0x${seed.toString(16).padStart(4, '0').repeat(8).slice(0, 60)}${i}`,
    gas: `$${(0.08 + i * 0.04).toFixed(2)}`,
    log:
`[exec] ${a.label}
[exec] target: ${a.venue ?? 'protocol'}@${a.networks?.[0] ?? 'arbitrum'}
[sim ] preflight ok — gas 0.00018 ETH
[bcst] tx submitted — nonce 0x4${i}
[recv] block ${23_481_004 - i * 13} · success`,
    error: i === 2 && mandate.status === 'active' ? 'Slippage exceeded limit (0.5%)' : null,
  }))

  const templateHash = `0x${(seed * 13).toString(16).padStart(16, '0')}${seedHex}`
  const policyHash = `0x${(seed * 17).toString(16).padStart(8, '0')}…${(seed * 19).toString(16).padStart(4, '0')}`
  const templateDeployed = mandate.status === 'active' || mandate.status === 'expired'

  const SIG = {
    deposit:           { sig: 'supply(address,uint256,address,uint16)',  selector: '0x617ba037', template: 'SharedBoundedSwapPermission' },
    rebalance:         { sig: 'withdraw(address,uint256,address)',        selector: '0x69328dec', template: 'SharedBoundedBorrowPermission' },
    claim:             { sig: 'claimAllRewards(address[],address)',       selector: '0x3111e7b3', template: 'SharedApproveAndCallBatchPermission' },
    withdraw:          { sig: 'transfer(address,uint256)',                selector: '0xa9059cbb', template: 'SharedTransferTargetPermission' },
    swap:              { sig: 'exactInputSingle((address,address,...))',  selector: '0x414bf389', template: 'SharedBoundedSwapPermission' },
    'conditional-swap':{ sig: 'swapWhenYieldOver(uint256,bytes)',         selector: '0x8d5f63a2', template: 'SharedDeFiBundlePermission' },
    bridge:            { sig: 'depositV3(address,uint256,uint32,bytes)',  selector: '0x7b939232', template: 'SharedApproveAndCallBatchPermission' },
    lp:                { sig: 'add_liquidity(uint256[3],uint256)',        selector: '0x4515cef3', template: 'SharedAMMLiquidityPermission' },
    hedge:             { sig: 'openPosition(address,uint256,bool)',       selector: '0xb6b1b6c3', template: 'SharedApproveAndCallBatchPermission' },
    short:             { sig: 'openShort(uint256,uint256,uint256)',       selector: '0xa1d3e9bd', template: 'SharedDeFiBundlePermission' },
  }
  const targets = (mandate.actions ?? []).map((a) => {
    const s = SIG[a.kind] ?? { sig: 'call(bytes)', selector: '0x4e71e0c8', template: 'IPermission' }
    const cap = mandate.caps?.[0]
    const constraint = a.kind === 'deposit' || a.kind === 'rebalance'
      ? (cap ? `value ≤ ${cap.currency === 'USD' ? `$${cap.amount}` : `${cap.amount} ${cap.asset}`}` : 'unconstrained')
      : 'no value transfer'
    return {
      venue: (a.venue ?? a.networks?.[0] ?? 'protocol').toString(),
      template: s.template,
      signature: s.sig,
      selector: s.selector,
      constraint,
    }
  })

  const receipt = {
    txHash: `0x${(seed * 23).toString(16).padStart(8, '0').repeat(8).slice(0, 60)}`,
    block: 23_480_004 - (seed % 200),
    signedAt: '2026-04-27',
  }

  const pagesByMandate = {
    'mandate-1': [
      { id: 'p1', title: 'USDC yield watchlist',       icon: '$', maker: 'Claude', updated: '2h ago',  url: 'http://localhost:5180/#/dashboard?demo=full' },
      { id: 'p2', title: 'Aave ↔ Compound APY delta',  icon: '%', maker: 'Claude', updated: '1d ago',  url: 'http://localhost:5180/#/dashboard?demo=full' },
    ],
    'mandate-2': [
      { id: 'p1', title: 'ETH hedge P&L',              icon: 'Ξ', maker: 'Cursor', updated: '3h ago',  url: 'http://localhost:5180/#/dashboard?demo=full' },
    ],
    'mandate-5': [
      { id: 'p1', title: 'Aave APY history',           icon: '%', maker: 'Claude', updated: '6h ago',  url: 'http://localhost:5180/#/dashboard?demo=full' },
      { id: 'p2', title: 'Daily rebalancer log',       icon: '↻', maker: 'Claude', updated: '12h ago', url: 'http://localhost:5180/#/dashboard?demo=full' },
      { id: 'p3', title: 'Cap utilization chart',      icon: '◔', maker: 'Claude', updated: '2d ago',  url: 'http://localhost:5180/#/dashboard?demo=full' },
    ],
    'mandate-6': [
      { id: 'p1', title: 'BTC put delta sheet',        icon: '₿', maker: 'Codex',  updated: '1h ago',  url: 'http://localhost:5180/#/dashboard?demo=full' },
    ],
    'mandate-8': [
      { id: 'p1', title: 'Cross-chain APY heatmap',       icon: '◰', maker: 'Claude', updated: '5m ago',  url: 'http://localhost:5180/#/dashboard?demo=full' },
      { id: 'p2', title: 'Stablecoin arb opportunities',  icon: '⇄', maker: 'Claude', updated: '22m ago', url: 'http://localhost:5180/#/dashboard?demo=full' },
      { id: 'p3', title: 'Bridge fee tracker',            icon: '⤳', maker: 'Claude', updated: '1h ago',  url: 'http://localhost:5180/#/dashboard?demo=full' },
      { id: 'p4', title: 'Yield → ARB / OP recycler log', icon: '↻', maker: 'Claude', updated: '3h ago',  url: 'http://localhost:5180/#/dashboard?demo=full' },
      { id: 'p5', title: 'WBTC put delta sheet',          icon: '₿', maker: 'Claude', updated: '6h ago',  url: 'http://localhost:5180/#/dashboard?demo=full' },
    ],
  }
  const pages = pagesByMandate[mandate.id] ?? []

  const recommendation = {
    body: mandate.summary ?? 'Strategy goal recorded with this mandate.',
    confidence: 88 + (seed % 10),
    ago: '5 days ago',
  }

  return {
    mpcWallet, runs, activity, schedule, erc8004, agentId,
    templateHash, policyHash, templateDeployed,
    targets, receipt, pages, recommendation,
  }
}

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
function pad40(s) {
  const hex = s.replace(/[^0-9a-fA-F]/g, '')
  return '0x' + (hex + '0'.repeat(40)).slice(0, 40)
}
function truncate(addr) {
  if (!addr) return ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
function truncateTx(h) {
  if (!h) return ''
  return `${h.slice(0, 10)}…${h.slice(-6)}`
}
function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/* ─────────── inline icons ─────────── */
function DocBadgeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 2.5h5l3 3v8a.5.5 0 01-.5.5h-7.5a.5.5 0 01-.5-.5v-10a.5.5 0 01.5-.5z" />
      <path d="M9 2.5v3h3" />
      <path d="M5.6 9h5M5.6 11.4h5" />
    </svg>
  )
}
function ChevronRightInline() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 3l4 4-4 4" />
    </svg>
  )
}
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
function ChevronDown() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 5l4 4 4-4" />
    </svg>
  )
}
/* Clean up-right arrow for "open external" links — replaces the
   janky unicode "↗" glyph which never aligns to the text baseline. */
function ArrowOutIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 9 L9 5" />
      <path d="M5.4 5 H9 V8.6" />
    </svg>
  )
}
function CopyGlyph() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
function CrossSm() {
  return (
    <svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
    </svg>
  )
}
function DotSm() {
  return (
    <svg viewBox="0 0 14 14" width="6" height="6" aria-hidden>
      <circle cx="7" cy="7" r="3" fill="currentColor" />
    </svg>
  )
}
function NetIcon() {
  return (
    <svg viewBox="0 0 14 14" width="10" height="10" aria-hidden>
      <circle cx="7" cy="7" r="3" fill="currentColor" />
    </svg>
  )
}
