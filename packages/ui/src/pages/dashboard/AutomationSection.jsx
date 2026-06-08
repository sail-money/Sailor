import { useCallback, useEffect, useState } from 'react'
import styles from './RpcSection.module.css'
import auto from './AutomationSection.module.css'
import { InfoTip } from '../shared'
import { getAgentStatus, stopAgent } from '../../data/sailorClient'

/**
 * AutomationSection · a compact live readout of HOW/WHERE the agent runs, with
 * an expandable details panel (run methods, schedule, how to change it).
 * Reflects real `/api/agent-status`; offers a Stop control for a local run.
 *
 * Run methods (real, framework-shipped):
 *   • Local · `sailor run` on this machine (server sees the PID → source 'local')
 *   • GitHub Actions · the scaffolded .github/workflows/*.yml ticks on a cron
 *     schedule in CI (server detects the workflow → source 'remote')
 * The agent's strategy + schedule live in the PROJECT CODE · users change them
 * by talking to their AI coding assistant (the AGENTS.md flow), not in this UI.
 */

const AUTOMATION_TIP =
  "Your agent's run schedule. Today it runs your project's agent loop (`sailor run`) · locally, or in the cloud via the GitHub Actions workflow the project ships, which ticks on a schedule even when your computer is off. The protocol supports more than one agent per account: the SMA's manager can be a multisig that routes to several agents under a single dispatcher. Either way, mandates are the boundaries every agent runs within."

const CHANGE_PROMPT =
  'Sail, change how often my agent runs · I want it to [e.g. run every hour / every day at 9am / only on weekdays].'

function methodLabel(s) {
  if (s.running && s.source === 'local') return 'Local'
  // A 'remote' run is any host that's been active recently · GitHub Actions if
  // we detected the workflow, otherwise some other scheduler (server cron, CI…).
  if (s.running && s.source === 'remote') return s.githubActions?.file ? 'GitHub Actions' : 'Remote'
  if (s.githubActions?.file) return 'GitHub Actions'
  return 'Not configured'
}

function fmtAgo(ms) {
  if (ms == null) return ''
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

/** Best-effort human reading of a 5-field cron. Falls back to the raw string. */
function humanCron(cron) {
  if (!cron) return null
  const p = cron.trim().split(/\s+/)
  if (p.length !== 5) return cron
  const [min, hour, dom, , dow] = p
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const at = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`
  if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`
  if (hour.startsWith('*/')) return `Every ${hour.slice(2)} hours`
  if (dom === '*' && dow === '*') return `Daily at ${at(hour, min)}`
  if (dow !== '*' && !dow.includes('*')) {
    const d = DAYS[Number(dow)] ?? `day ${dow}`
    return `Every ${d} at ${at(hour, min)}`
  }
  return cron
}

export default function AutomationSection() {
  const [status, setStatus] = useState(null)
  const [stopping, setStopping] = useState(false)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    getAgentStatus().then(setStatus).catch(() => setStatus({ running: false }))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  if (!status) {
    return (
      <div className={styles.section}>
        <span className={styles.eyebrow}>AUTOMATION /</span>
        <span className={styles.loading}>Checking agent…</span>
      </div>
    )
  }

  const running = !!status.running
  const method = methodLabel(status)
  const gh = status.githubActions
  const repoUrl = gh?.repoUrl
  const schedule = humanCron(gh?.cron)

  // Three honest states: actively ticking now, armed on a schedule, or nothing
  // set up. A scheduled-but-idle agent is NOT "stopped".
  const scheduled = !running && !!gh?.cron
  const configured = !running && !gh?.cron && !!gh?.file
  const pillLabel = running ? 'Running' : scheduled ? 'Scheduled' : configured ? 'Configured' : 'Not set up'
  const pillOk = running || scheduled || configured

  async function onStop() {
    setStopping(true)
    try { await stopAgent(); load() } finally { setStopping(false) }
  }

  function copyPrompt() {
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(CHANGE_PROMPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={styles.section}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>
          AUTOMATION / <InfoTip label="How does the agent run?">{AUTOMATION_TIP}</InfoTip>
        </span>
        <span className={`${styles.health} ${pillOk ? styles.healthOk : styles.healthWarn}`}>
          <span className={styles.healthDot} aria-hidden />
          {pillLabel}
        </span>
      </div>

      <div className={styles.compact}>
        <div className={styles.compactMain}>
          <span className={styles.endpoint}>
            {running
              ? (status.source === 'remote' ? 'Running in GitHub Actions' : 'Running locally')
              : (gh?.file ? 'Scheduled via GitHub Actions' : 'No automation configured')}
          </span>
          <span className={styles.compactMeta}>
            <span className={styles.chainChipStatic}>{method}</span>
            {schedule && (
              <>
                <span className={styles.compactSep} aria-hidden>·</span>
                <span className={styles.providerName}>{schedule}</span>
              </>
            )}
            {status.source === 'remote' && status.lastActivityMs != null && (
              <>
                <span className={styles.compactSep} aria-hidden>·</span>
                <span className={styles.providerName}>last run {fmtAgo(status.lastActivityMs)}</span>
              </>
            )}
          </span>
        </div>
        <div className={auto.actions}>
          {running && (
            <button type="button" className={styles.editBtn} onClick={onStop} disabled={stopping}>
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          )}
          <button type="button" className={styles.editBtn} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Details'}
          </button>
        </div>
      </div>

      {open && (
        <div className={auto.details}>
          {/* ── Schedule ── */}
          {gh?.cron && (
            <div className={auto.block}>
              <span className={auto.label}>Schedule</span>
              <div className={auto.scheduleRow}>
                <span className={auto.scheduleHuman}>{schedule}</span>
                <span className={auto.cronChip} title="cron expression">{gh.cron}</span>
              </div>
              <p className={auto.note}>
                Triggers automatically on this schedule, plus on-demand from GitHub
                (the workflow&rsquo;s <code>workflow_dispatch</code>).
              </p>
            </div>
          )}

          {/* ── Two ways to run ── */}
          <div className={auto.block}>
            <span className={auto.label}>Run methods</span>
            <ul className={auto.methods}>
              <li className={`${auto.method} ${running && status.source === 'remote' ? auto.methodActive : ''}`}>
                <span className={auto.methodName}>
                  GitHub Actions <span className={auto.methodTag}>cloud · recommended</span>
                  {gh?.file && <span className={auto.methodFile}>{gh.file}</span>}
                </span>
                <span className={auto.methodDesc}>
                  Runs in the cloud on the schedule above · even when your computer is off.
                </span>
                <ol className={auto.steps}>
                  <li><span className={auto.stepNum}>01</span><span className={auto.stepText}>Push your project to a GitHub repo.</span></li>
                  <li><span className={auto.stepNum}>02</span><span className={auto.stepText}>In the repo: <strong>Settings → Secrets and variables → Actions</strong>.</span></li>
                  <li><span className={auto.stepNum}>03</span><span className={auto.stepText}>Add secrets <code>RPC_URL</code> and <code>MANAGER_KEY</code>, and a variable <code>CHAIN_ID</code>.</span></li>
                  <li><span className={auto.stepNum}>04</span><span className={auto.stepText}>Done · <code>{gh?.file ?? 'agent-tick.yml'}</code> runs on schedule, or trigger it with <strong>Run workflow</strong>.</span></li>
                </ol>
                <a
                  className={auto.repoLink}
                  href={repoUrl ? `${repoUrl}/settings/secrets/actions` : 'https://docs.github.com/actions/security-guides/encrypted-secrets'}
                  target="_blank"
                  rel="noreferrer"
                >
                  {repoUrl ? 'Open your repo secrets' : 'GitHub secrets guide'} ↗
                </a>
              </li>

              <li className={`${auto.method} ${running && status.source === 'local' ? auto.methodActive : ''}`}>
                <span className={auto.methodName}>Local <span className={auto.methodTag}>this machine</span></span>
                <span className={auto.methodDesc}>
                  Runs on your computer · good for testing. Only ticks while it&rsquo;s on and the command is running.
                </span>
                <div className={auto.codeBlock}>
                  <code>cd your-project &amp;&amp; sailor run</code>
                  <button
                    type="button"
                    className={auto.copyBtn}
                    onClick={() => { navigator?.clipboard?.writeText?.('sailor run') }}
                  >
                    Copy
                  </button>
                </div>
              </li>

              <li className={auto.method}>
                <span className={auto.methodName}>Anywhere else <span className={auto.methodTag}>self-hosted</span></span>
                <span className={auto.methodDesc}>
                  The agent is just <code>sailor run --once</code> · GitHub Actions is only the default. Any scheduler
                  works: a server cron, a <code>systemd</code>/<code>launchd</code> timer, another CI (GitLab, CircleCI…),
                  or a cloud function. It only needs <code>RPC_URL</code>, <code>MANAGER_KEY</code> and <code>CHAIN_ID</code>
                  in its environment, on whatever schedule you choose.
                </span>
              </li>
            </ul>
            <p className={auto.note}>
              <strong>Switching methods?</strong> There&rsquo;s no toggle here · the run method is simply wherever you
              schedule <code>sailor run</code>. To move off GitHub Actions, set up your chosen runner with those three
              values and disable the workflow (or ask your AI assistant to wire it up).
            </p>
          </div>

          {/* ── Change it via the AI assistant ── */}
          <div className={auto.block}>
            <span className={auto.label}>Change the schedule or strategy</span>
            <p className={auto.note}>
              Your agent&rsquo;s schedule and strategy live in your project code · not in this dashboard.
              To change them, open the chat with your AI coding assistant (where you set Sail up) and ask:
            </p>
            <div className={auto.promptCard}>
              <p className={auto.promptText}>“{CHANGE_PROMPT}”</p>
              <button type="button" className={auto.copyBtn} onClick={copyPrompt}>
                {copied ? 'Copied ✓' : 'Copy prompt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
