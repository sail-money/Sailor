import { formatUnits } from 'viem'

/**
 * $SAIL rewards — pure weekly-history aggregation.
 *
 * The page reads inbound ERC-20 `Transfer` logs to the SMA and the block
 * timestamps directly from chain (no indexer), then hands them to these pure,
 * deterministic helpers. Keeping the math out of the React component is what
 * makes the history testable in the repo's node-env test harness.
 */

/** Coerce a wei value (bigint | string | number | 0x-hex) to bigint. */
function toBigInt(value) {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  if (typeof value === 'string' && value.length > 0) return BigInt(value)
  return 0n
}

/** Start (ms) of the ISO week — Monday 00:00 UTC — containing `ms`. */
export function weekStartMs(ms) {
  const d = new Date(ms)
  const mondayOffset = (d.getUTCDay() + 6) % 7 // Sun=0 → 6, Mon=1 → 0, …
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - mondayOffset * 86_400_000
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Human label for a week bucket, e.g. "Week of Jun 8, 2026". */
export function weekLabel(weekStart) {
  const d = new Date(weekStart)
  return `Week of ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/**
 * Group inbound transfers into weekly buckets, most-recent week first.
 *
 * @param transfers Array of `{ valueWei, timestampMs }` (each an amount that
 *   landed in the account and the block time it landed). Malformed entries are
 *   skipped. An empty/absent input yields `[]` (drives the empty state).
 * @returns `[{ weekStartMs, weekLabel, amountWei: bigint, count }]`
 */
export function groupTransfersByWeek(transfers) {
  const buckets = new Map()
  for (const t of transfers ?? []) {
    if (t == null || t.timestampMs == null) continue
    const ws = weekStartMs(t.timestampMs)
    const prev = buckets.get(ws) ?? { weekStartMs: ws, weekLabel: weekLabel(ws), amountWei: 0n, count: 0 }
    prev.amountWei += toBigInt(t.valueWei)
    prev.count += 1
    buckets.set(ws, prev)
  }
  return [...buckets.values()].sort((a, b) => b.weekStartMs - a.weekStartMs)
}

/** Total received (wei) across all weekly buckets. */
export function totalReceivedWei(weeks) {
  return (weeks ?? []).reduce((sum, w) => sum + toBigInt(w.amountWei), 0n)
}

/** Display string for a wei amount at `decimals` (default 18). No fiat, no symbol. */
export function formatTokenAmount(amountWei, decimals = 18) {
  return formatUnits(toBigInt(amountWei), decimals)
}
