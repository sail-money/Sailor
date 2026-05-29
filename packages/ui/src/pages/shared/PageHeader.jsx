import { useEffect, useState } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount, useChains, useDisconnect, useSwitchChain } from 'wagmi'
import Sai from './Sai'
import ChainIcon from './ChainIcon'
import styles from '../station/SigningStation.module.css'
import pmStyles from '../dashboard/ProfileModal.module.css'

function truncate(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M4 4V3a1 1 0 011-1h4.5a1 1 0 011 1v5a1 1 0 01-1 1H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7.4l2.6 2.6L11 4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function WalletModal({ open, wallet, onClose, onDisconnect }) {
  const [closing, setClosing] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function handleClose() {
    setClosing(true)
    setTimeout(() => { setClosing(false); onClose?.() }, 320)
  }

  function copy() {
    if (!wallet) return
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(wallet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  if (!open) return null
  return (
    <>
      <div className={pmStyles.overlay} onClick={handleClose} aria-hidden />
      <aside
        className={`${pmStyles.panel} ${closing ? pmStyles.panelOut : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Account"
      >
        <div className={pmStyles.hero}>
          <div className={pmStyles.avatarRing}>
            <div className={pmStyles.avatar}>{wallet?.slice(2, 4).toUpperCase() ?? 'U'}</div>
          </div>
          <div className={pmStyles.identity}>
            <span className={pmStyles.identityKicker}>EOA · Owner</span>
            <button
              type="button"
              className={pmStyles.identityAddress}
              onClick={copy}
              aria-label="Copy address"
            >
              <span>{truncate(wallet)}</span>
              <span className={pmStyles.identityCopyIcon} aria-hidden>
                {copied ? <CheckIcon /> : <CopyIcon />}
              </span>
            </button>
          </div>
          <button
            type="button"
            className={pmStyles.disconnectPill}
            onClick={onDisconnect}
          >
            Disconnect
          </button>
        </div>
      </aside>
    </>
  )
}


function ChainDropdown({ open, onClose }) {
  const chains = useChains()
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [switching, setSwitching] = useState(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!e.target?.closest?.(`.${styles.chainDropdownWrap}`)) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', key) }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className={styles.chainMenu}>
      <header className={styles.chainMenuHeader}>Switch network</header>
      <ul className={styles.chainMenuList}>
        {chains.map((c) => (
          <li key={c.id}>
            <button type="button"
              className={`${styles.chainOption} ${c.id === chainId ? styles.chainOptionActive : ''}`}
              disabled={switching === c.id}
              onClick={async () => {
                setSwitching(c.id)
                try { await switchChainAsync({ chainId: c.id }) } catch { /* user rejected */ }
                setSwitching(null); onClose()
              }}
            >
              <ChainIcon chainId={c.id} size={18} />
              <span className={styles.chainOptionName}>{c.name}</span>
              {c.id === chainId && <span className={styles.chainCheck}>✓</span>}
              {switching === c.id && <span className={styles.chainSwitching}>…</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function PageHeader({ eyebrow, title, backTo = '#/dashboard', showBack = true }) {
  const [chainOpen, setChainOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const { address: walletAddress, isConnected, chainId } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { disconnect } = useDisconnect()

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button type="button" className={styles.brand}
            onClick={() => { window.location.hash = '#/dashboard' }} aria-label="Go to dashboard">
            <Sai size={48} animate />
          </button>
          <div className={styles.headerTitle}>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h1 className={styles.title}>{title}</h1>
          </div>
        </div>

        <div className={styles.topActionsPill}>
          <div className={styles.chainDropdownWrap}>
            <button type="button" className={styles.notifBtn}
              onClick={() => setChainOpen((v) => !v)}
              aria-label="Switch network">
              {isConnected && chainId
                ? <ChainIcon chainId={chainId} size={20} />
                : <span className={styles.chainIconPlaceholder} />}
            </button>
            <ChainDropdown open={chainOpen} onClose={() => setChainOpen(false)} />
          </div>

          <button type="button" className={styles.avatarBtn}
            onClick={isConnected ? () => setWalletOpen(true) : openConnectModal}
            aria-label={isConnected ? 'Open account' : 'Connect wallet'}>
            <span className={styles.avatarBtnMonogram} aria-hidden>
              {isConnected && walletAddress ? walletAddress.slice(2, 4).toUpperCase() : '—'}
            </span>
            <span className={styles.avatarBtnAddr}>
              {isConnected && walletAddress ? truncate(walletAddress) : 'Connect wallet'}
            </span>
          </button>

          {showBack && (
            <button type="button" className={styles.backBtn}
              onClick={() => { window.location.hash = backTo }}
              aria-label="Go back">
              <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 3L5 7l4 4" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <WalletModal
        open={walletOpen}
        wallet={walletAddress}
        onClose={() => setWalletOpen(false)}
        onDisconnect={() => { setWalletOpen(false); disconnect() }}
      />
    </>
  )
}
