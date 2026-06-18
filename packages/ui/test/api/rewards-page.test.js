import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_NO_REWARDS,
  EMPTY_NO_SMA,
  NON_TRANSFERABLE_LABEL,
  REWARDS_DESTINATION_NOTE,
} from '../../src/pages/rewards/rewardsCopy.js'

/**
 * Source-level wiring checks for the rewards page. The repo's test harness is
 * node-env (no DOM), so rather than mount React we assert the page wires the
 * required behavior: a live balanceOf read, the non-transferable label, the
 * weekly history, and both empty states — driven by config, not hardcoded.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PAGE_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/pages/rewards/RewardsPage.jsx'),
  'utf-8',
)

describe('RewardsPage wiring', () => {
  it('reads the balance live via balanceOf', () => {
    expect(PAGE_SRC).toContain("functionName: 'balanceOf'")
    expect(PAGE_SRC).toContain('usePublicClient')
  })

  it('reads weekly history from on-chain Transfer logs (no indexer)', () => {
    expect(PAGE_SRC).toContain('getLogs')
    expect(PAGE_SRC).toContain('groupTransfersByWeek')
  })

  it('resolves the token address from config (not hardcoded)', () => {
    expect(PAGE_SRC).toContain('resolveTokenAddress')
    // No raw non-zero 0x token address baked into the page.
    const addrs = PAGE_SRC.match(/0x[0-9a-fA-F]{40}/g) ?? []
    expect(addrs).toEqual([])
  })

  it('shows the non-transferable label and the destination + empty states', () => {
    expect(PAGE_SRC).toContain('NON_TRANSFERABLE_LABEL')
    expect(PAGE_SRC).toContain('REWARDS_DESTINATION_NOTE')
    expect(PAGE_SRC).toContain('EMPTY_NO_SMA')
    expect(PAGE_SRC).toContain('EMPTY_NO_REWARDS')
  })

  it('rewards go to the FIRST SMA', () => {
    expect(PAGE_SRC).toContain('accounts?.[0]?.safe')
    expect(REWARDS_DESTINATION_NOTE.toLowerCase()).toContain('first sma')
  })

  it('copy constants are non-empty facts', () => {
    for (const c of [EMPTY_NO_SMA, EMPTY_NO_REWARDS, NON_TRANSFERABLE_LABEL]) {
      expect(typeof c).toBe('string')
      expect(c.length).toBeGreaterThan(0)
    }
  })
})
