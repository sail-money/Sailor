import { useEffect, useMemo, useState } from 'react'
import styles from './DepositModal.module.css'

/**
 * Deposit / Withdraw modal — ported from sail_full_LOD's Wise-style
 * picker flow with all tier / swap logic stripped out.
 *
 * Deposit:  amount + asset + network → show SMA receiving address
 *           → animate "Funds incoming" → Done.
 * Withdraw: amount + select position + destination address
 *           → animate "Sending to your wallet" → Done.
 */

const COINS = [
  { id: 'usdc', name: 'USDC', color: '#2775CA' },
  { id: 'usdt', name: 'USDT', color: '#26A17B' },
  { id: 'dai',  name: 'DAI',  color: '#F4B731' },
]
const CHAINS = [
  { id: 'arbitrum', name: 'Arbitrum', color: '#28A0F0' },
  { id: 'base',     name: 'Base',     color: '#2151F5' },
  { id: 'ethereum', name: 'Ethereum', color: '#627EEA' },
]

// Mock SMA receiving address (canonical demo address).
const SMA_ADDRESS = '0x3f7d8a91c42b6e0f1d5a3e7c9b2e8c0f76a31a4d'

// Mock positions available to withdraw — could be wired to MOCK_TOKENS later.
const MOCK_POSITIONS = [
  { asset: 'USDC', network: 'Arbitrum', amount: 8453.21 },
  { asset: 'USDT', network: 'Arbitrum', amount: 308.36 },
  { asset: 'DAI',  network: 'Arbitrum', amount: 226.40 },
  { asset: 'USDC', network: 'Base',     amount: 1240.00 },
]

const MIN_DEPOSIT = 0

export default function DepositModal({ open, onClose, mode = 'deposit', sma = null }) {
  const isWithdraw = mode === 'withdraw'
  const title = isWithdraw ? 'Withdraw' : 'Deposit'
  const smaSubtitle = sma
    ? `${isWithdraw ? 'From' : 'To'}: ${sma.name} · ${sma.address.slice(0, 6)}…${sma.address.slice(-4)}`
    : null

  const positions = isWithdraw ? MOCK_POSITIONS : []
  const totalBalance = positions.reduce((s, p) => s + p.amount, 0) || 13384.74

  // Steps:
  //  -1 = method picker (deposit only; withdraw skips)
  //   0 = form (amount + asset + chain + per-method extras)
  //   1 = review
  //   2 = animation (in transit)
  //   3 = success
  const [step, setStep] = useState(isWithdraw ? 0 : -1)
  const [method, setMethod] = useState(isWithdraw ? 'send' : null) // 'send' | 'wallet'
  const initialPos = positions[0]
  const [coin, setCoin] = useState(
    initialPos ? COINS.find((c) => c.name === initialPos.asset) ?? COINS[0] : COINS[0]
  )
  const [chain, setChain] = useState(
    initialPos ? CHAINS.find((c) => c.name === initialPos.network) ?? CHAINS[0] : CHAINS[0]
  )
  const [amount, setAmount] = useState('')
  const [posKey, setPosKey] = useState(
    initialPos ? `${initialPos.asset}-${initialPos.network}` : null
  )
  const [withdrawAddr, setWithdrawAddr] = useState('')
  const [showCoins, setShowCoins] = useState(false)
  const [showChains, setShowChains] = useState(false)
  const [showPositions, setShowPositions] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep(isWithdraw ? 0 : -1)
    setMethod(isWithdraw ? 'send' : null)
    setAmount('')
    setWithdrawAddr('')
    setCopied(false)
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape' && step !== 2) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const fmt = (n) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const numAmount = parseFloat(amount) || 0
  const selectedPosition = isWithdraw && posKey
    ? positions.find((p) => `${p.asset}-${p.network}` === posKey)
    : null
  const maxAvailable = selectedPosition?.amount ?? 0
  const trimmedAddr = withdrawAddr.trim()
  const isAddrValid = /^0x[0-9a-fA-F]{6,}$/.test(trimmedAddr)

  const canContinue = isWithdraw
    ? numAmount > 0 && numAmount <= maxAvailable && !!selectedPosition && isAddrValid
    : numAmount >= MIN_DEPOSIT && numAmount > 0

  function copyAddr() {
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(SMA_ADDRESS)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function startAnimation() {
    setStep(2)
    // simulate onchain settlement
    setTimeout(() => setStep(3), 2200)
  }

  return (
    <div
      className={styles.overlay}
      onClick={step === 3 ? onClose : undefined}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div className={styles.headTitleWrap}>
            <span className={styles.title}>{title}</span>
            {smaSubtitle && (
              <span className={styles.smaContext}>{smaSubtitle}</span>
            )}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* On withdraw, the available-balance hero still makes sense.
            On deposit, repeating the dashboard's hero balance was pure
            noise — removed in favor of a focused single-question modal. */}
        {isWithdraw && (
          <div className={styles.account}>
            <span className={styles.balVal}>
              <span className={styles.balCurrency}>$</span>{fmt(totalBalance)}
            </span>
            <span className={styles.balCaption}>Available to withdraw</span>
          </div>
        )}

        {step === -1 && !isWithdraw && (
          <div className={styles.methodPicker}>
            <p className={styles.methodLabel}>How would you like to fund your SMA?</p>
            {/* Primary, recommended path — connected-wallet deposit. Accented
                blue surface signals "this is the smoother route." */}
            <button
              type="button"
              className={`${styles.methodCard} ${styles.methodCardPrimary}`}
              onClick={() => { setMethod('wallet'); setStep(0) }}
            >
              <span className={styles.methodIcon}>
                <WalletCardIcon />
              </span>
              <span className={styles.methodBody}>
                <span className={styles.methodNameRow}>
                  <span className={styles.methodName}>Deposit from your wallet</span>
                  <span className={styles.methodBadge}>Recommended</span>
                </span>
                <span className={styles.methodSub}>Instant — connect and confirm in one signature.</span>
              </span>
              <ChevronRight />
            </button>
            {/* Secondary path — manual send via address copy. */}
            <button
              type="button"
              className={`${styles.methodCard} ${styles.methodCardSecondary}`}
              onClick={() => { setMethod('send'); setStep(0) }}
            >
              <span className={styles.methodIcon}>
                <SendIcon />
              </span>
              <span className={styles.methodBody}>
                <span className={styles.methodName}>Send from another address</span>
                <span className={styles.methodSub}>Copy your SMA address — USDC, USDT, or DAI on Arbitrum, Base, or Ethereum.</span>
              </span>
              <ChevronRight />
            </button>
          </div>
        )}

        {step === 0 && (
          <div className={styles.flow}>
            <p className={styles.label}>
              {isWithdraw ? 'You receive exactly' : 'Your agent gets exactly'}
            </p>
            <div className={styles.amountRow}>
              <input
                className={styles.amountInput}
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                autoFocus
              />
            </div>
            <div className={styles.usdLine}>
              <span className={styles.usdValue}>${fmt(numAmount)}</span>
              {isWithdraw && (
                <span className={styles.maxSide}>
                  <span className={styles.maxBalance}>
                    <WalletIcon /> {fmt(maxAvailable)}
                  </span>
                  <button
                    type="button"
                    className={styles.maxBtn}
                    disabled={maxAvailable <= 0}
                    onClick={() => setAmount(maxAvailable.toFixed(2))}
                  >
                    MAX
                  </button>
                </span>
              )}
            </div>

            <div className={styles.divider} />

            {isWithdraw ? (
              <Dropdown
                title="From position"
                open={showPositions}
                onToggle={() => {
                  setShowPositions((v) => !v)
                  setShowCoins(false)
                  setShowChains(false)
                }}
                trigger={
                  selectedPosition ? (
                    <>
                      <span
                        className={styles.coinDot}
                        style={{ background: (COINS.find((c) => c.name === selectedPosition.asset)?.color) ?? '#2775CA' }}
                      />
                      <span className={styles.dropdownVal}>
                        {selectedPosition.asset}
                        <span className={styles.dropdownSub}> on {selectedPosition.network}</span>
                      </span>
                      <span className={styles.posAmount}>{fmt(selectedPosition.amount)}</span>
                    </>
                  ) : (
                    <span className={styles.dropdownVal}>Select position</span>
                  )
                }
              >
                {positions.map((p) => {
                  const k = `${p.asset}-${p.network}`
                  const cMatch = COINS.find((c) => c.name === p.asset) ?? COINS[0]
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`${styles.dropdownItem} ${posKey === k ? styles.dropdownItemActive : ''}`}
                      onClick={() => {
                        setPosKey(k)
                        setCoin(cMatch)
                        setChain(CHAINS.find((c) => c.name === p.network) ?? CHAINS[0])
                        setShowPositions(false)
                        if (numAmount > p.amount) setAmount(p.amount.toFixed(2))
                      }}
                    >
                      <span className={styles.radio}>
                        {posKey === k && <span className={styles.radioDot} />}
                      </span>
                      <span className={styles.coinDot} style={{ background: cMatch.color }} />
                      <span className={styles.dropdownItemName}>
                        {p.asset}
                        <span className={styles.dropdownSub}> on {p.network}</span>
                      </span>
                      <span className={styles.posAmount}>{fmt(p.amount)}</span>
                    </button>
                  )
                })}
              </Dropdown>
            ) : (
              <>
                <Dropdown
                  title="Choose asset"
                  open={showCoins}
                  onToggle={() => { setShowCoins((v) => !v); setShowChains(false) }}
                  trigger={
                    <>
                      <span className={styles.coinDot} style={{ background: coin.color }} />
                      <span className={styles.dropdownVal}>{coin.name}</span>
                    </>
                  }
                >
                  {COINS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`${styles.dropdownItem} ${coin.id === c.id ? styles.dropdownItemActive : ''}`}
                      onClick={() => { setCoin(c); setShowCoins(false) }}
                    >
                      <span className={styles.radio}>
                        {coin.id === c.id && <span className={styles.radioDot} />}
                      </span>
                      <span className={styles.coinDot} style={{ background: c.color }} />
                      <span className={styles.dropdownItemName}>{c.name}</span>
                    </button>
                  ))}
                </Dropdown>

                <Dropdown
                  title="Choose network"
                  open={showChains}
                  onToggle={() => { setShowChains((v) => !v); setShowCoins(false) }}
                  trigger={
                    <>
                      <span className={styles.coinDot} style={{ background: chain.color }} />
                      <span className={styles.dropdownVal}>{chain.name}</span>
                    </>
                  }
                >
                  {CHAINS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`${styles.dropdownItem} ${chain.id === c.id ? styles.dropdownItemActive : ''}`}
                      onClick={() => { setChain(c); setShowChains(false) }}
                    >
                      <span className={styles.radio}>
                        {chain.id === c.id && <span className={styles.radioDot} />}
                      </span>
                      <span className={styles.coinDot} style={{ background: c.color }} />
                      <span className={styles.dropdownItemName}>{c.name}</span>
                    </button>
                  ))}
                </Dropdown>
              </>
            )}

            {!isWithdraw && method === 'send' && (
              <>
                <div className={styles.divider} />
                <div className={styles.addrBlock}>
                  <span className={styles.addrCaption}>Send to your SMA</span>
                  <button type="button" className={styles.addrCopy} onClick={copyAddr}>
                    <span className={styles.addrMono}>{truncate(SMA_ADDRESS)}</span>
                    <span className={styles.addrCopyLabel}>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </>
            )}

            {!isWithdraw && method === 'wallet' && (
              <>
                <div className={styles.divider} />
                <div className={styles.walletConnectedRow}>
                  <span className={styles.walletConnectedDot} aria-hidden />
                  <span className={styles.walletConnectedText}>
                    Connected — <span className={styles.walletConnectedAddr}>{truncate(SMA_ADDRESS)}</span>
                  </span>
                </div>
              </>
            )}

            {isWithdraw && (
              <>
                <div className={styles.divider} />
                <div className={styles.addrBlock}>
                  <span className={styles.addrCaption}>Destination address</span>
                  <input
                    type="text"
                    inputMode="text"
                    spellCheck={false}
                    autoComplete="off"
                    className={styles.addrInput}
                    placeholder="0x…"
                    value={withdrawAddr}
                    onChange={(e) => setWithdrawAddr(e.target.value)}
                  />
                  {trimmedAddr.length > 0 && !isAddrValid && (
                    <span className={styles.addrError}>Enter a valid 0x… address.</span>
                  )}
                </div>
              </>
            )}

            <button
              type="button"
              className={styles.cta}
              disabled={!canContinue}
              onClick={() => setStep(1)}
            >
              Continue
            </button>
            {!isWithdraw && (
              <button
                type="button"
                className={styles.subtleBack}
                onClick={() => { setStep(-1); setMethod(null) }}
              >
                ← Change deposit method
              </button>
            )}
          </div>
        )}

        {step === 1 && (
          <div className={styles.review}>
            <span className={styles.reviewKicker}>Review</span>
            <dl className={styles.reviewList}>
              <Row k={isWithdraw ? 'Withdrawing' : 'Depositing'} v={`${fmt(numAmount)} ${coin.name}`} />
              <Row k="Network" v={chain.name} />
              {isWithdraw && <Row k="From position" v={`${selectedPosition.asset} on ${selectedPosition.network}`} />}
              {isWithdraw && <Row k="To wallet" v={truncate(trimmedAddr)} mono />}
              {!isWithdraw && <Row k="To" v={`SMA ${truncate(SMA_ADDRESS)}`} mono />}
              <Row k="Estimated gas" v="$0.18" accent />
            </dl>
            <div className={styles.reviewActions}>
              <button type="button" className={styles.ctaGhost} onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className={styles.cta} onClick={startAnimation}>
                {isWithdraw
                  ? `Withdraw $${fmt(numAmount)}`
                  : method === 'wallet'
                  ? `Confirm in wallet · $${fmt(numAmount)}`
                  : `Show address · $${fmt(numAmount)}`}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className={styles.animation}>
            <DepositAnimation mode={isWithdraw ? 'withdraw' : 'deposit'} coin={coin} />
            <span className={styles.animLabel}>
              {isWithdraw
                ? 'Sending to your wallet…'
                : method === 'wallet'
                ? 'Confirming in your wallet…'
                : 'Waiting for your deposit…'}
            </span>
          </div>
        )}

        {step === 3 && (
          <div className={styles.success}>
            <span className={styles.successCheck}>
              <svg viewBox="0 0 32 32" width="44" height="44" aria-hidden>
                <circle cx="16" cy="16" r="14" fill="none" stroke="var(--accent-blue)" strokeWidth="2" />
                <path d="M9 16.5l4.5 4.5L23 11" fill="none" stroke="var(--accent-blue)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className={styles.successTitle}>
              {isWithdraw ? 'Withdrawal sent' : 'Deposit confirmed'}
            </span>
            <span className={styles.successBody}>
              {isWithdraw
                ? `$${fmt(numAmount)} ${coin.name} will arrive in your wallet shortly.`
                : method === 'wallet'
                ? `$${fmt(numAmount)} ${coin.name} on ${chain.name} is on its way to your SMA.`
                : `Send your ${coin.name} on ${chain.name} to the SMA address — we'll mark it confirmed on arrival.`}
            </span>
            <button type="button" className={styles.cta} onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────
   Dropdown — reusable picker (asset / network / position)
   ────────────────────────────────────────────── */
function Dropdown({ title, trigger, open, onToggle, children }) {
  return (
    <div className={styles.dropdownWrap}>
      <p className={styles.pickerTitle}>{title}</p>
      <button
        type="button"
        className={`${styles.dropdownTrigger} ${open ? styles.dropdownOpen : ''}`}
        onClick={onToggle}
      >
        {trigger}
        <svg className={styles.dropdownChevron} width="14" height="14" viewBox="0 0 14 8" fill="none">
          <path d="M1 1l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className={styles.dropdownList}>{children}</div>}
    </div>
  )
}

function Row({ k, v, accent, mono }) {
  return (
    <div className={styles.reviewRow}>
      <dt className={styles.reviewK}>{k}</dt>
      <dd
        className={`${styles.reviewV} ${accent ? styles.reviewVAccent : ''} ${mono ? styles.reviewVMono : ''}`}
      >
        {v}
      </dd>
    </div>
  )
}

/* Slim "funds in transit" animation — three dots traveling across a track. */
function DepositAnimation({ mode, coin }) {
  return (
    <div className={styles.animTrack}>
      <span className={styles.animPip} style={{ background: coin.color, animationDelay: '0s' }} />
      <span className={styles.animPip} style={{ background: coin.color, animationDelay: '0.18s' }} />
      <span className={styles.animPip} style={{ background: coin.color, animationDelay: '0.36s' }} />
    </div>
  )
}

function WalletIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 5h12v8H2zM2 5l2-2h8l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
      <circle cx="11.5" cy="9" r="0.9" fill="currentColor" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22 2L11 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 2L15 22l-4-9-9-4 20-7z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function WalletCardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="7" width="20" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="16" cy="14" r="2" fill="currentColor" />
      <path d="M2 11h20" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function truncate(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
