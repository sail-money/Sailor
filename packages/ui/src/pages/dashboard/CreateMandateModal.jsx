import { useEffect, useMemo, useState } from 'react'
import { isAddress } from 'viem'
import { InfoTip, SailButton, WalletAddress } from '../shared'
import shared from '../shared/shared.module.css'
import { getMandateTemplates } from '../../data/sailorClient'
import { useCreateMandate } from '../../hooks/useCreateMandate'
import { useOwnerWallet } from '../../hooks/useOwnerWallet'
import styles from './RotateSignerModal.module.css'
import own from './CreateMandateModal.module.css'

/* Friendly label for each step the create hook reports via onStatus. */
const STEP_LABEL = {
  building: 'Preparing the deployment…',
  'deploy-wallet': 'Approve the deployment in your wallet…',
  'deploy-confirming': 'Deploying the permission contract on-chain…',
  'register-sign': 'Sign to register the mandate…',
  'register-wallet': 'Approve the registration in your wallet…',
  'register-confirming': 'Binding the mandate to your SMA…',
  persisting: 'Finishing up…',
}

/* Common ERC-20 / approval selectors offered as quick-insert chips for a
   bytes4[] field. Raw 4-byte function selectors, not a substitute for reading
   the calldata · just a convenience so the user doesn't hand-compute them. */
const COMMON_SELECTORS = [
  { sel: '0x095ea7b3', sig: 'approve(address,uint256)' },
  { sel: '0xa9059cbb', sig: 'transfer(address,uint256)' },
  { sel: '0x23b872dd', sig: 'transferFrom(address,address,uint256)' },
]

/* Validate one constructor input's raw string against its Solidity type.
   Returns { value, error } · value is the coerced JS value to send (arrays for
   T[], string for scalars), error is a human message or null. */
function validateInput(type, raw) {
  const s = (raw ?? '').trim()
  if (type.endsWith('[]')) {
    const base = type.slice(0, -2)
    const items = s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)
    if (items.length === 0) return { value: [], error: 'Add at least one entry.' }
    for (const it of items) {
      const e = scalarError(base, it)
      if (e) return { value: items, error: `${it}: ${e}` }
    }
    // Normalize addresses to checksum; leave others as-is.
    const value = base === 'address' ? items.map((a) => a) : items
    return { value, error: null }
  }
  const e = scalarError(type, s)
  return { value: s, error: e }
}

function scalarError(type, v) {
  if (!v) return 'required'
  if (type === 'address') return isAddress(v) ? null : 'not a valid address'
  if (type === 'bytes4') return /^0x[0-9a-fA-F]{8}$/.test(v) ? null : 'expected a 4-byte selector (0x + 8 hex)'
  if (type.startsWith('uint') || type.startsWith('int')) return /^\d+$/.test(v) ? null : 'expected a whole number'
  if (type === 'bool') return /^(true|false|0|1|yes|no)$/i.test(v) ? null : 'expected true/false'
  if (type.startsWith('bytes')) return /^0x[0-9a-fA-F]*$/.test(v) ? null : 'expected 0x-hex'
  return null // string et al · accept
}

/* A short, human label + hint for the known BoundedCallPermission inputs;
   falls back to the raw Solidity name/type for anything else. */
function fieldMeta(input) {
  switch (input.name) {
    case 'allowedTargets':
      return { label: 'Allowed target contracts', hint: 'Contract addresses the agent may call. One per line.', kind: 'list' }
    case 'allowedSelectors':
      return { label: 'Allowed function selectors', hint: 'The 4-byte selectors the agent may invoke on those targets. One per line.', kind: 'selectors' }
    case 'maxValue':
      return { label: 'Max ETH value per call (wei)', hint: 'Cap on msg.value for each call. 0 means the agent can attach no ETH.', kind: 'scalar' }
    default:
      return { label: `${input.name} · ${input.type}`, hint: null, kind: input.type.endsWith('[]') ? 'list' : 'scalar' }
  }
}

/**
 * Create mandate · authors a NEW permission contract in the browser and brings
 * it on-chain end-to-end (deploy → register), all owner-signed (useCreateMandate).
 *
 * The form is driven by the chosen template's constructor inputs (raw fields):
 * the owner deploys the permission contract, then signs + submits the
 * registration that binds it to the SMA. Two wallet prompts, no agent gas.
 */
export default function CreateMandateModal({ open, chain, onClose, onCreated }) {
  const { address: owner } = useOwnerWallet()
  const { create } = useCreateMandate()

  const [templates, setTemplates] = useState(null) // null = loading
  const [templatesErr, setTemplatesErr] = useState(null)
  const [template, setTemplate] = useState(null) // selected template object
  const [values, setValues] = useState({}) // inputName -> raw string
  const [name, setName] = useState('')

  const [phase, setPhase] = useState('intro') // intro | running | done | error
  const [step, setStep] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const chainId = chain?.id ?? null

  // Load compiled templates on open.
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setTemplates(null)
    setTemplatesErr(null)
    getMandateTemplates()
      .then(({ templates: t }) => {
        if (cancelled) return
        setTemplates(t ?? [])
        setTemplate((t ?? [])[0] ?? null)
      })
      .catch((err) => { if (!cancelled) setTemplatesErr(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [open])

  // Reset transient form/flow state each fresh open.
  useEffect(() => {
    if (!open) return
    setValues({})
    setName('')
    setPhase('intro')
    setStep(null)
    setResult(null)
    setError(null)
  }, [open])

  // Default the mandate name + clear values when the selected template changes.
  useEffect(() => {
    if (!template) return
    setName(template.name)
    setValues({})
  }, [template])

  // Esc to close + lock body scroll while open (only when not mid-flight).
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && phase !== 'running') onClose?.() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, phase, onClose])

  const inputs = template?.inputs ?? []

  // Validate every field; build the aligned args array when all are valid.
  const { args, fieldErrors, allValid } = useMemo(() => {
    const errs = {}
    const out = []
    let ok = true
    for (const inp of inputs) {
      const { value, error } = validateInput(inp.type, values[inp.name] ?? '')
      if (error) { errs[inp.name] = error; ok = false }
      out.push(value)
    }
    return { args: out, fieldErrors: errs, allValid: ok }
  }, [inputs, values])

  const canCreate = Boolean(owner) && Boolean(chainId) && Boolean(template) && allValid

  async function runCreate() {
    setPhase('running')
    setError(null)
    try {
      const res = await create({
        chainId,
        template: template.name,
        args,
        name: name.trim() || template.name,
        onStatus: setStep,
      })
      setResult(res)
      setPhase('done')
      onCreated?.(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  function setField(n, v) { setValues((p) => ({ ...p, [n]: v })) }
  function appendSelector(n, sel) {
    setValues((p) => {
      const cur = (p[n] ?? '').trim()
      if (cur.split(/[\n,]+/).map((x) => x.trim()).includes(sel)) return p
      return { ...p, [n]: cur ? `${cur}\n${sel}` : sel }
    })
  }

  if (!open) return null

  return (
    <div
      className={`${styles.overlay} ${styles.overlayOpen}`}
      role="dialog"
      aria-modal="true"
      aria-label="Create mandate"
      onClick={() => { if (phase !== 'running') onClose?.() }}
    >
      <div className={`${styles.card} ${styles.cardOpen}`} onClick={(e) => e.stopPropagation()}>
        {phase !== 'running' && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        )}

        <header className={styles.header}>
          <span className={styles.pill}>
            <span className={styles.pillDot} aria-hidden />
            New mandate
          </span>
          <h2 className={`${shared.displayHeadline} ${styles.headline}`}>
            {phase === 'done' ? 'Mandate created.' : phase === 'error' ? 'Creation failed.' : 'Author a new mandate.'}
          </h2>
          <p className={styles.subtitle}>
            {phase === 'done'
              ? 'The permission is deployed and bound to your SMA. Your agent can act within it now.'
              : phase === 'error'
                ? 'Nothing is bound unless both steps confirmed on-chain. See the details below.'
                : 'Deploy a bounded permission contract and register it on your SMA. You sign twice: once to deploy, once to register.'}
            {' '}
            <InfoTip label="What is a mandate?">
              A mandate is an on-chain permission contract that bounds exactly what your agent may do.
              You deploy it with your wallet, then register it on the kernel so the SMA enforces it.
            </InfoTip>
          </p>
        </header>

        {/* ── INTRO: template + raw constructor fields ── */}
        {phase === 'intro' && (
          <div className={styles.body}>
            {templates == null && !templatesErr && <div className={styles.note}>Loading templates…</div>}
            {templatesErr && <div className={styles.errorNote}>Couldn&rsquo;t load templates: {templatesErr}</div>}
            {templates != null && templates.length === 0 && !templatesErr && (
              <div className={styles.errorNote}>
                No compiled permission templates found. Run <code>forge build</code> in the project so the
                artifact (e.g. <code>out/BoundedCallPermission.sol</code>) exists, then reopen this.
              </div>
            )}

            {templates && templates.length > 1 && (
              <section className={styles.field}>
                <span className={styles.fieldLabel}>Template</span>
                <div className={own.templateRow}>
                  {templates.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      className={`${own.templateOpt} ${template?.name === t.name ? own.templateOptOn : ''}`}
                      onClick={() => setTemplate(t)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {template && inputs.map((inp) => {
              const meta = fieldMeta(inp)
              const err = (values[inp.name] ?? '') !== '' ? fieldErrors[inp.name] : null
              const isList = inp.type.endsWith('[]')
              return (
                <section key={inp.name} className={styles.field}>
                  <label htmlFor={`mf-${inp.name}`} className={styles.fieldLabel}>{meta.label}</label>
                  {isList ? (
                    <textarea
                      id={`mf-${inp.name}`}
                      spellCheck={false}
                      autoComplete="off"
                      className={`${own.textarea} ${err ? own.textareaError : ''}`}
                      placeholder={inp.type === 'bytes4[]' ? '0x095ea7b3' : '0x… (one per line)'}
                      value={values[inp.name] ?? ''}
                      onChange={(e) => setField(inp.name, e.target.value)}
                    />
                  ) : (
                    <input
                      id={`mf-${inp.name}`}
                      type="text"
                      spellCheck={false}
                      autoComplete="off"
                      className={`${styles.input} ${err ? styles.inputError : ''}`}
                      placeholder={inp.type.startsWith('uint') ? '0' : '0x…'}
                      value={values[inp.name] ?? ''}
                      onChange={(e) => setField(inp.name, e.target.value)}
                    />
                  )}
                  {meta.kind === 'selectors' && (
                    <div className={own.hints}>
                      {COMMON_SELECTORS.map((c) => (
                        <button key={c.sel} type="button" className={own.hintChip} onClick={() => appendSelector(inp.name, c.sel)}>
                          {c.sel} <span className={own.hintChipSel}>{c.sig}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {err
                    ? <span className={styles.inputHint} style={{ color: '#ff6b6b' }}>{err}</span>
                    : meta.hint && <span className={styles.inputHint}>{meta.hint}</span>}
                </section>
              )
            })}

            {template && (
              <section className={styles.field}>
                <label htmlFor="mf-name" className={styles.fieldLabel}>
                  Mandate name <span className={styles.optional}>optional</span>
                </label>
                <input
                  id="mf-name"
                  type="text"
                  autoComplete="off"
                  className={styles.input}
                  placeholder={template.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </section>
            )}

            {!owner && <div className={styles.note}>Connect your owner wallet to create a mandate.</div>}

            <footer className={styles.footer}>
              <SailButton onClick={runCreate} disabled={!canCreate}>Deploy and register</SailButton>
              <SailButton variant="secondary" onClick={onClose}>Cancel</SailButton>
            </footer>
          </div>
        )}

        {/* ── RUNNING: live progress ── */}
        {phase === 'running' && (
          <div className={styles.running}>
            <span className={styles.spinner} aria-hidden />
            <p className={`${shared.displayHeadline} ${styles.runningHeadline}`}>
              {STEP_LABEL[step] ?? 'Working…'}
            </p>
            <p className={shared.italicMannerism}>
              {step === 'deploy-wallet' || step === 'register-wallet' || step === 'register-sign'
                ? 'Confirm in your wallet to continue.'
                : 'This can take a moment while the chain confirms.'}
            </p>
            <p className={styles.runningNote}>Keep this window open until both steps complete.</p>
          </div>
        )}

        {/* ── DONE: success summary ── */}
        {phase === 'done' && result && (
          <div className={styles.body}>
            <section className={styles.summaryRow}>
              <div className={styles.summaryCell}>
                <span className={styles.fieldLabel}>Mandate</span>
                <div className={styles.summaryVal}><span className={own.addrMono}>{result.address}</span></div>
              </div>
            </section>
            <div className={styles.txLinks}>
              <TxLink chain={chain} hash={result.deployTxHash} label="Deploy tx" />
              <TxLink chain={chain} hash={result.registerTxHash} label="Register tx" />
            </div>
            <footer className={styles.footer}>
              <SailButton onClick={onClose}>Done</SailButton>
            </footer>
          </div>
        )}

        {/* ── ERROR ── */}
        {phase === 'error' && (
          <div className={styles.body}>
            <div className={styles.errorNote}>{error}</div>
            <footer className={styles.footer}>
              <SailButton onClick={() => setPhase('intro')}>Back</SailButton>
              <SailButton variant="secondary" onClick={onClose}>Close</SailButton>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}

/* A small explorer link for a tx hash, using the chain's explorer if known. */
function TxLink({ chain, hash, label }) {
  if (!hash) return null
  const base = chain?.id === 8453 ? 'https://basescan.org/tx/'
    : chain?.id === 84532 ? 'https://sepolia.basescan.org/tx/'
    : null
  const short = `${hash.slice(0, 8)}…${hash.slice(-6)}`
  return base ? (
    <a className={styles.txLink} href={`${base}${hash}`} target="_blank" rel="noreferrer">
      {label}: <span className={styles.txMono}>{short}</span> ↗
    </a>
  ) : (
    <span className={styles.txLink}>{label}: <span className={styles.txMono}>{short}</span></span>
  )
}
