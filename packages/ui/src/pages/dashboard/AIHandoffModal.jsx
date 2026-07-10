import { useEffect, useState } from 'react'
import { GlassCard } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './AIHandoffModal.module.css'

/* Per-provider tints for the "Open in X" handoff buttons. Each button
   carries the provider's brand colour so the user can see at a glance
   which AI they're handing back to. */
const PROVIDER_OPEN_TINTS = {
  claude:  { bg: 'linear-gradient(180deg, #D58066 0%, #BC6849 100%)', border: '#C57458', text: '#FFFFFF', shadow: 'rgba(204, 120, 92, 0.5)' },
  cursor:  { bg: 'linear-gradient(180deg, #DDE3EE 0%, #B5BFD0 100%)', border: '#C9D2E0', text: '#0B0F17', shadow: 'rgba(200, 210, 225, 0.42)' },
  codex:   { bg: 'linear-gradient(180deg, #11B58C 0%, #0D8C6C 100%)', border: '#11A07E', text: '#FFFFFF', shadow: 'rgba(16, 163, 127, 0.5)' },
  // Fallback for when the mandate has no provider attribution — a
  // calm brand-blue button that's still elegant on its own.
  default: { bg: 'linear-gradient(180deg, #2F9CFF 0%, #1378E8 100%)', border: '#2D8EE8', text: '#FFFFFF', shadow: 'rgba(25, 144, 255, 0.5)' },
}

const PROVIDER_URLS = {
  claude:  'claude://',
  cursor:  'cursor://',
  codex:   'chatgpt://',
  default: 'claude://',
}

function resolveProvider(aiName) {
  const n = (aiName ?? '').toLowerCase()
  if (n === 'claude' || n === 'anthropic') return 'claude'
  if (n === 'cursor') return 'cursor'
  if (n === 'codex' || n === 'chatgpt' || n === 'openai' || n === 'gpt') return 'codex'
  return 'default'
}
function ProviderOpenBtn({ provider, onClick, children }) {
  const tint = PROVIDER_OPEN_TINTS[provider]
  const style = {
    '--po-bg': tint.bg,
    '--po-border': tint.border,
    '--po-text': tint.text,
    '--po-shadow': tint.shadow,
  }
  return (
    <button
      type="button"
      className={styles.providerOpenBtn}
      style={style}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function AIHandoffModal({ open, variant = 'new', context = 'agent', mandate = null, onClose }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const isRedraft = variant === 'redraft'
  const isMandate = context === 'mandate'
  const isSigner = context === 'signer'
  const prompt = isRedraft && mandate
    ? `Sailor, redraft my "${mandate.title}" agent. I want to change [describe the change].`
    : isMandate
    ? `Sailor, I want to register a permission that lets my agent swap up to $100 USDC into ETH weekly on Base.`
    : isSigner
    ? `How do I get started with Sailor? I want to set up an agent, deploy a permission contract, and start the signing server.`
    : `Sailor, I want to register a permission that lets my agent swap up to $100 USDC into ETH weekly on Base.`

  // The mandate carries the provider that drafted it ("Claude" / "Cursor"
  // / "Codex"). The hand-off button picks that one provider — the user
  // is going back to the same AI that drafted this agent, not picking
  // a new one. The "run /sail in any client" line below remains as the
  // escape hatch for users who want to switch providers.
  const providerKey = resolveProvider(mandate?.aiName)
  const providerName = mandate?.aiName ?? 'your AI'

  function copyPrompt() {
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>

        <h2 className={`${shared.displayHeadline} ${styles.headline}`}>
          {isRedraft ? 'Send this back to your AI.' : isMandate ? 'Mandates start with your AI.' : isSigner ? 'Get started with your AI.' : 'Agents start with your AI.'}
        </h2>

        <p className={`${shared.italicMannerism} ${styles.lede}`}>
          {isRedraft
            ? 'Tell your AI what to change. It will redraft the agent and a new signature request will appear here.'
            : isMandate
            ? 'A mandate defines the permissions your agents operate under. Your AI drafts it — you sign each permission onchain.'
            : isSigner
            ? 'Ask your AI to walk you through setting up Sailor — from keys and mandates to running your first agent.'
            : 'Your AI drafts the agent strategy. You review and authorize it here before it touches your funds.'}
        </p>

        <div className={styles.promptBlock}>
          <span className={shared.metaLabel}>Try saying</span>
          <p className={styles.prompt}>“{prompt}”</p>
          <button type="button" className={styles.copyBtn} onClick={copyPrompt}>
            {copied ? '✓ Copied' : 'Copy prompt'}
          </button>
        </div>

        <div className={styles.actions}>
          <ProviderOpenBtn
            provider="default"
            onClick={copyPrompt}
          >
            Copy prompt →
          </ProviderOpenBtn>
        </div>

        <p className={styles.foot}>
          Paste this into your AI coding agent (Claude Code, Cursor, Codex, …) to get started.
        </p>
      </GlassCard>
    </div>
  )
}
