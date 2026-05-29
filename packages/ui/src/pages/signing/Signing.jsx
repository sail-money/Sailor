import { useEffect, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { getChain } from '@sail/chains'
import { zeroAddress } from 'viem'
import { useAccount, usePublicClient, useSignTypedData } from 'wagmi'
import { FluidBackground, GlassCard, Sai, RevealCalldata, SailButton } from '../shared'
import PageHeader from '../shared/PageHeader'
import shared from '../shared/shared.module.css'
import styles from './Signing.module.css'
import { useSailorMandateDraft } from '../../hooks/useSailorData'

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
/**
 * Top-level router for the signing page. When a mandate draft is present
 * (written by `sailor mandate prepare`), the page becomes the mandate review +
 * MetaMask signing flow. Otherwise it shows the wallet-connect onboarding.
 * Each branch is its own component so hook order stays stable.
 */
export default function Signing() {
  const { draft } = useSailorMandateDraft()
  const { isConnected } = useAccount()

  if (draft) return <MandateSigningFlow draft={draft} />
  if (isConnected) return <NoPendingFlow />
  return <OnboardingFlow />
}

function NoPendingFlow() {
  return (
    <div className={styles.shell}>
      <FluidBackground />
      <HeaderBar state="welcome" />
      <main className={styles.stage}>
        <div className={styles.stageInner}>
          <GlassCard className={styles.welcomeCard}>
            <div className={styles.cardSai} aria-hidden>
              <Sai size={64} animate />
            </div>
            <header className={styles.cardHeader}>
              <span className={styles.kicker}>SIGNING STATION</span>
              <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
                No pending signatures.
              </h1>
              <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
                Run <code style={{ fontSize: 13, opacity: 0.8 }}>sailor mandate prepare</code> to queue a mandate for signing.
              </p>
            </header>
            <div className={styles.welcomeCta}>
              <SailButton fullWidth onClick={() => { window.location.hash = '#/dashboard' }}>
                Go to dashboard
              </SailButton>
            </div>
          </GlassCard>
        </div>
      </main>
    </div>
  )
}

function OnboardingFlow() {
  const [state, setState] = useState('welcome')

  return (
    <div className={styles.shell}>
      <FluidBackground />
      <HeaderBar state={state} />
      <main className={styles.stage}>
        <div key={state} className={styles.stageInner}>
          {state === 'welcome' && (
            <WelcomeState onConnect={() => setState('connect')} />
          )}
          {state === 'connect' && (
            <ConnectState
              onBack={() => setState('welcome')}
              onAuthed={() => { window.location.hash = '#/dashboard' }}
            />
          )}
        </div>
      </main>
    </div>
  )
}

/* ─────────── Mandate signing (MetaMask) ───────────
   Driven by a .sail/mandate-draft.json written by `sailor mandate prepare`.
   Flow: connect wallet → review permissions → sign the EIP-712
   RegisterPermissions message with the connected wallet → POST the signature
   to /api/mandate-submit → confirmation. No local key is ever created. */
const SIGNER_NONCES_ABI = [
  {
    type: 'function',
    name: 'signerNonces',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

function MandateSigningFlow({ draft }) {
  const { isConnected } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const publicClient = usePublicClient()
  const [phase, setPhase] = useState('review') // review | signing | done
  const [errorMsg, setErrorMsg] = useState('')

  // The kernel address (EIP-712 verifyingContract) comes from the draft's
  // chainId via @sail/chains. Falls back to the zero address when the chain
  // is not yet configured, so the flow stays demoable.
  const kernel = (() => {
    try {
      return getChain(draft.chainId).kernel
    } catch {
      return zeroAddress
    }
  })()

  async function onSign() {
    if (phase === 'signing') return
    setErrorMsg('')
    setPhase('signing')
    try {
      const permissions = (draft.items ?? []).map((it) => it.template)

      // Read the current signer nonce from the kernel; default to 0 if the
      // kernel is unreachable or not yet deployed.
      let nonce = 0n
      try {
        if (publicClient && kernel !== zeroAddress) {
          nonce = await publicClient.readContract({
            address: kernel,
            abi: SIGNER_NONCES_ABI,
            functionName: 'signerNonces',
            args: [draft.account],
          })
        }
      } catch {
        nonce = 0n
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const signature = await signTypedDataAsync({
        domain: {
          name: 'SailKernel',
          version: '1',
          chainId: draft.chainId,
          verifyingContract: kernel,
        },
        types: {
          RegisterPermissions: [
            { name: 'account', type: 'address' },
            { name: 'permissions', type: 'address[]' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'RegisterPermissions',
        message: { account: draft.account, permissions, nonce, deadline },
      })

      const res = await fetch('/api/mandate-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, signedAt: new Date().toISOString() }),
      })
      if (!res.ok) throw new Error(`Submit failed (${res.status})`)

      setPhase('done')
      setTimeout(() => {
        window.location.hash = '#/dashboard'
      }, 2200)
    } catch (err) {
      setErrorMsg(err?.shortMessage || err?.message || 'Signing failed')
      setPhase('review')
    }
  }

  return (
    <div className={styles.shell}>
      <FluidBackground />
      <HeaderBar state={phase === 'done' ? 'confirming' : 'review'} />

      <main className={styles.stage}>
        <div className={styles.stageInner}>
          {phase === 'done' ? (
            <ConfirmState progress="confirmed" />
          ) : (
            <GlassCard className={styles.authCard}>
              <CardHeader
                kicker="REVIEW MANDATE"
                title="Authorize your agent"
                sub="Sign with your wallet — Sail never holds your keys."
              />

              {!isConnected ? (
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
                  <ConnectButton showBalance={false} />
                </div>
              ) : (
                <>
                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: '12px 0',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    {(draft.items ?? []).map((it, i) => (
                      <li
                        key={i}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          background: 'var(--glass-bg)',
                          border: '1px solid var(--glass-border)',
                        }}
                      >
                        <span
                          style={{
                            color: 'var(--text-secondary)',
                            fontSize: 14,
                            lineHeight: 1.5,
                          }}
                        >
                          {it.explanation}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {errorMsg && (
                    <p style={{ color: '#ff6b6b', fontSize: 13, margin: '8px 0' }}>{errorMsg}</p>
                  )}

                  <SailButton fullWidth onClick={onSign} disabled={phase === 'signing'}>
                    {phase === 'signing' ? 'Waiting for wallet…' : 'Sign mandate'}
                  </SailButton>
                  <p className={styles.fineprint}>
                    Revocable on-chain at any time from your dashboard.
                  </p>
                </>
              )}
            </GlassCard>
          )}
        </div>
      </main>
    </div>
  )
}

/* ─────────── Header bar ─────────── */
function HeaderBar({ state }) {
  return (
    <PageHeader
      eyebrow="Signing"
      title={state === 'confirming' ? 'Signed' : 'Sail never sees your keys'}
      backTo="#/dashboard"
    />
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
