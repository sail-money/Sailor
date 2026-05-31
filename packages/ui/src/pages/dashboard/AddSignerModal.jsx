import { useEffect, useState } from 'react'
import { GlassCard, SailButton } from '../shared'
import shared from '../shared/shared.module.css'
import styles from './AddSignerModal.module.css'

const MIN_PASSWORD = 8

function short(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'this SMA'
}

/**
 * Create or import the delegated-signer (manager) key for the active SMA.
 *
 * The key is generated/derived and encrypted entirely by the local server
 * (`POST /api/signer`) into a geth-v3 keystore at `.sail/keys/manager-<safe>.json`
 * — the same artifact `sailor run` loads. The secret never leaves the machine;
 * the only value ever sent back is the freshly-generated private key (once),
 * shown for backup when the user chose "Create new".
 */
export default function AddSignerModal({ open, safe, onClose, onCreated }) {
  const [mode, setMode] = useState('create') // 'create' | 'import'
  const [importKind, setImportKind] = useState('privateKey') // 'privateKey' | 'mnemonic'
  const [secret, setSecret] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { address, revealed }
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setMode('create')
    setImportKind('privateKey')
    setSecret('')
    setPassword('')
    setBusy(false)
    setError('')
    setResult(null)
    setCopied(false)
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const method = mode === 'create' ? 'generate' : importKind
  const needsSecret = mode === 'import'

  async function submit() {
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
      if (!res.ok) throw new Error(json?.error || 'Failed to create signer.')
      setResult(json)
      setSecret('')
      setPassword('')
    } catch (err) {
      setError(err?.message || 'Failed to create signer.')
    } finally {
      setBusy(false)
    }
  }

  function copyRevealed() {
    if (result?.revealed && navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(result.revealed)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Add delegated signer"
      onClick={busy ? undefined : onClose}
    >
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        {!busy && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        )}

        {result ? (
          <section className={styles.body}>
            <span className={styles.kicker}>SIGNER READY</span>
            <h2 className={`${shared.displayHeadline} ${styles.headline}`}>Delegated signer created.</h2>
            <p className={styles.sub}>
              Encrypted on disk for {short(safe)}. It still needs to be delegated on-chain before the agent
              can sign with it.
            </p>

            <div className={styles.addrPanel}>
              <span className={styles.addrLabel}>Signer address</span>
              <code className={styles.addrValue}>{result.address}</code>
            </div>

            {result.revealed && (
              <div className={styles.revealPanel}>
                <span className={styles.revealLabel}>Private key — save it now, shown only once</span>
                <code className={styles.revealValue}>{result.revealed}</code>
                <button type="button" className={styles.copyBtn} onClick={copyRevealed}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
                <p className={styles.revealNote}>
                  Anyone with this key controls the signer. Store it in a password manager — never paste it
                  into a chat or commit it to a repo.
                </p>
              </div>
            )}

            <SailButton fullWidth onClick={() => onCreated?.(result)}>
              {result.revealed ? "I've saved it — done" : 'Done'}
            </SailButton>
          </section>
        ) : (
          <section className={styles.body}>
            <span className={styles.kicker}>DELEGATED SIGNER</span>
            <h2 className={`${shared.displayHeadline} ${styles.headline}`}>Add a delegated signer.</h2>
            <p className={styles.sub}>
              A hot key the agent uses to sign dispatches for {short(safe)}. It&rsquo;s encrypted on disk and
              never leaves this machine.
            </p>

            <div className={styles.segmented} role="tablist" aria-label="Signer source">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'create'}
                className={`${styles.segBtn} ${mode === 'create' ? styles.segActive : ''}`}
                onClick={() => setMode('create')}
              >
                Create new
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'import'}
                className={`${styles.segBtn} ${mode === 'import' ? styles.segActive : ''}`}
                onClick={() => setMode('import')}
              >
                Import
              </button>
            </div>

            {mode === 'create' ? (
              <p className={styles.modeNote}>
                Generates a fresh random key. You&rsquo;ll see the private key once, to back up.
              </p>
            ) : (
              <>
                <div className={styles.segmented2}>
                  <button
                    type="button"
                    className={`${styles.segBtn} ${importKind === 'privateKey' ? styles.segActive : ''}`}
                    onClick={() => setImportKind('privateKey')}
                  >
                    Private key
                  </button>
                  <button
                    type="button"
                    className={`${styles.segBtn} ${importKind === 'mnemonic' ? styles.segActive : ''}`}
                    onClick={() => setImportKind('mnemonic')}
                  >
                    Recovery phrase
                  </button>
                </div>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    {importKind === 'privateKey' ? 'Private key' : 'Recovery phrase (12 or 24 words)'}
                  </span>
                  <textarea
                    className={styles.input}
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

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Encryption password</span>
              <input
                className={styles.input}
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <span className={styles.fieldHint}>
                Encrypts the key on disk. You&rsquo;ll enter it to run the agent (or set SAIL_PASSPHRASE).
              </span>
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <SailButton fullWidth onClick={submit} disabled={busy}>
              {busy ? 'Working…' : mode === 'create' ? 'Generate signer' : 'Import signer'}
            </SailButton>
            <p className={styles.fineprint}>
              Self-custody. The key is encrypted locally and never sent anywhere.
            </p>
          </section>
        )}
      </GlassCard>
    </div>
  )
}
