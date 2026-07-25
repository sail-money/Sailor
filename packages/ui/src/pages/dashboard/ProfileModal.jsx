import { useEffect, useState } from 'react'
import styles from './ProfileModal.module.css'
import ChainGlyph from '../shared/ChainGlyph'
import { chainDisplayName, chainSafePrefix, slugToChainId } from '../../lib/chains'

function truncate(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// Safe app deep-link; the chain's Safe prefix comes from the SDK registry
// (chainSafePrefix), defaulting to Ethereum mainnet for unknown chains.
function safeAppUrl(network, address) {
  const id = typeof network === 'number' ? network : slugToChainId(network)
  return `https://app.safe.global/home?safe=${chainSafePrefix(id)}:${address}`
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

export default function ProfileModal({
  open,
  wallet,
  safes = [],
  currentSafeId,
  hasSMA = true,
  accountLoading = false,
  onClose,
  onDisconnect,
  onCreateSMA,
  onImportSMA,
  onRenameSafe,
  onSelectSafe,
  onSetExecutable,
}) {
  const [closing, setClosing] = useState(false)
  const [copiedKey, setCopiedKey] = useState(null) // 'eoa' | sma.id | null
  const [editingId, setEditingId] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [manualImport, setManualImport] = useState(false)
  const [importAddr, setImportAddr] = useState('')
  const [importChain, setImportChain] = useState('8453')
  const [importErr, setImportErr] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleClose() {
    setClosing(true)
    setTimeout(() => {
      setClosing(false)
      // Reset transient state so reopening shows the list/empty state, not a
      // stale half-filled address form or a leftover rename input.
      setManualImport(false)
      setImportAddr('')
      setImportErr('')
      setEditingId(null)
      onClose?.()
    }, 320)
  }

  function copy(key, value) {
    if (!value || !navigator?.clipboard?.writeText) return // don't claim "copied" without a clipboard
    navigator.clipboard.writeText(value)
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

          {/* Race guard: right after a hard refresh /api/account may not have
              resolved yet — don't flash "No SMA created yet" at a user who has
              one; hold a neutral placeholder until the account load settles. */}
          {visibleSafes.length === 0 && accountLoading ? (
            <div className={styles.noSMA}>
              <span className={styles.noSMASub}>Loading accounts…</span>
            </div>
          ) : visibleSafes.length > 0 ? (
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
                        {sma.executable && !isEditing && (
                          <span className={styles.smaPrimaryBadge} title="sailor run executes against this SMA">Agent runs here</span>
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
                        {/* Chain badges: brand glyphs from networkIds when the
                            record carries chain ids; multichain rows collapse
                            to the glyph row + "Multichain". Records without
                            ids (legacy shape) keep the old name-keyed dots. */}
                        {sma.networkIds && sma.networkIds.length > 1 ? (
                          <>
                            <span className={styles.smaNetGlyphs} aria-hidden>
                              {sma.networkIds.slice(0, 5).map((id) => (
                                <ChainGlyph key={id} chainId={id} size={12} />
                              ))}
                            </span>
                            {sma.networkIds.length > 5 && (
                              <span className={styles.smaNetMore}>+{sma.networkIds.length - 5}</span>
                            )}
                            <span className={styles.smaNetName}>Multichain</span>
                          </>
                        ) : sma.networkIds && sma.networkIds.length === 1 ? (
                          <>
                            <ChainGlyph chainId={sma.networkIds[0]} size={12} />
                            <span className={styles.smaNetName}>
                              {sma.networkIds?.[0] != null ? chainDisplayName(sma.networkIds[0]) : capitalize(sma.network)}
                            </span>
                          </>
                        ) : sma.networks && sma.networks.length > 1 ? (
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
                          {sma.mandateCount} {sma.mandateCount === 1 ? 'permission' : 'permissions'}
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
                        {(sma.networkIds?.length ?? sma.networks?.length ?? 1) > 1
                          ? ` · ${capitalize(sma.network)} (home)`
                          : ` · ${capitalize(sma.network)}`}
                      </span>
                    </span>
                    <ArrowOutIcon />
                  </a>

                  {/* Point `sailor run` at this SMA without changing the UI selection.
                      Hidden on the SMA that is already the agent's run target. */}
                  {!sma.executable && onSetExecutable && (
                    <button
                      type="button"
                      className={styles.smaSafeLink}
                      onClick={(e) => { e.stopPropagation(); onSetExecutable(sma) }}
                      aria-label={`Make ${sma.name} the SMA the agent runs against`}
                    >
                      <span className={styles.smaSafeLinkLabel}>Run agent here</span>
                    </button>
                  )}
                </li>
                )
              })}
              {manualImport && (
                <li className={styles.smaImportSection}>
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
                      <button type="button" className={styles.smaImportConfirm} onClick={handleManualImport}>Add SMA</button>
                      <button type="button" className={styles.smaImportBack} onClick={() => { setManualImport(false); setImportErr('') }}>← Back</button>
                    </div>
                  </div>
                </li>
              )}
              <li className={styles.smaActionRow}>
                <button type="button" className={styles.smaActionBtn} onClick={onCreateSMA}>
                  <span className={styles.smaActionIcon} aria-hidden>+</span>
                  Create new SMA
                </button>
                {!manualImport && (
                  <button
                    type="button"
                    className={styles.smaActionBtn}
                    onClick={() => { setManualImport(true); setImportErr('') }}
                  >
                    <span className={styles.smaActionIcon} aria-hidden>↓</span>
                    Add by address
                  </button>
                )}
              </li>
            </ul>
          ) : manualImport ? (
            /* Add-by-address must be reachable with ZERO SMAs too: a wallet that
               already owns SMAs elsewhere has no auto-lookup yet (that's the
               backend owner-lookup — see FOR_ALVARO.md §2), so this is the only
               way to load an existing SMA into a fresh project. */
            <div className={styles.smaImportManual}>
              <input
                className={styles.smaImportInput}
                type="text"
                placeholder="SMA address  0x…"
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
                <button type="button" className={styles.smaImportConfirm} onClick={handleManualImport}>Add SMA</button>
                <button type="button" className={styles.smaImportBack} onClick={() => { setManualImport(false); setImportErr('') }}>← Back</button>
              </div>
            </div>
          ) : (
            <div className={styles.noSMA}>
              <div className={styles.noSMAHead}>
                <span className={styles.noSMAIcon} aria-hidden>
                  <VaultGlyph />
                </span>
                <span className={styles.noSMATitle}>No SMA in this project yet</span>
              </div>
              <span className={styles.noSMASub}>
                Create a new SMA owned by this wallet, or add one you already own by address.
              </span>
              <button
                type="button"
                className={styles.noSMACta}
                onClick={onCreateSMA}
              >
                Create new SMA
                <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 7h8M8 4l3 3-3 3" />
                </svg>
              </button>
              <button
                type="button"
                className={styles.smaImportLink}
                onClick={() => { setManualImport(true); setImportErr('') }}
              >
                Already have an SMA? Add it by address →
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

