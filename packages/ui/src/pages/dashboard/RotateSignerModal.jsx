import { useEffect, useState } from 'react'
import {
  useAccount,
  usePublicClient,
  useSendTransaction,
  useSignTypedData,
  useSwitchChain,
} from 'wagmi'
import { encodeFunctionData, encodePacked, pad, zeroAddress } from 'viem'
import { GlassCard, SailButton } from '../shared'
import styles from './RevokeMandateModal.module.css'
import form from './AddSignerModal.module.css'

const MIN_PASSWORD = 8

// kernel.setManager(newManager) — rotates the SMA's delegated signer. Gated by
// msg.sender == account, so it must be called *through* the Safe.
const SET_MANAGER_ABI = [
  {
    type: 'function',
    name: 'setManager',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newManager', type: 'address' }],
    outputs: [],
  },
]

// Safe v1.4.1 execTransaction — lets the Safe call the kernel as itself.
const SAFE_EXEC_ABI = [
  {
    type: 'function',
    name: 'execTransaction',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
]

// Batch re-approval after rotation rebinds every prior mandate to the new signer.
const REGISTER_ABI = [
  {
    type: 'function',
    name: 'registerPermissions',
    stateMutability: 'payable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'permissions', type: 'address[]' },
      { name: 'deadline', type: 'uint256' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'signerNonces',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
]

const REGISTER_TYPES = {
  RegisterPermissions: [
    { name: 'account', type: 'address' },
    { name: 'permissions', type: 'address[]' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

/**
 * For a 1-of-1 Safe, the sole owner submitting execTransaction can authorise it
 * with a pre-validated (approved-hash) signature: r = owner(32) ‖ s = 0(32) ‖ v=1.
 * Safe accepts it because the recovered owner equals msg.sender. No Safe-tx
 * EIP-712 round-trip and no Safe-nonce dependency.
 */
function approvedHashSignature(owner) {
  return encodePacked(['bytes32', 'bytes32', 'uint8'], [pad(owner, { size: 32 }), pad('0x', { size: 32 }), 1])
}

async function logActivity(event) {
  try {
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  } catch {
    // best-effort — the on-chain action already succeeded
  }
}

/**
 * Rotate the SMA's delegated signer (agent wallet) from the dashboard.
 *
 *   1. Generate a fresh agent keystore on the local server (POST /api/signer).
 *   2. The owner submits Safe.execTransaction → kernel.setManager(new), which
 *      rotates the signer and clears all attached mandates on-chain.
 *   3. The owner re-approves the previously-attached mandates in one batched
 *      RegisterPermissions signature (+ tx), rebinding them to the new signer.
 *
 * Both transactions are submitted by the owner's connected wallet (the sole
 * Safe owner); registerPermissions has an unrestricted msg.sender and these
 * deployments are zero-fee, so no agent-wallet gas is needed.
 */
export default function RotateSignerModal({
  open,
  sma,
  kernel,
  chainId,
  owner,
  currentManager,
  mandates = [],
  initialTo = null,
  onClose,
  onRotated,
}) {
  const { address: walletAddress, chainId: walletChainId } = useAccount()
  const publicClient = usePublicClient({ chainId })
  const { signTypedDataAsync } = useSignTypedData()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()

  const mandateAddrs = (mandates ?? [])
    .map((m) => (typeof m === 'string' ? m : m?.address))
    .filter(Boolean)

  const [step, setStep] = useState('confirm') // confirm | backup | rotating | reattaching | done
  const [mode, setMode] = useState('create') // 'create' | 'import' | 'saved'
  const [importKind, setImportKind] = useState('privateKey') // 'privateKey' | 'mnemonic'
  const [secret, setSecret] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null) // { address, revealed, fromSaved }
  const [copied, setCopied] = useState(false)
  const [rotateTx, setRotateTx] = useState(null)
  const [reattachTx, setReattachTx] = useState(null)
  const [savedSigners, setSavedSigners] = useState(null) // null = not loaded yet
  const [loadingSaved, setLoadingSaved] = useState(false)
  const [selectedSaved, setSelectedSaved] = useState('')

  useEffect(() => {
    if (!open) return
    setStep('confirm')
    setMode(initialTo ? 'saved' : 'create')
    setImportKind('privateKey')
    setSecret('')
    setPassword('')
    setBusy(false)
    setError('')
    setCreated(null)
    setCopied(false)
    setRotateTx(null)
    setReattachTx(null)
    setSavedSigners(null)
    setLoadingSaved(false)
    setSelectedSaved(initialTo ?? '')
    // Opening straight into the "saved" tab bypasses selectMode, which is what
    // normally lazy-loads the list — fetch it here instead.
    if (initialTo) loadSavedSigners()
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy && step !== 'rotating' && step !== 'reattaching') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const ownerAddr = owner ?? walletAddress
  const ownerMismatch =
    walletAddress && ownerAddr && walletAddress.toLowerCase() !== ownerAddr.toLowerCase()

  // Step 1 — provision the new manager on the local server: generate a fresh key,
  // or import an existing one from a private key / recovery phrase. The local
  // server (POST /api/signer) derives + encrypts it into a keystore; the secret
  // never leaves the machine, and only a freshly generated key is revealed once.
  const method = mode === 'create' ? 'generate' : importKind
  const needsSecret = mode === 'import'

  async function provisionKey() {
    setError('')
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (needsSecret && !secret.trim()) {
      setError(importKind === 'privateKey' ? 'Enter a private key.' : 'Enter your recovery phrase.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/signer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, secret: needsSecret ? secret.trim() : undefined, password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed to prepare the new manager wallet.')
      setCreated(json)
      setSecret('')
      setPassword('')
      setStep('backup')
    } catch (err) {
      setError(err?.message || 'Failed to prepare the new manager wallet.')
    } finally {
      setBusy(false)
    }
  }

  // Lazy-load the saved manager keystores the first time the "Use saved" tab is
  // opened. Reads only addresses from the local server — no secrets.
  async function loadSavedSigners() {
    setLoadingSaved(true)
    setError('')
    try {
      const res = await fetch('/api/signers')
      // An older UI server predates this route and serves a 404 HTML page;
      // guard res.ok before parsing so we don't surface a raw JSON error.
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'Saved-manager listing needs an updated Sailor UI — restart it (sailor ui stop && sailor ui).'
            : `Could not list saved managers (HTTP ${res.status}).`,
        )
      }
      const json = await res.json().catch(() => null)
      setSavedSigners(Array.isArray(json?.signers) ? json.signers : [])
    } catch (err) {
      setSavedSigners([])
      setError(err?.message || 'Could not list saved managers.')
    } finally {
      setLoadingSaved(false)
    }
  }

  function selectMode(next) {
    setMode(next)
    setError('')
    if (next === 'saved' && savedSigners === null && !loadingSaved) loadSavedSigners()
  }

  // Saved managers eligible to rotate to: everything except the SMA's current
  // signer (rotating to the same address reverts ManagerUnchanged on-chain).
  const selectableSaved = (savedSigners ?? []).filter(
    (s) => !currentManager || s.address.toLowerCase() !== currentManager.toLowerCase(),
  )

  // "Use saved" path — no key provisioning needed; the keystore already exists.
  // Carry the chosen address into the same confirm/rotate flow as create/import.
  function useSavedManager() {
    setError('')
    const chosen = selectableSaved.find((s) => s.address.toLowerCase() === selectedSaved.toLowerCase())
    if (!chosen) {
      setError('Select a saved manager to rotate to.')
      return
    }
    setCreated({ address: chosen.address, revealed: null, fromSaved: true })
    setStep('backup')
  }

  function copyRevealed() {
    if (created?.revealed && navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(created.revealed)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  // Once a tx is submitted it WILL mine; a flaky receipt read (a lagging
  // load-balanced RPC node) must not be reported as a failed rotation/re-approval
  // and must not skip the state-sync. Retry the receipt fetch a few times.
  async function waitReceipt(hash, tries = 8) {
    let last
    for (let i = 0; i < tries; i++) {
      try {
        return await publicClient.waitForTransactionReceipt({ hash })
      } catch (e) {
        last = e
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    throw last
  }

  // Step 2 — owner submits Safe.execTransaction → setManager(new).
  async function rotate() {
    if (!walletAddress) { setError('Connect your owner wallet first.'); return }
    if (!kernel || !sma || !created?.address) { setError('Missing SMA, kernel, or new signer.'); return }
    setStep('rotating')
    setError('')
    try {
      if (walletChainId !== chainId) await switchChainAsync({ chainId })

      const innerData = encodeFunctionData({
        abi: SET_MANAGER_ABI,
        functionName: 'setManager',
        args: [created.address],
      })
      const execData = encodeFunctionData({
        abi: SAFE_EXEC_ABI,
        functionName: 'execTransaction',
        args: [kernel, 0n, innerData, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, approvedHashSignature(ownerAddr)],
      })
      const hash = await sendTransactionAsync({ to: sma, data: execData, chainId })
      setRotateTx(hash)
      await waitReceipt(hash)

      await logActivity({
        type: 'signer_rotated',
        actor: 'owner',
        sma,
        oldManager: currentManager ?? null,
        newManager: created.address,
        txHash: hash,
        chainId,
      })

      if (mandateAddrs.length > 0) {
        await reattach()
      } else {
        await complete(hash)
      }
    } catch (err) {
      setError(err?.shortMessage || err?.message || 'Rotation transaction rejected.')
      setStep('backup')
    }
  }

  // Step 3 — owner re-approves the prior mandates so they bind to the new signer.
  async function reattach() {
    setStep('reattaching')
    setError('')
    try {
      if (walletChainId !== chainId) await switchChainAsync({ chainId })

      const nonce = await publicClient.readContract({
        address: kernel,
        abi: REGISTER_ABI,
        functionName: 'signerNonces',
        args: [sma],
      })
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

      const signature = await signTypedDataAsync({
        domain: { name: 'SailKernel', version: '1', chainId, verifyingContract: kernel },
        types: REGISTER_TYPES,
        primaryType: 'RegisterPermissions',
        message: { account: sma, permissions: mandateAddrs, nonce, deadline },
      })

      const data = encodeFunctionData({
        abi: REGISTER_ABI,
        functionName: 'registerPermissions',
        args: [sma, mandateAddrs, deadline, signature],
      })
      const hash = await sendTransactionAsync({ to: kernel, data, chainId })
      setReattachTx(hash)
      await waitReceipt(hash)

      await logActivity({
        type: 'mandates_reattached',
        actor: 'owner',
        sma,
        permissions: mandateAddrs,
        txHash: hash,
        chainId,
      })
      await complete(rotateTx)
    } catch (err) {
      // Rotation already landed; surface re-attach failure without losing it.
      setError(
        (err?.shortMessage || err?.message || 'Re-approval rejected.') +
          ' The signer was rotated, but the mandates are not re-approved yet — reopen this to retry.',
      )
      setStep('backup')
    }
  }

  // Step 4 — persist the new manager into account.json + finish. For a saved
  // manager, first point this SMA's local keystore at the chosen key so the
  // agent signs with it (manager-<safe>.json is what `sailor run` loads).
  async function complete(txHash) {
    try {
      if (created?.fromSaved) {
        await fetch('/api/signer/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: created.address }),
        })
      }
      await fetch('/api/manager/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newManager: created?.address, txHash }),
      })
    } catch {
      // best-effort — overview reads the manager from chain regardless
    }
    setStep('done')
    onRotated?.()
  }

  const pending = step === 'rotating' || step === 'reattaching'

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Rotate manager"
      onClick={pending ? undefined : onClose}
    >
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        {!pending && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        )}

        {step === 'done' ? (
          <>
            <h2 className={styles.title}>Manager rotated</h2>
            <p className={styles.body}>
              <strong>{created?.address}</strong> is now this SMA&rsquo;s delegated signer.
              {mandateAddrs.length > 0
                ? ` ${mandateAddrs.length} mandate(s) were re-approved and bound to it.`
                : ' No mandates were attached, so none needed re-approval.'}
            </p>
            <p className={styles.body}>
              Fund the new manager wallet so it can pay gas for dispatches, then restart your agent.
            </p>
            <div className={styles.actions}>
              <SailButton onClick={onClose}>Done</SailButton>
            </div>
          </>
        ) : step === 'backup' ? (
          <>
            <h2 className={styles.title}>
              {created?.revealed ? 'Back up the new manager' : 'New manager ready'}
            </h2>
            <p className={styles.body}>
              {created?.revealed
                ? 'A fresh manager wallet was created and encrypted on disk. Save its private key now — it’s shown only once. Then rotate the SMA to it.'
                : created?.fromSaved
                  ? 'This manager is already saved in this project. Rotate the SMA to it below — its keystore becomes this SMA’s active signer.'
                  : 'Your manager wallet was imported and encrypted on disk. Rotate the SMA to it below.'}
            </p>
            <div className={form.addrPanel}>
              <span className={form.addrLabel}>New manager address</span>
              <code className={form.addrValue}>{created?.address}</code>
            </div>
            {created?.revealed && (
              <div className={form.revealPanel}>
                <span className={form.revealLabel}>Private key — save it now, shown only once</span>
                <code className={form.revealValue}>{created.revealed}</code>
                <button type="button" className={form.copyBtn} onClick={copyRevealed}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
                <p className={form.revealNote}>
                  Anyone with this key controls the signer. Store it in a password manager.
                </p>
              </div>
            )}
            {mandateAddrs.length > 0 && (
              <p className={styles.warn}>
                Rotating clears all {mandateAddrs.length} attached mandate(s); you&rsquo;ll re-approve
                them in your wallet right after, rebinding them to the new signer.
              </p>
            )}
            {error && <p className={styles.error}>{error}</p>}
            {!walletAddress && <p className={styles.warn}>Connect your owner wallet to continue.</p>}
            {ownerMismatch && (
              <p className={styles.warn}>
                Connected wallet isn&rsquo;t the SMA owner ({ownerAddr}). Switch to it to authorize.
              </p>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose}>Cancel</button>
              <SailButton onClick={rotate} disabled={!walletAddress}>
                {mandateAddrs.length > 0 ? 'Rotate & re-approve' : 'Rotate signer'}
              </SailButton>
            </div>
          </>
        ) : pending ? (
          <>
            <h2 className={styles.title}>
              {step === 'rotating' ? 'Rotating signer…' : 'Re-approving mandates…'}
            </h2>
            <p className={styles.body}>
              {step === 'rotating'
                ? 'Confirm the Safe transaction in your wallet to set the new delegated signer.'
                : 'Sign the re-approval and confirm the transaction to rebind your mandates.'}
            </p>
            <dl className={styles.meta}>
              {rotateTx && <div><dt>Rotation tx</dt><dd>{rotateTx}</dd></div>}
              {reattachTx && <div><dt>Re-approval tx</dt><dd>{reattachTx}</dd></div>}
            </dl>
          </>
        ) : (
          <>
            <h2 className={styles.title}>Rotate the manager?</h2>
            <p className={styles.body}>
              Rotate this SMA to a new delegated signer (manager) — the recovery path when the
              current manager key is lost or compromised. Generate a fresh wallet, or import an
              existing one by private key or recovery phrase. Set a password to encrypt it on disk.
            </p>
            <dl className={styles.meta}>
              <div><dt>SMA</dt><dd>{sma}</dd></div>
              {currentManager && <div><dt>Current manager</dt><dd>{currentManager}</dd></div>}
              <div><dt>Attached mandates</dt><dd>{mandateAddrs.length}</dd></div>
            </dl>

            <div className={form.segmented} role="tablist" aria-label="New manager source">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'create'}
                className={`${form.segBtn} ${mode === 'create' ? form.segActive : ''}`}
                onClick={() => selectMode('create')}
              >
                Create new
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'import'}
                className={`${form.segBtn} ${mode === 'import' ? form.segActive : ''}`}
                onClick={() => selectMode('import')}
              >
                Import
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'saved'}
                className={`${form.segBtn} ${mode === 'saved' ? form.segActive : ''}`}
                onClick={() => selectMode('saved')}
              >
                Use saved
              </button>
            </div>

            {mode === 'create' ? (
              <p className={form.modeNote}>
                Generates a fresh random key. You&rsquo;ll see the private key once, to back up.
              </p>
            ) : mode === 'saved' ? (
              <div className={form.savedList} role="radiogroup" aria-label="Saved managers">
                {loadingSaved ? (
                  <p className={form.modeNote}>Loading saved managers…</p>
                ) : (savedSigners ?? []).length === 0 ? (
                  <p className={form.modeNote}>
                    No saved managers in this project. Create a new wallet or import one.
                  </p>
                ) : (
                  <>
                    {selectableSaved.length === 0 && (
                      <p className={form.modeNote}>
                        The only saved manager is this SMA&rsquo;s current one. Create a new wallet or import one.
                      </p>
                    )}
                    {(savedSigners ?? []).map((s) => (
                      <label
                        key={s.address}
                        className={`${form.savedItem} ${selectedSaved.toLowerCase() === s.address.toLowerCase() ? form.savedItemActive : ''}`}
                        aria-disabled={s.active}
                      >
                        <input
                          type="radio"
                          name="saved-manager"
                          value={s.address}
                          disabled={s.active}
                          checked={selectedSaved.toLowerCase() === s.address.toLowerCase()}
                          onChange={() => setSelectedSaved(s.address)}
                        />
                        <code className={form.savedAddr}>{s.address}</code>
                        {s.active && <span className={form.savedBadge}>current</span>}
                      </label>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <>
                <div className={form.segmented2}>
                  <button
                    type="button"
                    className={`${form.segBtn} ${importKind === 'privateKey' ? form.segActive : ''}`}
                    onClick={() => setImportKind('privateKey')}
                  >
                    Private key
                  </button>
                  <button
                    type="button"
                    className={`${form.segBtn} ${importKind === 'mnemonic' ? form.segActive : ''}`}
                    onClick={() => setImportKind('mnemonic')}
                  >
                    Recovery phrase
                  </button>
                </div>
                <label className={form.field}>
                  <span className={form.fieldLabel}>
                    {importKind === 'privateKey' ? 'Private key' : 'Recovery phrase (12 or 24 words)'}
                  </span>
                  <textarea
                    className={form.input}
                    rows={importKind === 'privateKey' ? 2 : 3}
                    placeholder={importKind === 'privateKey' ? '0x…' : 'word1 word2 word3 …'}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              </>
            )}

            {mode !== 'saved' && (
              <label className={form.field}>
                <span className={form.fieldLabel}>Encryption password</span>
                <input
                  className={form.input}
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <span className={form.fieldHint}>
                  Encrypts the key on disk. You&rsquo;ll enter it to run the agent (or set SAIL_PASSPHRASE).
                </span>
              </label>
            )}
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose}>Cancel</button>
              {mode === 'saved' ? (
                <SailButton onClick={useSavedManager} disabled={busy || !selectedSaved}>
                  Use this manager
                </SailButton>
              ) : (
                <SailButton onClick={provisionKey} disabled={busy}>
                  {busy ? 'Working…' : mode === 'create' ? 'Generate new wallet' : 'Import wallet'}
                </SailButton>
              )}
            </div>
          </>
        )}
      </GlassCard>
    </div>
  )
}
