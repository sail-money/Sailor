import { useEffect, useMemo, useState } from 'react'
import { nativeCurrencySymbol } from '../../lib/explorer'
import { CHAIN_LABELS } from './SandboxBanner'
import GlassCard from './GlassCard'
import SailButton from './SailButton'
import styles from './SandboxSettingsModal.module.css'

const DEFAULT_GAS_ETH = '1'
const DEFAULT_USDC_AMOUNT = '1000'

function truncate(addr) {
  if (!addr || addr.length < 12) return addr ?? ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function chainLabel(chainId, forks) {
  const chain = forks?.[String(chainId)]?.chain
  return (chain && CHAIN_LABELS[chain]) || `Chain ${chainId}`
}

/** True for a plain positive decimal string ("0.1", "1000", "5"). Amounts
 *  are validated as strings (not routed through `Number`) so an 18-decimal
 *  ETH amount doesn't lose precision on its way to the fund endpoint. */
function isPositiveDecimal(value) {
  return /^\d+(\.\d+)?$/.test(String(value).trim()) && Number(value) > 0
}

/** Chains this account can plausibly be funded on: its deployedChains (or
 *  just its active chainId, for legacy records without the list) narrowed
 *  down to whichever of those actually have a ready fork right now — funding
 *  a chain with no live fork has nothing to write to. */
function fundableChains(account, forks) {
  const candidates = account.deployedChains?.length ? account.deployedChains : [account.chainId]
  return candidates.filter((id) => forks?.[String(id)]?.status === 'ready')
}

/**
 * Settings panel for a sandbox project, opened from the banner's gear
 * button. Three project-level controls that only make sense against a fake,
 * disposable local fork — none of these exist (or could exist) in the live
 * dashboard:
 *   - Reset: wipe this sandbox's SMA/mandate/activity/keys back to a blank
 *     project (backed up, not deleted) and restart forks clean.
 *   - Fund gas: set an agent wallet's native balance directly.
 *   - Fund USDC: write a chosen SMA's USDC balance directly.
 */
export default function SandboxSettingsModal({ open, onClose, forks, onReset }) {
  const [accounts, setAccounts] = useState([])
  const [accountsLoading, setAccountsLoading] = useState(false)

  const [resetChecked, setResetChecked] = useState(false)
  const [resetStep, setResetStep] = useState('idle') // idle | pending | done
  const [resetError, setResetError] = useState('')
  const [backupDir, setBackupDir] = useState(null)

  const [gasForms, setGasForms] = useState({}) // manager address -> { chainId, amountEth, status, error }

  const [usdcSafe, setUsdcSafe] = useState('')
  const [usdcChainId, setUsdcChainId] = useState('')
  const [usdcAmount, setUsdcAmount] = useState(DEFAULT_USDC_AMOUNT)
  const [usdcStatus, setUsdcStatus] = useState('idle') // idle | pending | done
  const [usdcError, setUsdcError] = useState('')

  useEffect(() => {
    if (!open) return
    setResetChecked(false)
    setResetStep('idle')
    setResetError('')
    setBackupDir(null)
    setGasForms({})
    setUsdcStatus('idle')
    setUsdcError('')

    setAccountsLoading(true)
    fetch('/api/accounts', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setAccounts(Array.isArray(list) ? list : []))
      .catch(() => setAccounts([]))
      .finally(() => setAccountsLoading(false))

    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Default the USDC form's SMA/chain once accounts load.
  useEffect(() => {
    if (!accounts.length) return
    setUsdcSafe((prev) => prev || accounts[0].safe)
  }, [accounts])

  useEffect(() => {
    if (!usdcSafe) return
    const account = accounts.find((a) => a.safe === usdcSafe)
    const chains = account ? fundableChains(account, forks) : []
    if (chains.length && !chains.includes(Number(usdcChainId))) setUsdcChainId(String(chains[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usdcSafe, accounts, forks])

  const usdcChains = useMemo(() => {
    const account = accounts.find((a) => a.safe === usdcSafe)
    return account ? fundableChains(account, forks) : []
  }, [accounts, usdcSafe, forks])

  if (!open) return null

  function gasForm(address, account) {
    const chains = fundableChains(account, forks)
    const defaults = { chainId: chains[0] ? String(chains[0]) : '', amountEth: DEFAULT_GAS_ETH, status: 'idle', error: '' }
    return { ...defaults, ...gasForms[address] }
  }

  function updateGasForm(address, patch) {
    setGasForms((prev) => ({ ...prev, [address]: { ...prev[address], ...patch } }))
  }

  async function handleFundGas(address, account) {
    const form = gasForm(address, account)
    const chainId = Number(form.chainId)
    const amountEth = String(form.amountEth).trim()
    if (!Number.isInteger(chainId)) { updateGasForm(address, { status: 'idle', error: 'Pick a chain.' }); return }
    if (!isPositiveDecimal(amountEth)) { updateGasForm(address, { status: 'idle', error: 'Enter a positive amount, e.g. 0.1.' }); return }

    updateGasForm(address, { status: 'pending', error: '' })
    try {
      const res = await fetch('/api/sandbox/fund/native', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId, address, amountEth }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Funding failed.')
      updateGasForm(address, { status: 'done', error: '' })
    } catch (e) {
      updateGasForm(address, { status: 'idle', error: e?.message || String(e) })
    }
  }

  async function handleFundUsdc() {
    const chainId = Number(usdcChainId)
    const amount = String(usdcAmount).trim()
    if (!usdcSafe) { setUsdcError('Pick an SMA.'); return }
    if (!Number.isInteger(chainId)) { setUsdcError('Pick a chain.'); return }
    if (!isPositiveDecimal(amount)) { setUsdcError('Enter a positive amount, e.g. 100.'); return }

    setUsdcStatus('pending')
    setUsdcError('')
    try {
      const res = await fetch('/api/sandbox/fund/usdc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId, safe: usdcSafe, amount }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Funding failed.')
      setUsdcStatus('done')
    } catch (e) {
      setUsdcStatus('idle')
      setUsdcError(e?.message || String(e))
    }
  }

  async function handleReset() {
    setResetStep('pending')
    setResetError('')
    try {
      const res = await fetch('/api/sandbox/reset-project', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Reset failed.')
      setBackupDir(data?.backupDir ?? null)
      setResetStep('done')
      onReset?.()
    } catch (e) {
      setResetStep('idle')
      setResetError(e?.message || String(e))
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Sandbox settings" onClick={onClose}>
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>

        <h2 className={styles.title}>Sandbox settings</h2>
        <p className={styles.subtitle}>Project-level controls for this local sandbox only — none of this touches a real chain.</p>

        {/* ── Fund gas ─────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Fund gas</h3>
          <p className={styles.sectionCopy}>
            Set an agent wallet's native balance directly on a forked chain. Amount is in whole tokens
            (e.g. 0.1 = 0.1 ETH), not wei — the 18 decimals are handled for you.
          </p>

          {accountsLoading ? (
            <p className={styles.empty}>Loading accounts…</p>
          ) : accounts.length === 0 ? (
            <p className={styles.empty}>No SMA onboarded in this sandbox yet.</p>
          ) : (
            <ul className={styles.rowList}>
              {accounts.map((account) => {
                const form = gasForm(account.manager, account)
                const chains = fundableChains(account, forks)
                return (
                  <li key={account.manager} className={styles.row}>
                    <div className={styles.rowIdentity}>
                      <span className={styles.rowName}>{account.name} agent wallet</span>
                      <code className={styles.rowAddr}>{truncate(account.manager)}</code>
                    </div>
                    <div className={styles.rowControls}>
                      <select
                        className={styles.select}
                        value={form.chainId}
                        onChange={(e) => updateGasForm(account.manager, { chainId: e.target.value })}
                        disabled={chains.length === 0}
                      >
                        {chains.length === 0 && <option value="">No ready fork</option>}
                        {chains.map((id) => <option key={id} value={id}>{chainLabel(id, forks)}</option>)}
                      </select>
                      <div className={styles.amountField}>
                        <input
                          className={styles.amountInput}
                          type="number"
                          min="0"
                          step="any"
                          value={form.amountEth}
                          onChange={(e) => updateGasForm(account.manager, { amountEth: e.target.value })}
                          aria-label={`Amount in ${nativeCurrencySymbol(Number(form.chainId))} — whole tokens, e.g. 0.1`}
                        />
                        <span className={styles.amountUnit}>{nativeCurrencySymbol(Number(form.chainId))}</span>
                      </div>
                      <SailButton
                        variant="secondary"
                        className={styles.rowButton}
                        onClick={() => handleFundGas(account.manager, account)}
                        disabled={form.status === 'pending' || chains.length === 0}
                      >
                        {form.status === 'pending' ? 'Funding…' : form.status === 'done' ? 'Funded ✓' : 'Fund'}
                      </SailButton>
                    </div>
                    {form.error && <p className={styles.rowError}>{form.error}</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* ── Fund USDC ────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Fund USDC</h3>
          <p className={styles.sectionCopy}>
            Write a USDC balance directly onto a chosen SMA. Amount is in whole USDC (e.g. 100 = 100
            USDC), not base units — the 6 decimals are handled for you.
          </p>

          {accounts.length === 0 ? (
            <p className={styles.empty}>No SMA onboarded in this sandbox yet.</p>
          ) : (
            <div className={styles.usdcForm}>
              <select className={styles.select} value={usdcSafe} onChange={(e) => setUsdcSafe(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.safe} value={a.safe}>{a.name} · {truncate(a.safe)}</option>
                ))}
              </select>
              <select
                className={styles.select}
                value={usdcChainId}
                onChange={(e) => setUsdcChainId(e.target.value)}
                disabled={usdcChains.length === 0}
              >
                {usdcChains.length === 0 && <option value="">No fundable chain</option>}
                {usdcChains.map((id) => <option key={id} value={id}>{chainLabel(id, forks)}</option>)}
              </select>
              <div className={styles.amountField}>
                <input
                  className={styles.amountInput}
                  type="number"
                  min="0"
                  step="any"
                  value={usdcAmount}
                  onChange={(e) => setUsdcAmount(e.target.value)}
                  aria-label="Amount in USDC — whole tokens, e.g. 100"
                />
                <span className={styles.amountUnit}>USDC</span>
              </div>
              <SailButton
                variant="secondary"
                onClick={handleFundUsdc}
                disabled={usdcStatus === 'pending' || usdcChains.length === 0}
              >
                {usdcStatus === 'pending' ? 'Funding…' : usdcStatus === 'done' ? 'Funded ✓' : 'Fund'}
              </SailButton>
            </div>
          )}
          {usdcError && <p className={styles.rowError}>{usdcError}</p>}
        </section>

        {/* ── Reset ────────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Reset sandbox</h3>
          {resetStep === 'done' ? (
            <p className={styles.sectionCopy}>
              Sandbox reset. The SMA, mandate, activity log, and keys were moved to{' '}
              {backupDir ? <code className={styles.backupPath}>{backupDir.split('/').pop()}</code> : 'a backup folder'}, not deleted.
              Reload the page to start onboarding fresh.
            </p>
          ) : (
            <>
              <p className={styles.sectionCopy}>
                Stops every fork and wipes this sandbox's SMA, mandate, activity log, and keys back to a blank
                project. Nothing is deleted — everything is moved into a timestamped backup folder.
              </p>
              <label className={styles.confirmLabel}>
                <input
                  type="checkbox"
                  checked={resetChecked}
                  onChange={(e) => setResetChecked(e.target.checked)}
                  disabled={resetStep === 'pending'}
                />
                I understand this resets the sandbox to a blank project.
              </label>
              {resetError && <p className={styles.rowError}>{resetError}</p>}
              <SailButton
                variant="danger"
                onClick={handleReset}
                disabled={!resetChecked || resetStep === 'pending'}
              >
                {resetStep === 'pending' ? 'Resetting…' : 'Reset sandbox'}
              </SailButton>
            </>
          )}
        </section>
      </GlassCard>
    </div>
  )
}
