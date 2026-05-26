import { useEffect, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import {
  FluidBackground,
  GlassCard,
  Sai,
  RevealCalldata,
  SailButton,
} from '../shared'
import shared from '../shared/shared.module.css'
import styles from './Signing.module.css'
import { mockDeploy } from './mockData'
import { useDemoState } from '../../demo/useDemoState'

// Legacy login/signup URLs route to the unified 'connect' state so old
// demo-console links keep working.
const STATE_ALIASES = { login: 'connect', signup: 'connect' }
const VALID_DEMO_STATES = new Set(['welcome', 'connect', 'deploy', 'confirming'])

/**
 * Sign-in & onboarding flow.
 *
 * welcome → connect → dashboard
 *
 * The SMA is no longer created in this flow. The wallet is the
 * identity; landing on the dashboard with no SMA is a first-class
 * state, and SMA creation happens later — bundled into the
 * "create your first mandate" moment, where the user can see the
 * value of the SMA before paying gas to deploy it.
 *
 * The legacy `deploy` and `confirming` states are retained so demo
 * console preset URLs keep working, but they are no longer reached
 * by the normal sign-in flow.
 */
export default function Signing() {
  const demo = useDemoState()
  const aliased = STATE_ALIASES[demo.demo] ?? demo.demo
  const initialState = VALID_DEMO_STATES.has(aliased) ? aliased : 'welcome'
  const [state, setState] = useState(initialState)
  const [progress, setProgress] = useState('idle')

  useEffect(() => {
    if (state !== 'confirming') return
    setProgress('waiting')
    // Success state dwells for ~2.4s after it lands — long enough for
    // the user to read "Account deployed." and feel the moment.
    const t1 = setTimeout(() => setProgress('confirmed'), 1700)
    const t2 = setTimeout(() => {
      window.location.hash = '#/dashboard'
    }, 4100)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [state])

  function go(next) {
    setState(next)
  }

  function onLoginAuthed() {
    window.location.hash = '#/dashboard'
  }

  return (
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <FluidBackground />

      <HeaderBar onLogo={() => go('welcome')} state={state} />

      <main className={styles.stage}>
        {/* The connect flow no longer needs a stepper — connect is a
            single step, and the SMA deployment is bundled with the
            first-mandate flow (CreateSMAModal carries its own stepper). */}
        <div key={state} className={styles.stageInner}>
          {state === 'welcome' && (
            <WelcomeState onConnect={() => go('connect')} />
          )}
          {state === 'connect' && (
            <ConnectState
              onBack={() => go('welcome')}
              onAuthed={(walletId) => {
                /* Every wallet method except Ledger lands on the fully
                   populated dashboard (returning user, multiple agents).
                   Ledger is special: we use it to demo the brand-new
                   user state — wallet connected but no SMA yet, so the
                   user lands on the no-SMA hero and walks the
                   "create your first agent" flow. */
                const target = walletId === 'ledger'
                  ? '#/dashboard?demo=empty'
                  : '#/dashboard?demo=full'
                window.location.hash = target
              }}
            />
          )}
          {state === 'deploy' && (
            <DeployState onBack={() => go('connect')} onSign={() => go('confirming')} />
          )}
          {state === 'confirming' && <ConfirmState progress={progress} />}
        </div>
      </main>
    </div>
  )
}

/* ─────────── Header bar ─────────── */
function HeaderBar({ onLogo, state }) {
  return (
    <header className={styles.headerBar}>
      <button
        type="button"
        className={styles.logoBtn}
        onClick={onLogo}
        aria-label="Sail home"
      >
        <Sai size={56} animate />
      </button>
      {state !== 'confirming' && (
        <span className={styles.headerHint}>
          Sail never sees your keys
        </span>
      )}
    </header>
  )
}

/* ─────────── Stepper (shown on the connect → deploy → confirm path) ─────────── */
const SIGNING_STEPS = [
  { id: 'connect', label: 'Connect' },
  { id: 'deploy',  label: 'Deploy' },
  { id: 'confirm', label: 'Confirm' },
]

function Stepper({ state }) {
  const currentIdx =
    state === 'connect' ? 0 :
    state === 'deploy' ? 1 :
    state === 'confirming' ? 2 :
    -1
  if (currentIdx < 0) return null

  return (
    <div className={styles.stepper} aria-label="Onboarding progress">
      {SIGNING_STEPS.map((s, i) => {
        const status = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming'
        return (
          <span key={s.id} className={styles.stepGroup}>
            <span className={`${styles.step} ${styles[`step_${status}`]}`}>
              <span className={styles.stepCircle} aria-hidden>
                {status === 'done' ? (
                  <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7.5l2.6 2.6L11 4" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {status === 'current' && (
                <span className={styles.stepLabel}>{s.label}</span>
              )}
            </span>
            {i < SIGNING_STEPS.length - 1 && (
              <span
                className={`${styles.stepLine} ${i < currentIdx ? styles.stepLineDone : ''}`}
                aria-hidden
              />
            )}
          </span>
        )
      })}
    </div>
  )
}

/* ─────────── Welcome — single Connect CTA ─────────── */
function WelcomeState({ onConnect }) {
  return (
    <GlassCard className={styles.welcomeCard}>
      <div className={styles.cardSai} aria-hidden>
        <Sai size={64} animate />
      </div>

      <header className={styles.cardHeader}>
        <span className={styles.kicker}>WELCOME TO SAIL</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          Separately Managed Accounts.
        </h1>
        <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
          Enforced by code, run by agents.
        </p>
      </header>

      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={onConnect}>
          Connect wallet
        </SailButton>
      </div>

      <p className={styles.fineprint}>
        Authentication handled by Privy. Sail never holds your keys.
      </p>
    </GlassCard>
  )
}

/* ─────────── Connect wallet — unified login/signup ───────────
   No separate paths for new vs returning users: the wallet itself is
   the identity. In production the post-connect router decides whether
   to land on the dashboard (existing SMA) or the deploy step (new).
   The mock advances to deploy so the full flow stays demoable. */
function ConnectState({ onBack, onAuthed }) {
  const { isConnected } = useAccount()

  // Once the wallet connects, continue the flow exactly as the mock did —
  // route onward to the dashboard. Real account presence is resolved
  // there via useSailorAccount(). No walletId is passed, so the parent's
  // default (non-Ledger) routing applies.
  useEffect(() => {
    if (isConnected) onAuthed?.()
  }, [isConnected, onAuthed])

  return (
    <GlassCard className={styles.authCard}>
      <CardHeader
        kicker="CONNECT WALLET"
        title="Choose a wallet"
        sub="Sail is self-custody. Connect the EOA that will own your SMA."
        onBack={onBack}
      />
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
        <ConnectButton showBalance={false} />
      </div>
    </GlassCard>
  )
}

/* ─────────── Wallet grid (EOA only) ─────────── */
const WALLETS = [
  { id: 'metamask',      label: 'MetaMask',      tone: 'orange' },
  { id: 'rabby',         label: 'Rabby',         tone: 'blue' },
  { id: 'phantom',       label: 'Phantom',       tone: 'purple' },
  { id: 'coinbase',      label: 'Coinbase',      tone: 'blue' },
  { id: 'rainbow',       label: 'Rainbow',       tone: 'rainbow' },
  { id: 'ledger',        label: 'Ledger',        tone: 'mono' },
  { id: 'trust',         label: 'Trust',         tone: 'blue' },
  { id: 'walletconnect', label: 'WalletConnect', tone: 'blue' },
]

function WalletGrid({ onPick }) {
  return (
    <div className={styles.walletGrid}>
      {WALLETS.map((w) => (
        <button
          key={w.id}
          type="button"
          className={styles.walletTile}
          onClick={() => onPick?.(w.id)}
        >
          <span className={`${styles.walletIcon} ${styles[`walletIcon_${w.tone}`]}`} aria-hidden>
            <WalletGlyph id={w.id} />
          </span>
          <span className={styles.walletLabel}>{w.label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Tiny brand-evocative SVG glyphs. Wallet brand logos are tradmarked;
 * these are abstract marks tinted in each wallet's signature color.
 */
function WalletGlyph({ id }) {
  const common = { width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (id) {
    case 'metamask':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M3 5l6 5-2 4 5 1 5-1-2-4 6-5-5 1-4-2-4 2-5-1z" />
          <circle cx="9" cy="13" r=".8" fill="currentColor" stroke="none" />
          <circle cx="15" cy="13" r=".8" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'rabby':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M5 13c0-4 3-7 7-7s7 3 7 7v3c0 1.1-.9 2-2 2H7a2 2 0 01-2-2v-3z" />
          <circle cx="9.5" cy="13" r=".9" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="13" r=".9" fill="currentColor" stroke="none" />
          <path d="M11 17h2" />
        </svg>
      )
    case 'phantom':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M5 11a7 7 0 0114 0v7l-3-2-3 2-3-2-3 2-2-1.5V11z" />
          <circle cx="10" cy="11" r=".9" fill="currentColor" stroke="none" />
          <circle cx="15" cy="11" r=".9" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'coinbase':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="8" />
          <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'rainbow':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M3 18a9 9 0 0118 0" />
          <path d="M6 18a6 6 0 0112 0" />
          <path d="M9 18a3 3 0 016 0" />
          <circle cx="12" cy="18" r=".9" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'ledger':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M9 10v5M15 10v5M12 9v7" />
        </svg>
      )
    case 'trust':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M12 4l7 3v6c0 4-3 6-7 7-4-1-7-3-7-7V7l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      )
    case 'walletconnect':
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M5 11a9 9 0 0114 0" />
          <path d="M8 14a5 5 0 018 0" />
          <circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" />
        </svg>
      )
    default:
      return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="6" /></svg>
  }
}

/* ─────────── Deploy review ─────────── */
function DeployState({ onSign, onBack }) {
  return (
    <GlassCard className={styles.deployCard}>
      <button
        type="button"
        className={styles.backBtnFloat}
        onClick={onBack}
        aria-label="Back"
      >
        <ChevronLeft />
      </button>

      <div className={styles.deploySai} aria-hidden>
        <span className={styles.deploySaiHalo} />
        <Sai size={52} animate />
      </div>

      <header className={styles.deployHeader}>
        <span className={styles.kicker}>DEPLOY YOUR ACCOUNT</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          Sign to create your SMA
        </h1>
        <p className={styles.cardSub}>
          One signature creates a self-custody smart account.<br />
          No AI has access yet.
        </p>
      </header>

      <span className={styles.softDivider} aria-hidden />

      <ul className={styles.deployPoints}>
        <li style={{ '--i': 0 }}>
          <Check />
          <div>
            <span className={styles.pointTitle}>You own this account</span>
            <span className={styles.pointSub}>Not Sail. Not the AI. Only you.</span>
          </div>
        </li>
        <li style={{ '--i': 1 }}>
          <Check />
          <div>
            <span className={styles.pointTitle}>Bounded delegation</span>
            <span className={styles.pointSub}>You set every constraint onchain.</span>
          </div>
        </li>
        <li style={{ '--i': 2 }}>
          <Check />
          <div>
            <span className={styles.pointTitle}>Revoke instantly</span>
            <span className={styles.pointSub}>One-tap revocation, always.</span>
          </div>
        </li>
      </ul>

      <div className={styles.txPanel}>
        <header className={styles.txPanelHeader}>
          <span className={styles.txPanelKicker}>What you are signing</span>
          <span className={styles.txPanelBadge}>{mockDeploy.network}</span>
        </header>
        <dl className={styles.txDetails}>
          <Row k="Transaction" v={mockDeploy.type} />
          <Row k="Network" v={mockDeploy.network} />
          <Row k="Gas estimate" v={mockDeploy.gasEstimate} accent />
        </dl>
        <div className={styles.txPanelFooter}>
          <RevealCalldata
            calldata={mockDeploy.calldata}
            label="View calldata"
            caption="The exact deployment payload."
          />
        </div>
      </div>

      <SailButton fullWidth onClick={onSign}>
        Sign &amp; deploy
      </SailButton>
      <p className={styles.fineprint}>
        Gas is paid from your connected wallet. You can revoke this account at any time.
      </p>
    </GlassCard>
  )
}

function Row({ k, v, accent }) {
  return (
    <div className={styles.txRow}>
      <dt>{k}</dt>
      <dd className={accent ? styles.gas : ''}>{v}</dd>
    </div>
  )
}

/* ─────────── Confirming ─────────── */
function ConfirmState({ progress }) {
  const confirmed = progress === 'confirmed'
  return (
    <GlassCard className={styles.confirmCard}>
      <div className={`${styles.confirmIndicator} ${confirmed ? styles.confirmDone : ''}`}>
        {confirmed ? (
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
        {confirmed ? 'Account deployed.' : 'Waiting for your signature…'}
      </h2>
      <p className={styles.confirmSub}>
        {confirmed
          ? 'Taking you to your dashboard…'
          : 'Approve the deployment in your wallet to continue.'}
      </p>
    </GlassCard>
  )
}

/* ─────────── Shared atoms ─────────── */
function CardHeader({ kicker, title, sub, onBack }) {
  return (
    <header className={styles.cardHeader}>
      {onBack && (
        <button
          type="button"
          className={styles.backBtn}
          onClick={onBack}
          aria-label="Back"
        >
          <ChevronLeft />
        </button>
      )}
      <span className={styles.kicker}>{kicker}</span>
      <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>{title}</h1>
      {sub && <p className={styles.cardSub}>{sub}</p>}
    </header>
  )
}

function AuthButton({ variant, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.authBtn} ${styles[`authBtn_${variant}`]}`}
    >
      <span className={styles.authBtnIcon}>
        {variant === 'google' ? <GoogleIcon /> : <WalletIcon />}
      </span>
      <span>{children}</span>
    </button>
  )
}

function Divider({ label }) {
  return (
    <div className={styles.divider} role="separator" aria-orientation="horizontal">
      <span className={styles.dividerLine} />
      <span className={styles.dividerLabel}>{label}</span>
      <span className={styles.dividerLine} />
    </div>
  )
}

function FooterSwitch({ question, action, onClick }) {
  return (
    <p className={styles.footerSwitch}>
      <span className={styles.footerQuestion}>{question}</span>{' '}
      <button type="button" className={styles.footerAction} onClick={onClick}>
        {action}
      </button>
    </p>
  )
}

/* ─────────── Inline icons ─────────── */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.96h5.52c-.24 1.44-1.68 4.2-5.52 4.2-3.32 0-6.04-2.74-6.04-6.12s2.72-6.12 6.04-6.12c1.9 0 3.16.8 3.88 1.48l2.64-2.56C16.74 3.56 14.6 2.6 12 2.6c-5.16 0-9.36 4.2-9.36 9.36s4.2 9.36 9.36 9.36c5.4 0 8.98-3.8 8.98-9.16 0-.62-.06-1.08-.16-1.56H12z"/>
      <path fill="#FBBC05" d="M2.64 11.96l3.32 2.44c.46-1.44 1.7-2.4 3.04-2.84V8.62C6.16 9.16 3.48 11.2 2.64 11.96z" opacity=".0"/>
    </svg>
  )
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="14" r="4" />
      <path d="M11 12l9-7-2 4 2 1.5-2 2" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
    </svg>
  )
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

function Check() {
  return (
    <span className={styles.checkBubble} aria-hidden>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l5 5L20 7" />
      </svg>
    </span>
  )
}
