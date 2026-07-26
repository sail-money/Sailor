import { useEffect, useMemo, useState } from 'react'
import styles from './StrategiesSection.module.css'
import dash from './Dashboard.module.css'
import { ChainGlyph } from '../shared'
import { chainDisplayName } from '../../lib/chains'
import {
  useSailorStrategies,
  useSailorExecutables,
  useSailorAccounts,
  createStrategy,
  updateStrategy,
  deleteStrategy,
  addStrategyStep,
  updateStrategyStep,
  removeStrategyStep,
  createExecutable,
  getChainEnv,
  saveChainEnv,
} from '../../hooks/useSailorData'

/** Chains an SMA can run on: its primary chainId plus every deployedChains entry. */
function smaChains(acc) {
  return [...new Set([acc?.chainId, ...(acc?.deployedChains ?? [])])].filter((c) => Number.isFinite(c))
}
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

const SUB_TABS = [
  ['strategies', 'Strategies'],
  ['executables', 'Executables'],
  ['environment', 'Environment'],
]

export default function StrategiesSection() {
  const [subTab, setSubTab] = useState('strategies')
  const [tick, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)
  const [err, setErr] = useState(null)

  const { strategies } = useSailorStrategies(tick)
  const { executables } = useSailorExecutables(tick)
  const { accounts } = useSailorAccounts(tick)

  const run = async (fn) => {
    try {
      setErr(null)
      await fn()
      bump()
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <div className={styles.section}>
      <div className={dash.segTabs} role="group" aria-label="Strategies sections">
        {SUB_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={subTab === key}
            className={`${dash.segTabBtn} ${subTab === key ? dash.segTabBtnActive : ''}`}
            onClick={() => setSubTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {err && <div className={styles.error}>{err}</div>}

      {subTab === 'strategies' && <StrategiesPanel strategies={strategies} accounts={accounts} executables={executables} run={run} />}
      {subTab === 'executables' && <ExecutablesPanel executables={executables} run={run} />}
      {subTab === 'environment' && <EnvironmentPanel accounts={accounts} />}
    </div>
  )
}

// ── Strategies panel ─────────────────────────────────────────────────────────

function StrategiesPanel({ strategies, accounts, executables, run }) {
  const [creating, setCreating] = useState(false)
  return (
    <>
      <div className={styles.headRow}>
        <button type="button" className={styles.newBtn} onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : '+ New strategy'}
        </button>
      </div>
      {creating && (
        <NewStrategyForm onCreate={(name, description) => run(() => createStrategy(name, description)).then(() => setCreating(false))} />
      )}
      {strategies.length === 0 ? (
        <p className={styles.empty}>No strategies yet — a Default is created after onboarding.</p>
      ) : (
        strategies.map((s) => <StrategyCard key={s.name} strategy={s} accounts={accounts} executables={executables} run={run} />)
      )}
    </>
  )
}

function NewStrategyForm({ onCreate }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  return (
    <div className={styles.card}>
      <div className={styles.field}>
        <label className={styles.label}>Name</label>
        <input className={styles.input} value={name} placeholder="e.g. Yield rotation" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Description</label>
        <input className={styles.input} value={description} placeholder="What this strategy does (optional)" onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.saveBtn} disabled={!name.trim()} onClick={() => onCreate(name.trim(), description.trim())}>
          Create
        </button>
      </div>
    </div>
  )
}

function StrategyCard({ strategy, accounts, executables, run }) {
  const s = strategy
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(-1) // step index being edited, or -1

  return (
    <div className={`${styles.card} ${s.active ? styles.cardActive : ''}`}>
      <div className={styles.cardHead}>
        <div className={styles.cardMeta}>
          <span className={styles.name}>{s.name}</span>
          {s.active && <span className={styles.tagActive}>active</span>}
          {s.description && <span className={styles.desc}>{s.description}</span>}
        </div>
        <div className={styles.cardActions}>
          <label className={styles.pipeSelectWrap} title="How the steps run">
            <select className={styles.pipeSelect} value={s.pipeline.type} onChange={(e) => run(() => updateStrategy(s.name, { pipelineType: e.target.value }))}>
              <option value="sequential">sequential</option>
              <option value="parallel">parallel</option>
            </select>
          </label>
          <button type="button" className={styles.toggleBtn} onClick={() => run(() => updateStrategy(s.name, { active: !s.active }))}>
            {s.active ? 'Deactivate' : 'Activate'}
          </button>
          {s.name !== 'Default' && (
            <button type="button" className={styles.deleteBtn} onClick={() => run(() => deleteStrategy(s.name))}>Delete</button>
          )}
        </div>
      </div>

      <div className={styles.steps}>
        {s.pipeline.steps.length === 0 && <p className={styles.emptySteps}>No executables yet — add one below.</p>}
        {s.pipeline.steps.map((step, i) =>
          editing === i ? (
            <StepEditor
              key={`edit-${i}`}
              accounts={accounts}
              executables={executables}
              initial={step}
              onSave={(next) => run(() => updateStrategyStep(s.name, i, next)).then(() => setEditing(-1))}
              onCancel={() => setEditing(-1)}
            />
          ) : (
            <div key={`${step.executable}-${step.sma}-${i}`} className={styles.stepRow}>
              <span className={styles.stepExec}>{step.executable}</span>
              <span className={styles.stepArrow}>→</span>
              <span className={styles.stepSma}>{shortAddr(step.sma)}</span>
              <span className={styles.stepChains}>
                {step.chains.map((c) => (
                  <span key={c} className={styles.chainPill} title={chainDisplayName(c)}><ChainGlyph chainId={c} size={13} /></span>
                ))}
              </span>
              <button type="button" className={styles.stepEditBtn} onClick={() => { setEditing(i); setAdding(false) }}>Edit</button>
              <button type="button" className={styles.removeStep} onClick={() => run(() => removeStrategyStep(s.name, i))} aria-label="Remove step">✕</button>
            </div>
          ),
        )}
      </div>

      {adding ? (
        <StepEditor
          accounts={accounts}
          executables={executables}
          onSave={(step) => run(() => addStrategyStep(s.name, step)).then(() => setAdding(false))}
          onCancel={() => setAdding(false)}
        />
      ) : editing === -1 ? (
        <button type="button" className={styles.addStepBtn} onClick={() => setAdding(true)}>+ Add executable</button>
      ) : null}
    </div>
  )
}

function StepEditor({ accounts, executables, initial, onSave, onCancel }) {
  const [executable, setExecutable] = useState(initial?.executable ?? executables[0] ?? 'agent')
  const [sma, setSma] = useState(initial?.sma ?? accounts[0]?.safe ?? '')
  const [chains, setChains] = useState(() => {
    if (initial?.chains?.length) return initial.chains
    const first = accounts.find((a) => a.safe === (initial?.sma ?? accounts[0]?.safe))
    return first ? smaChains(first).slice(0, 1) : []
  })

  const selectedAcc = useMemo(() => accounts.find((a) => a.safe === sma), [accounts, sma])
  const available = selectedAcc ? smaChains(selectedAcc) : []

  function pickSma(safe) {
    setSma(safe)
    const acc = accounts.find((a) => a.safe === safe)
    setChains(acc ? smaChains(acc).slice(0, 1) : [])
  }
  const toggleChain = (c) => setChains((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))

  const canSave = executable && sma && chains.length > 0
  return (
    <div className={styles.stepEditor}>
      <div className={styles.field}>
        <label className={styles.label}>Executable</label>
        <select className={styles.input} value={executable} onChange={(e) => setExecutable(e.target.value)}>
          {(executables.length ? executables : ['agent']).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label}>SMA</label>
        <select className={styles.input} value={sma} onChange={(e) => pickSma(e.target.value)}>
          {accounts.map((a) => <option key={a.safe} value={a.safe}>{a.name ? `${a.name} — ${shortAddr(a.safe)}` : shortAddr(a.safe)}</option>)}
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Chains (SMA-supported)</label>
        <div className={styles.chainChoices}>
          {available.map((c) => {
            const on = chains.includes(c)
            return (
              <button key={c} type="button" className={`${styles.chainChoice} ${on ? styles.chainChoiceOn : ''}`} onClick={() => toggleChain(c)}>
                <ChainGlyph chainId={c} size={14} />{chainDisplayName(c)}
              </button>
            )
          })}
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.saveBtn} disabled={!canSave} onClick={() => onSave({ executable, sma, chains })}>
          {initial ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  )
}

// ── Executables panel ────────────────────────────────────────────────────────

function ExecutablesPanel({ executables, run }) {
  const [name, setName] = useState('')
  const [popup, setPopup] = useState(null) // executable name whose config popup is open
  const valid = /^[a-z][a-zA-Z0-9]*$/.test(name)
  const dup = executables.includes(name)

  return (
    <>
      <div className={styles.card}>
        <span className={styles.eyebrowSmall}>New executable</span>
        <div className={styles.execRow}>
          <input className={styles.input} value={name} placeholder="camelCase name, e.g. checkData" onChange={(e) => setName(e.target.value)} />
          <button type="button" className={styles.saveBtn} disabled={!valid || dup} onClick={() => run(() => createExecutable(name)).then(() => setName(''))}>
            Create
          </button>
        </div>
        {name && !valid && <p className={styles.hint}>Use camelCase letters/digits only (e.g. checkData).</p>}
        {dup && <p className={styles.hint}>An executable named “{name}” already exists.</p>}
      </div>

      <div className={styles.card}>
        {executables.length === 0 ? (
          <p className={styles.empty}>No executables yet — create one above.</p>
        ) : (
          executables.map((n) => (
            <div key={n} className={styles.execListRow}>
              <span className={styles.execName}>{n}</span>
              <code className={styles.execPath}>src/strategy/{n}.ts</code>
              <button type="button" className={styles.stepEditBtn} onClick={() => setPopup(n)}>Edit</button>
            </div>
          ))
        )}
      </div>

      {popup && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" onClick={() => setPopup(null)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <span className={styles.eyebrowSmall}>Configure executable</span>
            <p className={styles.modalText}>
              Executables are configured by the agent. To edit <code>{popup}</code>, tell the agent:
            </p>
            <code className={styles.modalCode}>let's configure the executable {popup}</code>
            <div className={styles.actions}>
              <button type="button" className={styles.saveBtn} onClick={() => setPopup(null)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Environment panel ────────────────────────────────────────────────────────

function EnvironmentPanel({ accounts }) {
  const chainIds = useMemo(
    () => [...new Set(accounts.flatMap(smaChains))].sort((a, b) => a - b),
    [accounts],
  )
  const [chainId, setChainId] = useState(null)
  const [rows, setRows] = useState([]) // [{ name, value }]
  const [status, setStatus] = useState('')

  const active = chainId ?? chainIds[0] ?? null

  useEffect(() => {
    if (active == null) return
    let alive = true
    getChainEnv(active).then((values) => {
      if (!alive) return
      const next = Object.entries(values).map(([name, value]) => ({ name, value }))
      setRows(next.length ? next : [{ name: '', value: '' }])
      setStatus('')
    })
    return () => { alive = false }
  }, [active])

  if (chainIds.length === 0) {
    return <p className={styles.empty}>No chains yet — create or import an SMA first.</p>
  }

  const setRow = (i, patch) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRow = () => setRows((prev) => [...prev, { name: '', value: '' }])
  const removeRow = (i) => setRows((prev) => prev.filter((_, j) => j !== i))

  async function save() {
    const values = {}
    for (const r of rows) {
      const k = r.name.trim()
      if (k) values[k] = r.value
    }
    try {
      setStatus('Saving…')
      await saveChainEnv(active, values)
      setStatus('Saved ✓')
      setTimeout(() => setStatus(''), 1600)
    } catch (e) {
      setStatus(e.message)
    }
  }

  return (
    <>
      <div className={styles.headRow}>
        <span className={styles.hint}>Per-chain values injected as <code>ctx.env</code>.</span>
      </div>

      <div className={styles.chainSwitcher} role="group" aria-label="Select chain">
        {chainIds.map((cid) => (
          <button
            key={cid}
            type="button"
            aria-pressed={active === cid}
            className={`${styles.chainSwitchBtn} ${active === cid ? styles.chainSwitchBtnActive : ''}`}
            onClick={() => setChainId(cid)}
          >
            <ChainGlyph chainId={cid} size={14} />{chainDisplayName(cid)}
          </button>
        ))}
      </div>

      <div className={styles.card}>
        <div className={styles.envTableHead}>
          <span className={styles.label}>Name</span>
          <span className={styles.label}>Value</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className={styles.envRow}>
            <input className={styles.input} value={r.name} placeholder="MORPHO_TOKEN_ADDR" onChange={(e) => setRow(i, { name: e.target.value })} />
            <input className={styles.input} value={r.value} placeholder="0x…" onChange={(e) => setRow(i, { value: e.target.value })} />
            <button type="button" className={styles.removeStep} onClick={() => removeRow(i)} aria-label="Remove row">✕</button>
          </div>
        ))}
        <div className={styles.envActions}>
          <button type="button" className={styles.addStepBtn} onClick={addRow}>+ Add variable</button>
          <div className={styles.actions}>
            {status && <span className={styles.hint}>{status}</span>}
            <button type="button" className={styles.saveBtn} onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </>
  )
}
