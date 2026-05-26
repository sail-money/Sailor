import { useState } from 'react'
import {
  getNetwork,
  getToken,
  getProtocol,
  getTokenAddress,
  getProtocolAddress,
  truncateAddress,
  ACTION_KINDS,
} from '../../../data/permissionsRegistry'
import styles from './Permissions.module.css'

/* ──────────────────────────────────────────
   Top-level surface — renders the full
   structured permissions panel for a mandate.
   ────────────────────────────────────────── */
export function PermissionsPanel({ mandate }) {
  return (
    <div className={styles.panel}>
      {mandate.networks?.length > 0 && (
        <Block title={`Networks (${mandate.networks.length})`}>
          <div className={styles.chipRow}>
            {mandate.networks.map((id) => (
              <NetworkChip key={id} networkId={id} />
            ))}
          </div>
        </Block>
      )}

      {mandate.assets?.length > 0 && (
        <Block title={`Assets (${mandate.assets.length})`}>
          <div className={styles.chipRow}>
            {mandate.assets.map((symbol) => (
              <AssetChip key={symbol} symbol={symbol} />
            ))}
          </div>
        </Block>
      )}

      {(mandate.caps?.length > 0 || mandate.duration) && (
        <div className={styles.metaGrid}>
          {mandate.caps?.length > 0 && (
            <MetaBlock title="Spending cap">
              {mandate.caps.map((c, i) => (
                <div key={i} className={styles.metaValue}>
                  {c.currency === 'USD' ? `$${c.amount.toLocaleString()}` : `${c.amount} ${c.asset}`}
                  <span className={styles.metaSub}>max {c.asset}</span>
                </div>
              ))}
            </MetaBlock>
          )}
          {mandate.duration && (
            <MetaBlock title="Time limit">
              <div className={styles.metaValue}>
                {mandate.duration}
                {mandate.endsAt && (
                  <span className={styles.metaSub}>
                    ends {new Date(mandate.endsAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
              </div>
            </MetaBlock>
          )}
        </div>
      )}

      {mandate.actions?.length > 0 && (
        <Block title={`What your AI can do (${mandate.actions.length})`}>
          <ol className={styles.actionList}>
            {mandate.actions.map((action, i) => (
              <ActionCard key={action.id ?? i} action={action} index={i + 1} />
            ))}
          </ol>
        </Block>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────
   Building blocks
   ────────────────────────────────────────── */
function Block({ title, children }) {
  return (
    <section className={styles.block}>
      <header className={styles.blockHead}>
        <span className={styles.blockKicker}>{title}</span>
      </header>
      {children}
    </section>
  )
}

function MetaBlock({ title, children }) {
  return (
    <section className={styles.metaBlock}>
      <span className={styles.blockKicker}>{title}</span>
      {children}
    </section>
  )
}

/* ──────────────────────────────────────────
   Atoms — chips for networks, assets, protocols
   ────────────────────────────────────────── */
export function NetworkChip({ networkId, compact = false }) {
  const n = getNetwork(networkId)
  if (!n) return null
  return (
    <span
      className={`${styles.networkChip} ${compact ? styles.chipCompact : ''}`}
      style={{ '--chip': n.color }}
      title={`Chain ID ${n.chainId}`}
    >
      <span className={styles.networkDot} aria-hidden />
      {n.name}
    </span>
  )
}

export function AssetChip({ symbol, networkId, compact = false }) {
  const t = getToken(symbol)
  if (!t) return <span className={styles.assetChip}>{symbol}</span>

  const [open, setOpen] = useState(false)
  const address = networkId ? getTokenAddress(symbol, networkId) : null

  if (!address) {
    // simple chip when no specific network
    return (
      <span
        className={`${styles.assetChip} ${compact ? styles.chipCompact : ''}`}
        style={{ '--chip': t.color }}
      >
        <span className={styles.assetDisc} aria-hidden>{t.symbol[0]}</span>
        {t.symbol}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={`${styles.assetChip} ${styles.assetChipInteractive} ${compact ? styles.chipCompact : ''}`}
      style={{ '--chip': t.color }}
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      title={`Token contract on ${getNetwork(networkId)?.name ?? networkId}`}
    >
      <span className={styles.assetDisc} aria-hidden>{t.symbol[0]}</span>
      {t.symbol}
      <span className={styles.assetAddress}>
        {open ? address : truncateAddress(address)}
      </span>
    </button>
  )
}

export function ProtocolChip({ protocolId, networkId }) {
  const p = getProtocol(protocolId)
  if (!p) return null
  const address = networkId ? getProtocolAddress(protocolId, networkId) : null
  const [open, setOpen] = useState(false)

  return (
    <button
      type="button"
      className={styles.protocolChip}
      style={{ '--chip': p.color }}
      onClick={() => address && setOpen((v) => !v)}
      aria-expanded={open}
      title={`${p.name} · ${p.kind}`}
    >
      <span className={styles.protocolDisc} aria-hidden>◊</span>
      <span className={styles.protocolName}>{p.name}</span>
      <span className={styles.protocolKind}>{p.kind}</span>
      {address && <span className={styles.protocolAddress}>{open ? address : truncateAddress(address)}</span>}
    </button>
  )
}

/* ──────────────────────────────────────────
   Action card — the per-action breakdown.
   Defaults compact (icon + label + chips inline).
   "View contracts" toggle reveals onchain detail.
   ────────────────────────────────────────── */
export function ActionCard({ action, index }) {
  const [expanded, setExpanded] = useState(false)
  const kind = ACTION_KINDS[action.kind] ?? { label: 'Action', accent: '#1990FF' }

  return (
    <li className={styles.action} style={{ '--accent': kind.accent }}>
      <header className={styles.actionHead}>
        <span className={styles.actionIndex} aria-hidden>{index}</span>
        <span className={styles.actionKind}>
          <ActionIcon kind={action.kind} />
          <span className={styles.actionKindLabel}>{kind.label}</span>
        </span>
        <span className={styles.actionLabel}>{action.label}</span>
      </header>

      <div className={styles.actionChips}>
        {action.from && <AssetChip symbol={action.from} compact />}
        {action.from && action.to && <span className={styles.actionArrow} aria-hidden>→</span>}
        {action.to && <AssetChip symbol={action.to} compact />}
        {!action.from && action.asset && <AssetChip symbol={action.asset} compact />}
        {action.venue && <ProtocolChip protocolId={action.venue} />}
        {action.networks?.map((n) => (
          <NetworkChip key={n} networkId={n} compact />
        ))}
      </div>

      {action.trigger && (
        <div className={styles.trigger}>
          <span className={styles.triggerLabel}>Trigger</span>
          <span className={styles.triggerBody}>{describeTrigger(action.trigger)}</span>
        </div>
      )}

      {(action.asset || action.from || action.to || action.venue) && (
        <button
          type="button"
          className={styles.expandLink}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide' : 'View'} contracts
          <span className={`${styles.expandChevron} ${expanded ? styles.expandChevronOpen : ''}`} aria-hidden>
            <Chevron />
          </span>
        </button>
      )}

      {expanded && <ContractList action={action} />}
    </li>
  )
}

function ContractList({ action }) {
  const rows = []
  const assets = [
    action.asset,
    action.from,
    action.to,
  ].filter(Boolean)
  const dedupedAssets = [...new Set(assets)]
  const networks = action.networks ?? []

  for (const sym of dedupedAssets) {
    for (const net of networks) {
      const addr = getTokenAddress(sym, net)
      if (addr) {
        rows.push({
          kind: 'token',
          label: `${sym} on ${getNetwork(net)?.name ?? net}`,
          color: getToken(sym)?.color ?? '#1990FF',
          address: addr,
          chainId: getNetwork(net)?.chainId,
        })
      }
    }
  }
  if (action.venue) {
    for (const net of networks) {
      const addr = getProtocolAddress(action.venue, net)
      if (addr) {
        const p = getProtocol(action.venue)
        rows.push({
          kind: 'protocol',
          label: `${p?.name ?? action.venue} on ${getNetwork(net)?.name ?? net}`,
          color: p?.color ?? '#1990FF',
          address: addr,
          chainId: getNetwork(net)?.chainId,
        })
      }
    }
  }

  if (!rows.length) {
    return <p className={styles.contractEmpty}>No onchain contracts referenced.</p>
  }

  return (
    <ul className={styles.contractList}>
      {rows.map((r, i) => (
        <li key={i} className={styles.contractRow}>
          <span
            className={styles.contractDot}
            style={{ background: r.color }}
            aria-hidden
          />
          <span className={styles.contractLabel}>{r.label}</span>
          <span className={styles.contractAddress}>{r.address}</span>
          <span className={styles.contractChain}>chainId {r.chainId}</span>
        </li>
      ))}
    </ul>
  )
}

/* ──────────────────────────────────────────
   Icons + helpers
   ────────────────────────────────────────── */
function describeTrigger(trigger) {
  if (!trigger) return null
  if (trigger.type === 'yield-threshold') {
    return `When accumulated yield ≥ $${trigger.amountUsd}`
  }
  if (trigger.type === 'price') {
    return `When ${trigger.asset} ${trigger.direction === 'above' ? '≥' : '≤'} ${trigger.value}`
  }
  if (trigger.type === 'time') {
    return `On ${trigger.at}`
  }
  return JSON.stringify(trigger)
}

function ActionIcon({ kind }) {
  const stroke = 'currentColor'
  const common = { width: 13, height: 13, fill: 'none', stroke, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (kind) {
    case 'deposit':
      return <svg viewBox="0 0 14 14" {...common}><path d="M7 2v8M4 7l3 3 3-3M2.5 12h9" /></svg>
    case 'withdraw':
      return <svg viewBox="0 0 14 14" {...common}><path d="M7 12V4M4 7l3-3 3 3M2.5 2h9" /></svg>
    case 'swap':
    case 'conditional-swap':
      return <svg viewBox="0 0 14 14" {...common}><path d="M2 5h9M9 2l3 3-3 3M12 9H3M5 12L2 9l3-3" /></svg>
    case 'claim':
      return <svg viewBox="0 0 14 14" {...common}><circle cx="7" cy="7" r="4" /><path d="M5.5 7l1.2 1.2L9 6" /></svg>
    case 'rebalance':
      return <svg viewBox="0 0 14 14" {...common}><path d="M3 7a4 4 0 014-4M11 7a4 4 0 01-4 4M3 7l-1.5-1.5M3 7l-1.5 1.5M11 7l1.5-1.5M11 7l1.5 1.5" /></svg>
    case 'short':
      return <svg viewBox="0 0 14 14" {...common}><path d="M2 4l5 5 5-5M2 10h10" /></svg>
    case 'long':
      return <svg viewBox="0 0 14 14" {...common}><path d="M2 10l5-5 5 5M2 4h10" /></svg>
    case 'hedge':
      return <svg viewBox="0 0 14 14" {...common}><path d="M7 2v10M2 5l5-3 5 3M2 9l5 3 5-3" /></svg>
    default:
      return <svg viewBox="0 0 14 14" {...common}><circle cx="7" cy="7" r="1.6" /></svg>
  }
}

function Chevron() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 5l3.5 3.5L10.5 5" />
    </svg>
  )
}
