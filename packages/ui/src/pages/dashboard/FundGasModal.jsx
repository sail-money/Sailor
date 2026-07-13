import { useEffect, useState } from 'react'
import { GlassCard, SailButton } from '../shared'
import { nativeCurrencySymbol } from '../../lib/explorer'
import styles from './FundGasModal.module.css'

export default function FundGasModal({ open, onClose, signer, network, chainId }) {
  const [copied, setCopied] = useState(false)
  const nativeSymbol = nativeCurrencySymbol(chainId)

  useEffect(() => {
    if (!open) return
    setCopied(false)
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const networkLabel = network
    ? network.charAt(0).toUpperCase() + network.slice(1)
    : null

  function copyAddress() {
    if (!navigator?.clipboard?.writeText) return // don't claim "copied" without a clipboard
    navigator.clipboard.writeText(signer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Fund gas"
      onClick={onClose}
    >
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>

        <section className={styles.body}>
          <span className={styles.kicker}>FUND GAS</span>

          {/* Funding is copy-and-send, not an in-app transfer: the wallet holds
              only gas, so we hand the user the address to top up from any wallet
              or exchange — mirroring how the SMA itself is funded. */}
          <h2 className={styles.headline}>Send {nativeSymbol} to this address.</h2>
          <p className={styles.sub}>
            This wallet holds only gas so the agent can sign and submit
            transactions. Top it up by sending {nativeSymbol} here from any wallet
            or exchange{networkLabel ? ` on ${networkLabel}` : ''}.
          </p>

          <div className={styles.addrBlock}>
            <div className={styles.addrRow}>
              <code className={styles.addrValueFull}>{signer.address}</code>
            </div>
          </div>

          <SailButton fullWidth onClick={copyAddress}>
            {copied ? 'Copied ✓' : 'Copy address'}
          </SailButton>
        </section>
      </GlassCard>
    </div>
  )
}
