import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { getChain } from '@sail/sdk/chains'
import { zeroAddress } from 'viem'
import { useAccount, usePublicClient, useSignTypedData, useSwitchChain } from 'wagmi'
import { HorizonBackground, GlassCard, Sai, RevealCalldata, SailButton, BadgeRow } from '../shared'
import PageHeader from '../shared/PageHeader'
import shared from '../shared/shared.module.css'
import styles from './Signing.module.css'
import { useSailorMandateDraft } from '../../hooks/useSailorData'
import { explorerCodeUrl } from '../../lib/explorer'

/**
 * Top-level router for the signing page. When a mandate draft is present
 * (written by `sailor mandate prepare`), the page becomes the mandate review +
 * MetaMask signing flow. Otherwise it shows the wallet-connect onboarding.
 * Each branch is its own component so hook order stays stable.
 */
export default function Signing() {
  const { draft } = useSailorMandateDraft()

  if (draft) return <MandateSigningFlow draft={draft} />
  return <NoPendingFlow />
}

function NoPendingFlow() {
  return (
    <div className={styles.shell}>
      <HorizonBackground />
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

function ExplanationPanel({ ex }) {
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--glass-border)' }}>
      <BadgeRow items={[ex.protocol, ex.chain, ex.version]} />
      {ex.enforced?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5dde8b', marginBottom: 5 }}>
            Enforced on-chain
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {ex.enforced.map((b, i) => (
              <li key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', paddingLeft: 12, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0, color: '#5dde8b' }}>·</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ex.notEnforced?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 5 }}>
            Agent code — not enforced on-chain
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {ex.notEnforced.map((b, i) => (
              <li key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', paddingLeft: 12, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0 }}>·</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function PermissionRow({ item, chainId }) {
  const [open, setOpen] = useState(false)
  const ex = item.permExplanation
  // Link to the permission contract's verified source on the chain's explorer
  // (Basescan/Etherscan/…) so the owner can read the code they're authorizing.
  const codeUrl = item.address ? explorerCodeUrl(chainId, item.address) : null

  return (
    <li style={{
      borderRadius: 2,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => ex && setOpen(o => !o)}
        style={{
          padding: '10px 12px',
          cursor: ex ? 'pointer' : 'default',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
            {item.explanation}
          </div>
          {item.address && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{item.address.slice(0, 6)}…{item.address.slice(-4)}</span>
              {codeUrl && (
                <a
                  href={codeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: '#7eb8f7', textDecoration: 'none' }}
                >
                  View code on scanner ↗
                </a>
              )}
            </div>
          )}
        </div>
        {ex && (
          <span style={{
            flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 8px', borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.12)',
            background: open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
            fontSize: 11, color: 'rgba(255,255,255,0.5)',
            fontWeight: 500, whiteSpace: 'nowrap',
            transition: 'background 0.15s, color 0.15s',
            userSelect: 'none',
          }}>
            Details
            <span style={{
              fontSize: 8, display: 'inline-block',
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
              opacity: 0.6,
            }}>▾</span>
          </span>
        )}
      </div>
      {open && ex && (
        <div style={{ padding: '0 12px 12px' }}>
          <ExplanationPanel ex={ex} />
        </div>
      )}
    </li>
  )
}

function RegistrationFeeNote({ fee }) {
  const symbol = fee.symbol ?? 'ETH'
  return (
    <div style={{
      marginTop: 4,
      marginBottom: 4,
      padding: '10px 12px',
      borderRadius: 2,
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 8,
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Registration fee</span>
      <span style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 14, color: 'var(--text-primary, #fff)', fontWeight: 600 }}>
          {fee.totalEth} {symbol}
        </span>
        {fee.permissionCount > 1 && fee.perPermissionEth && (
          <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            {fee.permissionCount} permissions × {fee.perPermissionEth} {symbol}
          </span>
        )}
        {fee.permissionCount > 1 && !fee.perPermissionEth && (
          <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            for {fee.permissionCount} permissions
          </span>
        )}
      </span>
    </div>
  )
}

export function MandateSigningFlow({ draft, embedded = false }) {
  const { isConnected, chainId: walletChainId } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const { switchChainAsync } = useSwitchChain()
  const publicClient = usePublicClient()
  const [phase, setPhase] = useState('review') // review | signing | done
  const [errorMsg, setErrorMsg] = useState('')

  // Normalise both draft formats:
  // - CLI format: { permissions: [{address, label, explanation?}] }
  // - Legacy format: { items: [{template, explanation}] }
  const items = (draft.items ?? []).length > 0
    ? draft.items
    : (draft.permissions ?? []).map((p) => ({
        template: p.address,
        explanation: p.label,
        address: p.address,
        permExplanation: p.explanation ?? null,
      }))

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

  const wrongChain = isConnected && walletChainId !== draft.chainId

  async function onReject() {
    await fetch('/api/mandate-draft', { method: 'DELETE' }).catch(() => {})
    window.location.hash = '#/dashboard'
  }

  async function onSwitchChain() {
    try {
      await switchChainAsync({ chainId: draft.chainId })
    } catch (err) {
      setErrorMsg(err?.shortMessage || err?.message || 'Could not switch network')
    }
  }

  async function onSign() {
    if (phase === 'signing') return
    setErrorMsg('')
    setPhase('signing')
    try {
      const permissions = items.map((it) => it.template)

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
        // Send the exact signed permissions (in order) + deadline so the server
        // can submit registerPermissions on-chain with the matching message.
        body: JSON.stringify({
          signature,
          signedAt: new Date().toISOString(),
          permissions,
          deadline: deadline.toString(),
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.error || `Submit failed (${res.status})`)
      }

      setPhase('done')
    } catch (err) {
      setErrorMsg(err?.shortMessage || err?.message || 'Signing failed')
      setPhase('review')
    }
  }

  const content = phase === 'done' ? (
    <MandateSignedCard draft={draft} />
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
          <MandatePreviewSummary draft={draft} items={items} />
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
            {items.map((it, i) => (
              <PermissionRow key={i} item={it} chainId={draft.chainId} />
            ))}
          </ul>

          {draft.registrationFee && <RegistrationFeeNote fee={draft.registrationFee} />}

          {errorMsg && (
            <p style={{ color: '#ff6b6b', fontSize: 13, margin: '8px 0' }}>{errorMsg}</p>
          )}

          {wrongChain ? (
            <>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '0 0 10px' }}>
                Your wallet is on a different network. Switch to sign this mandate.
              </p>
              <div className={styles.actionRow}>
                <SailButton fullWidth onClick={onSwitchChain}>
                  Switch to {(() => { try { return getChain(draft.chainId).name } catch { return `Chain ${draft.chainId}` } })()}
                </SailButton>
                <button type="button" className={styles.rejectBtn} onClick={onReject}>Reject</button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.actionRow}>
                <SailButton fullWidth onClick={onSign} disabled={phase === 'signing'}>
                  {phase === 'signing' ? 'Waiting for wallet…' : 'Sign mandate'}
                </SailButton>
                <button type="button" className={styles.rejectBtn} onClick={onReject} disabled={phase === 'signing'}>Reject</button>
              </div>
              <p className={styles.fineprint}>
                Revocable on-chain at any time from your dashboard.
              </p>
            </>
          )}
        </>
      )}
    </GlassCard>
  )

  if (embedded) {
    return <div className={styles.embeddedFlow}>{content}</div>
  }

  return (
    <div className={styles.shell}>
      <HorizonBackground />
      <HeaderBar state={phase === 'done' ? 'confirming' : 'review'} />
      <main className={styles.stage}>
        <div className={styles.stageInner}>
          {content}
        </div>
      </main>
    </div>
  )
}

/* ─────────── Mandate preview summary (F10) ───────────
   A plain-language header shown before signing so the user — especially when an
   LLM authored the setup — knows what they are authorizing: how many action
   types, on which account/network, and the guarantees that bound it. The
   permission rows below carry the per-permission detail; this is the recital. */
function MandatePreviewSummary({ draft, items }) {
  const networkName = (() => {
    try { return getChain(draft.chainId).name } catch { return `Chain ${draft.chainId}` }
  })()
  const n = items.length
  const acct = draft.account
    ? `${draft.account.slice(0, 6)}…${draft.account.slice(-4)}`
    : '—'

  const factStyle = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }
  const dtStyle = { color: 'rgba(255,255,255,0.45)' }
  const ddStyle = { color: 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }

  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '12px 14px',
        margin: '4px 0 12px',
        background: 'rgba(255,255,255,0.02)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,0.92)' }}>
        You're authorizing your agent to perform{' '}
        <strong>{n} bounded action type{n === 1 ? '' : 's'}</strong> on{' '}
        <strong>{networkName}</strong>. Each is constrained by the rules below.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={factStyle}><span style={dtStyle}>Account (SMA)</span><span style={ddStyle}>{acct}</span></div>
        <div style={factStyle}><span style={dtStyle}>Network</span><span style={ddStyle}>{networkName}</span></div>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li style={{ fontSize: 12.5, color: 'rgba(120,220,160,0.95)' }}>✓ Revocable on-chain anytime from your dashboard</li>
        <li style={{ fontSize: 12.5, color: 'rgba(120,220,160,0.95)' }}>✓ Sail never holds your keys or funds — you sign every authorization</li>
        <li style={{ fontSize: 12.5, color: 'rgba(255,180,120,0.95)' }}>✗ The agent cannot act outside the permissions listed below</li>
      </ul>
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

/* ── Mandate signed: contextual done state ── */
function MandateSignedCard({ draft }) {
  const [copied, setCopied] = useState(false)
  const permCount = (draft?.items ?? draft?.permissions ?? []).length
  const safeShort = draft?.account ? `${draft.account.slice(0, 10)}…${draft.account.slice(-6)}` : null
  const prompt = `My mandate is signed on Safe ${draft?.account ?? 'my Safe'}. ${permCount} permission${permCount === 1 ? '' : 's'} registered. Now deploy and start the agent — use SAIL_PASSPHRASE from my config and run sailor run.`

  function copy() {
    navigator?.clipboard?.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <GlassCard className={styles.welcomeCard}>
      <div className={styles.cardSai} aria-hidden>
        <Sai size={64} animate />
      </div>
      <header className={styles.cardHeader}>
        <span className={styles.kicker}>MANDATE SIGNED</span>
        <h1 className={`${shared.displayHeadline} ${styles.cardHeadline}`}>
          Permissions registered.
        </h1>
        <p className={`${shared.italicMannerism} ${styles.cardTagline}`}>
          {permCount} permission{permCount === 1 ? '' : 's'} authorized
          {safeShort ? ` on ${safeShort}` : ''}.
          Tell your AI to start the agent.
        </p>
      </header>
      <div className={styles.mandateSignedPrompt}>
        <span className={styles.mandateSignedPromptLabel}>Copy prompt for your AI</span>
        <p className={styles.mandateSignedPromptText}>"{prompt}"</p>
        <button type="button" className={styles.mandateSignedCopyBtn} onClick={copy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className={styles.welcomeCta}>
        <SailButton fullWidth onClick={() => { window.location.hash = '#/dashboard' }}>
          Go to dashboard
        </SailButton>
      </div>
    </GlassCard>
  )
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}
