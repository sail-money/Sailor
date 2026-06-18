import { describe, expect, it } from 'vitest'
import {
  formatTokenAmount,
  groupTransfersByWeek,
  totalReceivedWei,
  weekLabel,
  weekStartMs,
} from '../../src/pages/rewards/rewardsHistory.js'

// June 2026: the 1st, 8th, and 15th are all Mondays.
const JUN_10 = Date.UTC(2026, 5, 10) // Wed → week of Jun 8
const JUN_11 = Date.UTC(2026, 5, 11) // Thu → week of Jun 8
const JUN_17 = Date.UTC(2026, 5, 17) // Wed → week of Jun 15

describe('weekStartMs / weekLabel', () => {
  it('snaps any day to its Monday 00:00 UTC', () => {
    expect(weekStartMs(JUN_10)).toBe(Date.UTC(2026, 5, 8))
    expect(weekStartMs(JUN_11)).toBe(Date.UTC(2026, 5, 8))
    expect(weekStartMs(JUN_17)).toBe(Date.UTC(2026, 5, 15))
  })

  it('labels the week start', () => {
    expect(weekLabel(Date.UTC(2026, 5, 8))).toBe('Week of Jun 8, 2026')
  })
})

describe('groupTransfersByWeek', () => {
  it('returns [] for empty / missing input (drives the empty state)', () => {
    expect(groupTransfersByWeek([])).toEqual([])
    expect(groupTransfersByWeek(undefined)).toEqual([])
  })

  it('sums transfers within a week and sorts most-recent first', () => {
    const weeks = groupTransfersByWeek([
      { valueWei: 100n, timestampMs: JUN_10 },
      { valueWei: '50', timestampMs: JUN_11 },
      { valueWei: 70n, timestampMs: JUN_17 },
    ])
    expect(weeks).toHaveLength(2)
    // Most recent week first.
    expect(weeks[0].weekStartMs).toBe(Date.UTC(2026, 5, 15))
    expect(weeks[0].amountWei).toBe(70n)
    expect(weeks[0].count).toBe(1)
    // Earlier week merges the two transfers.
    expect(weeks[1].weekStartMs).toBe(Date.UTC(2026, 5, 8))
    expect(weeks[1].amountWei).toBe(150n)
    expect(weeks[1].count).toBe(2)
    expect(weeks[1].weekLabel).toBe('Week of Jun 8, 2026')
  })

  it('skips malformed entries without a timestamp', () => {
    const weeks = groupTransfersByWeek([
      { valueWei: 100n, timestampMs: JUN_10 },
      { valueWei: 999n }, // no timestamp → skipped
      null,
    ])
    expect(weeks).toHaveLength(1)
    expect(weeks[0].amountWei).toBe(100n)
  })
})

describe('totals + formatting', () => {
  it('totals received across weeks', () => {
    const weeks = groupTransfersByWeek([
      { valueWei: 100n, timestampMs: JUN_10 },
      { valueWei: 70n, timestampMs: JUN_17 },
    ])
    expect(totalReceivedWei(weeks)).toBe(170n)
    expect(totalReceivedWei([])).toBe(0n)
  })

  it('formats wei at the token decimals (no fiat, no symbol)', () => {
    expect(formatTokenAmount(1_000_000_000_000_000_000n, 18)).toBe('1')
    expect(formatTokenAmount(2_500_000n, 6)).toBe('2.5')
    expect(formatTokenAmount('0', 18)).toBe('0')
  })
})
