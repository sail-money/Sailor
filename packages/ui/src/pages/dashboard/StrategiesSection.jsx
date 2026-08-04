import { useEffect, useMemo, useState } from 'react'
import styles from './StrategiesSection.module.css'
import { ChainGlyph } from '../shared'
import { chainDisplayName } from '../../lib/chains'
import AIHandoffModal from './AIHandoffModal'
import {
  useSailorStrategies,
  useSailorAccounts,
  updateStrategy,
  getChainEnv,
  saveChainEnv,
} from '../../hooks/useSailorData'

/** Chains an SMA can run on: its primary chainId plus every deployedChains entry. */
function smaChains(acc) {
  return [...new Set([acc?.chainId, ...(acc?.deployedChains ?? [])])].filter((c) => Number.isFinite(c))
}

export default function StrategiesSection() {
  const [tick, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)
  const [err, setErr] = useState(null)
  // { variant: 'new' | 'redraft', name?: string } | null — drives the AI-handoff popup.
  const [handoff, setHandoff] = useState(null)

  const { strategies } = useSailorStrategies(tick)
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
      {err && <div className={styles.error}>{err}</div>}

      <div className={styles.headRow}>
        <button type="button" className={styles.newBtn} onClick={() => setHandoff({ variant: 'new' })}>
          + New strategy
        </button>
      </div>

      {strategies.length === 0 ? (
        <p className={styles.empty}>No strategies yet — a Default is created after onboarding.</p>
      ) : (
        strategies.map((s) => (
          <StrategyCard
            key={s.name}
            strategy={s}
            run={run}
            onEdit={() => setHandoff({ variant: 'redraft', name: s.name })}
          />
        ))
      )}

      <div className={styles.envBlock}>
        <span className={styles.eyebrowSmall}>Per-chain environment</span>
        <EnvironmentPanel accounts={accounts} />
      </div>

      <AIHandoffModal
        open={!!handoff}
        context="strategy"
        variant={handoff?.variant ?? 'new'}
        strategy={handoff?.name ?? null}
        onClose={() => setHandoff(null)}
      />
    </div>
  )
}

// ── Strategy card ──────────────────────────────────────────────────────────────
// Read-only except the Activate toggle. SMA + executable are intentionally hidden —
// creating/editing a strategy is done by asking the agent (the Edit popup).

function StrategyCard({ strategy, run, onEdit }) {
  const s = strategy
  const chains = s.chains ?? []

  return (
    <div className={`${styles.card} ${s.active ? styles.cardActive : ''}`}>
      <div className={styles.cardHead}>
        <div className={styles.cardMeta}>
          <span className={styles.name}>{s.name}</span>
          {s.active && <span className={styles.tagActive}>active</span>}
          {s.description && <span className={styles.desc}>{s.description}</span>}
        </div>
        <div className={styles.cardActions}>
          <button type="button" className={styles.toggleBtn} onClick={() => run(() => updateStrategy(s.name, { active: !s.active }))}>
            {s.active ? 'Deactivate' : 'Activate'}
          </button>
          <button type="button" className={styles.stepEditBtn} onClick={onEdit}>Edit</button>
        </div>
      </div>

      <div className={styles.stepRow}>
        <span className={styles.stepChains}>
          {chains.length > 0 ? (
            chains.map((c) => (
              <span key={c} className={styles.chainPill} title={chainDisplayName(c)}><ChainGlyph chainId={c} size={13} /></span>
            ))
          ) : (
            <span className={styles.desc}>multichain (executable-driven)</span>
          )}
        </span>
      </div>
    </div>
  )
}

// ── Environment (per-chain ctx.env values) ──────────────────────────────────────

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
