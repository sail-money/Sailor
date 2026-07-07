import { useEffect, useState } from 'react'
import { useAccount, useSendTransaction, useSwitchChain } from 'wagmi'
import { parseEther } from 'viem'
import { GlassCard, SailButton } from '../shared'
import { nativeCurrencySymbol } from '../../lib/explorer'
import styles from './FundGasModal.module.css'

function short(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'
}

export default function FundGasModal({ open, onClose, signer, network, chainId }) {
  const [amount, setAmount] = useState('0.01')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const { address: fromAddress, chainId: walletChainId } = useAccount()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()
  const nativeSymbol = nativeCurrencySymbol(chainId)

  // True when the connected wallet IS the signer — sending to itself is a no-op.
  const isSelf = fromAddress && signer?.address &&
    fromAddress.toLowerCase() === signer.address.toLowerCase()

  useEffect(() => {
    if (!open) return
    setAmount('0.01')
    setBusy(false)
    setError('')
    setCopied(false)
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const amountValid = amount && /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0
  const networkLabel = network
    ? network.charAt(0).toUpperCase() + network.slice(1)
    : null

  function copyAddress() {
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(signer.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function send() {
    if (!amountValid) return
    setBusy(true)
    setError('')
    try {
      // The agent wallet lives on a specific chain. If the connected wallet is
      // on a different chain, switch it first so the transfer lands on the right
      // network — otherwise it'd fund an address on whatever chain happens to be
      // active. Pin chainId on the send too, so wagmi rejects a stale chain.
      if (chainId && walletChainId !== chainId) await switchChainAsync({ chainId })
      await sendTransactionAsync({ to: signer.address, value: parseEther(amount), ...(chainId ? { chainId } : {}) })
      onClose?.()
    } catch (err) {
      const msg = err?.shortMessage ?? err?.message ?? 'Transaction rejected.'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Fund gas"
      onClick={busy ? undefined : onClose}
    >
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        {!busy && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        )}

        <section className={styles.body}>
          <span className={styles.kicker}>FUND GAS</span>

          {isSelf ? (
            <>
              <h2 className={styles.headline}>Send {nativeSymbol} to this address.</h2>
              <p className={styles.sub}>
                This is your connected wallet — you can't send to yourself.
                Transfer {nativeSymbol} here from an exchange or another wallet
                {networkLabel ? ` on ${networkLabel}` : ''}.
              </p>
              <div className={styles.addrBlock}>
                <div className={styles.addrRow}>
                  <code className={styles.addrValueFull}>{signer.address}</code>
                </div>
              </div>
              <SailButton fullWidth onClick={copyAddress}>
                {copied ? 'Copied ✓' : 'Copy address'}
              </SailButton>
            </>
          ) : (
            <>
              <h2 className={styles.headline}>Top up agent wallet.</h2>
              <p className={styles.sub}>
                The agent signs transactions with its local wallet and pays gas from it.
                Send {nativeSymbol} from your connected wallet to keep it running.
                {networkLabel && ` The transfer happens on ${networkLabel}.`}
              </p>

              <div className={styles.addrBlock}>
                <div className={styles.addrRow}>
                  <span className={styles.addrLabel}>From</span>
                  <code className={styles.addrValue}>{fromAddress ? short(fromAddress) : 'no wallet connected'}</code>
                </div>
                <div className={styles.addrDivider} aria-hidden />
                <div className={styles.addrRow}>
                  <span className={styles.addrLabel}>To · agent wallet</span>
                  <code className={styles.addrValue}>{short(signer.address)}</code>
                </div>
              </div>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Amount</span>
                <div className={styles.amountWrap}>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={styles.amountInput}
                    value={amount}
                    autoFocus
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <span className={styles.amountUnit}>{nativeSymbol}</span>
                </div>
              </label>

              {error && <p className={styles.error}>{error}</p>}

              <SailButton fullWidth onClick={send} disabled={busy || !amountValid}>
                {busy ? 'Check wallet…' : 'Send'}
              </SailButton>
            </>
          )}
        </section>
      </GlassCard>
    </div>
  )
}
