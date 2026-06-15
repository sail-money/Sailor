import { useEffect, useState } from 'react'
import styles from './ProfileModal.module.css'
import { useDiscoverSafes } from '../../hooks/useSailorData'

function truncate(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/* Map a network id to Safe's app.safe.global chain prefix. Safe uses
   short chain codes in its deep links (arb1 for arbitrumOne, oeth for
   optimism, etc.). Unknown chains fall back to Ethereum mainnet. */
const SAFE_CHAIN_PREFIX = {
  ethereum: 'eth',
  arbitrum: 'arb1',
  base:     'base',
  unichain: 'unichain',
  optimism: 'oeth',
  polygon:  'matic',
}
function safeAppUrl(network, address) {
  const prefix = SAFE_CHAIN_PREFIX[network] ?? 'eth'
  return `https://app.safe.global/home?safe=${prefix}:${address}`
}

function ArrowOutIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 9 L9 5" />
      <path d="M5.4 5 H9 V8.6" />
    </svg>
  )
}

/**
 * Account panel — EOA at the top, SMAs listed below.
 *
 * The new model: one EOA (the user's wallet, the source of identity)
 * can own multiple SMAs. The panel makes that hierarchy obvious by
 * leading with the EOA hero, then surfacing every SMA the EOA
 * controls as a sibling row.
 *
 * Network chip has been removed — chain context belongs on each
 * individual SMA row, not on the EOA itself.
 */
const CHAIN_NAMES = { 1: 'Ethereum', 10: 'Optimism', 137: 'Polygon', 8453: 'Base', 42161: 'Arbitrum', 130: 'Unichain', 84532: 'Base Sepolia', 421614: 'Arb Sepolia' }

export default function ProfileModal({
  open,
  wallet,
  safes = [],
  currentSafeId,
  hasSMA = true,
  onClose,
  onDisconnect,
  onCreateSMA,
  onImportSMA,
  onRenameSafe,
  onSelectSafe,
}) {
  const [closing, setClosing] = useState(false)
  const [copiedKey, setCopiedKey] = useState(null) // 'eoa' | sma.id | null
  const [editingId, setEditingId] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [manualImport, setManualImport] = useState(false)
  const [importAddr, setImportAddr] = useState('')
  const [importChain, setImportChain] = useState('8453')
  const [importErr, setImportErr] = useState('')
  const { safes: discovered, scanning, done: scanDone } = useDiscoverSafes(wallet, showImport && !manualImport)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleClose() {
    setClosing(true)
    setTimeout(() => { setClosing(false); onClose?.() }, 320)
  }

  function copy(key, value) {
    if (!value) return
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(value)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1400)
  }

  function startEdit(sma) {
    setEditingId(sma.id)
    setDraftName(sma.name)
  }
  function commitEdit() {
    const trimmed = draftName.trim()
    if (editingId && trimmed) onRenameSafe?.(editingId, trimmed)
    setEditingId(null)
  }
  function cancelEdit() { setEditingId(null) }

  function handleImportSafe(safe, chainId) {
    onImportSMA?.({ safe, owner: wallet ?? safe, permissionSigner: wallet ?? safe, manager: wallet ?? safe, chainId, createdAtBlock: '0' })
    setShowImport(false)
    handleClose()
  }

  function handleManualImport() {
    const addr = importAddr.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setImportErr('Enter a valid 0x address.'); return }
    const chainId = Number(importChain)
    if (!chainId) { setImportErr('Enter a valid chain ID.'); return }
    handleImportSafe(addr, chainId)
  }

  if (!open) return null

  const visibleSafes = hasSMA ? safes : []

  return (
    <>
      <div className={styles.overlay} onClick={handleClose} aria-hidden />
      <aside
        className={`${styles.panel} ${closing ? styles.panelOut : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Account"
      >
        {/* EOA hero — the user's wallet, the top of the hierarchy.
            One EOA can manage many SMAs (listed below). */}
        <div className={styles.hero}>
          <div className={styles.avatarRing}>
            <div className={styles.avatar}>{wallet?.slice(2, 4).toUpperCase() ?? 'U'}</div>
          </div>
          <div className={styles.identity}>
            <span className={styles.identityKicker}>EOA · Owner</span>
            <button
              type="button"
              className={styles.identityAddress}
              onClick={() => copy('eoa', wallet)}
              aria-label="Copy EOA address"
            >
              <span>{truncate(wallet)}</span>
              <span className={styles.identityCopyIcon} aria-hidden>
                {copiedKey === 'eoa' ? <CheckIcon /> : <CopyIcon />}
              </span>
            </button>
          </div>
          <button
            type="button"
            className={styles.disconnectPill}
            onClick={onDisconnect ?? handleClose}
          >
            Disconnect
          </button>
        </div>

        <div className={styles.divider} />

        {/* SMAs — every Separately Managed Account this EOA owns. */}
        <section className={styles.smasSection}>
          <header className={styles.smasHead}>
            <span className={styles.smasKicker}>Separately Managed Accounts</span>
            <span className={styles.smasCount}>
              {visibleSafes.length} {visibleSafes.length === 1 ? 'SMA' : 'SMAs'}
            </span>
          </header>

          {visibleSafes.length > 0 ? (
            <ul className={styles.smaList}>
              {visibleSafes.map((sma) => {
                const isCurrent = sma.id?.toLowerCase() === currentSafeId?.toLowerCase()
                const isEditing = sma.id === editingId
                return (
                <li key={sma.id} className={`${styles.smaCard} ${isCurrent ? styles.smaCardPrimary : ''}`}>
                  {/* Identity row: tap anywhere (when not editing) to make
                      this SMA the current one. */}
                  <button
                    type="button"
                    className={styles.smaRow}
                    onClick={() => { if (!isEditing) onSelectSafe?.(sma) }}
                  >
                    <span className={styles.smaIcon} aria-hidden>
                      <VaultGlyph />
                    </span>
                    <span className={styles.smaBody}>
                      <span className={styles.smaTitleRow}>
                        {isEditing ? (
                          <input
                            autoFocus
                            type="text"
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
                              if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                            }}
                            onBlur={commitEdit}
                            className={styles.smaNameInput}
                            maxLength={40}
                            aria-label={`Rename ${sma.name}`}
                          />
                        ) : (
                          <span className={styles.smaName}>{sma.name}</span>
                        )}
                        {isCurrent && !isEditing && (
                          <span className={styles.smaPrimaryBadge}>Current</span>
                        )}
                        {!isEditing && (
                          <span
                            className={styles.smaRename}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); startEdit(sma) }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault(); e.stopPropagation(); startEdit(sma)
                              }
                            }}
                            aria-label={`Rename ${sma.name}`}
                          >
                            <PencilIcon />
                          </span>
                        )}
                      </span>
                      <span className={styles.smaAddress}>{truncate(sma.address)}</span>
                      <span className={styles.smaMeta}>
                        {sma.networks && sma.networks.length > 1 ? (
                          <>
                            <span className={styles.smaNetStack} aria-hidden>
                              {sma.networks.slice(0, 4).map((n) => (
                                <span
                                  key={n}
                                  className={`${styles.smaNetDot} ${styles[`smaNetDot_${n}`] ?? ''}`}
                                />
                              ))}
                            </span>
                            <span className={styles.smaNetName}>Multichain</span>
                          </>
                        ) : (
                          <>
                            <span className={`${styles.smaNetDot} ${styles[`smaNetDot_${sma.network}`] ?? ''}`} aria-hidden />
                            <span className={styles.smaNetName}>{capitalize(sma.network)}</span>
                          </>
                        )}
                        <span className={styles.smaMetaSep} aria-hidden>·</span>
                        <span className={styles.smaAgentCount}>
                          {sma.mandateCount} {sma.mandateCount === 1 ? 'mandate' : 'mandates'}
                        </span>
                      </span>
                    </span>
                    <span
                      className={styles.smaCopy}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); copy(sma.id, sma.address) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault(); e.stopPropagation(); copy(sma.id, sma.address)
                        }
                      }}
                      aria-label={`Copy ${sma.name} address`}
                    >
                      {copiedKey === sma.id ? <CheckIcon /> : <CopyIcon />}
                    </span>
                  </button>

                  {/* Deposit/withdraw flows retired — depositing happens
                      by copying the SMA address above and sending from
                      any wallet. Withdrawal is removed from this surface
                      entirely; users perform it through the Safe app. */}

                  {/* Safe App quick-link — opens this exact SMA in the
                      Safe interface on its home chain. Promoted to the
                      primary action now that deposit/withdraw are gone. */}
                  <a
                    className={styles.smaSafeLink}
                    href={safeAppUrl(sma.network, sma.address)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Open ${sma.name} in the Safe app on ${capitalize(sma.network)}`}
                  >
                    <span className={styles.smaSafeLinkLabel}>
                      Open in Safe
                      <span className={styles.smaSafeLinkChain}>
                        {sma.networks && sma.networks.length > 1
                          ? ` · ${capitalize(sma.network)} (home)`
                          : ` · ${capitalize(sma.network)}`}
                      </span>
                    </span>
                    <ArrowOutIcon />
                  </a>
                </li>
                )
              })}
              <li className={styles.smaActionRow}>
                <button type="button" className={styles.smaActionBtn} onClick={onCreateSMA}>
                  <span className={styles.smaActionIcon} aria-hidden>+</span>
                  Create
                </button>
                <button
                  type="button"
                  className={`${styles.smaActionBtn} ${showImport ? styles.smaActionBtnActive : ''}`}
                  onClick={() => { setShowImport(v => !v); setManualImport(false); setImportErr('') }}
                >
                  <span className={styles.smaActionIcon} aria-hidden>↓</span>
                  Import
                </button>
              </li>
              {showImport && (
                <li className={styles.smaImportSection}>
                  {manualImport ? (
                    <div className={styles.smaImportManual}>
                      <input
                        className={styles.smaImportInput}
                        type="text"
                        placeholder="Safe address  0x…"
                        value={importAddr}
                        onChange={(e) => { setImportAddr(e.target.value); setImportErr('') }}
                        spellCheck={false}
                        autoFocus
                      />
                      <input
                        className={styles.smaImportInput}
                        type="text"
                        placeholder="Chain ID  e.g. 8453"
                        value={importChain}
                        onChange={(e) => { setImportChain(e.target.value); setImportErr('') }}
                      />
                      {importErr && <span className={styles.smaImportErr}>{importErr}</span>}
                      <div className={styles.smaImportActions}>
                        <button type="button" className={styles.smaImportConfirm} onClick={handleManualImport}>Import SMA</button>
                        <button type="button" className={styles.smaImportLink} onClick={() => { setManualImport(false); setImportErr('') }}>← Back</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {scanning && discovered.length === 0 && (
                        <span className={styles.smaImportScan}>Scanning for Safes…</span>
                      )}
                      {discovered.length > 0 && (
                        <ul className={styles.smaImportList}>
                          {discovered.map((s) => (
                            <li key={`${s.chainId}-${s.safe}`}>
                              <button type="button" className={styles.smaImportRow} onClick={() => handleImportSafe(s.safe, s.chainId)}>
                                <span className={styles.smaImportRowAddr}>{truncate(s.safe)}</span>
                                <span className={styles.smaImportRowNet}>{CHAIN_NAMES[s.chainId] ?? `chain ${s.chainId}`}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {scanDone && discovered.length === 0 && (
                        <span className={styles.smaImportScan}>No Safes found for this wallet.</span>
                      )}
                      <button type="button" className={styles.smaImportLink} onClick={() => setManualImport(true)}>Enter address manually</button>
                    </>
                  )}
                </li>
              )}
            </ul>
          ) : (
            <div className={styles.noSMA}>
              <span className={styles.noSMAIcon} aria-hidden>
                <VaultGlyph />
              </span>
              <div className={styles.noSMABody}>
                <span className={styles.noSMAKicker}>Separately Managed Account</span>
                <span className={styles.noSMATitle}>No SMA created yet</span>
                <span className={styles.noSMASub}>
                  Your SMA is deployed when you create your first agent.
                </span>
              </div>
              <button
                type="button"
                className={styles.noSMACta}
                onClick={onCreateSMA}
              >
                Create your first agent
                <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 7h8M8 4l3 3-3 3" />
                </svg>
              </button>
            </div>
          )}
        </section>

      </aside>
    </>
  )
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

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
function WalletGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="2.5" y="5" width="15" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M2.5 9h15" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="14" cy="12.5" r="1" fill="currentColor"/>
    </svg>
  )
}
function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M9.5 1.6l2.9 2.9-7.6 7.6-3.2.4.4-3.2 7.5-7.7z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 2.1l2.9 2.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
function VaultGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2.6" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M10 7v.6M10 13.4v-.6M13 10h-.6M7.6 10H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}
function DepositArrowIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 2.5v6M4.5 6L7 8.5 9.5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 11.2h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}
function WithdrawArrowIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 11.5v-6M4.5 8L7 5.5 9.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 2.8h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

