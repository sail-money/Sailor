import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ALL_MESSAGE_COPY,
  MESSAGE_FIRST_DEPOSIT,
  MESSAGE_MANDATE_SIGNED,
  MESSAGE_SMA_LIVE,
  applyDismissals,
  deriveRewardMessages,
  messageWeeklyDistribution,
} from '../../src/pages/rewards/rewardMessages.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/pages/rewards/useRewardMessages.js'),
  'utf-8',
)

describe('reward messages fire only on their real detected event', () => {
  it('no signals → no messages (nothing fires spuriously)', () => {
    expect(deriveRewardMessages({})).toEqual([])
    expect(deriveRewardMessages({ smaDeployed: false, mandateSigned: false, firstDeposit: false, weeklyAmount: null })).toEqual([])
  })

  it('SMA deployed → only the SMA-live message', () => {
    const msgs = deriveRewardMessages({ smaDeployed: true })
    expect(msgs.map((m) => m.key)).toEqual(['sma_live'])
    expect(msgs[0].event).toBe('sma_created')
    expect(msgs[0].text).toBe(MESSAGE_SMA_LIVE)
  })

  it('mandate signed → only the mandate message, tied to permission_registered', () => {
    const msgs = deriveRewardMessages({ mandateSigned: true })
    expect(msgs.map((m) => m.key)).toEqual(['mandate_signed'])
    expect(msgs[0].event).toBe('permission_registered')
    expect(msgs[0].text).toBe(MESSAGE_MANDATE_SIGNED)
  })

  it('first deposit → only the deposit message', () => {
    const msgs = deriveRewardMessages({ firstDeposit: true })
    expect(msgs.map((m) => m.key)).toEqual(['first_deposit'])
    expect(msgs[0].text).toBe(MESSAGE_FIRST_DEPOSIT)
  })

  it('weekly distribution → message includes the amount that landed', () => {
    const msgs = deriveRewardMessages({ weeklyAmount: '120', weeklySymbol: 'SAIL' })
    expect(msgs.map((m) => m.key)).toEqual(['weekly_distribution'])
    expect(msgs[0].text).toContain('120 SAIL')
    expect(msgs[0].event).toBe('weekly_distribution')
  })

  it('weekly does NOT fire when no distribution landed (null amount)', () => {
    expect(deriveRewardMessages({ weeklyAmount: null }).map((m) => m.key)).toEqual([])
  })

  it('all signals together → all four, in a stable order', () => {
    const msgs = deriveRewardMessages({
      smaDeployed: true,
      mandateSigned: true,
      firstDeposit: true,
      weeklyAmount: '5',
    })
    expect(msgs.map((m) => m.key)).toEqual([
      'sma_live',
      'mandate_signed',
      'first_deposit',
      'weekly_distribution',
    ])
  })
})

describe('reward messages are dismissible', () => {
  it('applyDismissals removes a dismissed key and keeps the rest', () => {
    const msgs = deriveRewardMessages({ smaDeployed: true, mandateSigned: true, firstDeposit: true })
    const after = applyDismissals(msgs, ['mandate_signed'])
    expect(after.map((m) => m.key)).toEqual(['sma_live', 'first_deposit'])
  })

  it('dismissing everything yields an empty list', () => {
    const msgs = deriveRewardMessages({ smaDeployed: true })
    expect(applyDismissals(msgs, ['sma_live'])).toEqual([])
  })

  it('the hook persists dismissals and wires real detection hooks', () => {
    // Source-level wiring (node-env harness has no DOM): the hook reads the real
    // activity/positions signals and persists dismissals to localStorage.
    expect(HOOK_SRC).toContain('useSailorActivity')
    expect(HOOK_SRC).toContain('useSailorPositions')
    expect(HOOK_SRC).toContain("e.type === 'sma_created'")
    expect(HOOK_SRC).toContain("e.type === 'permission_registered'")
    expect(HOOK_SRC).toContain('localStorage')
  })
})

describe('reward message copy passes the speculative-language discipline check', () => {
  const SPECULATIVE_DENYLIST = [
    'worth', 'profit', 'return', 'price', 'moon', 'invest', 'appreciat',
    'sell', 'sold', 'trade for', 'tradable', 'value will', 'will be worth',
    'future value', 'unlock value', 'get rich', 'guaranteed', 'roi', 'gains',
    'lambo', 'pump',
  ]
  // Include a realistic weekly line with an amount in the scanned corpus.
  const corpus = [...ALL_MESSAGE_COPY, messageWeeklyDistribution('42', 'SAIL')]
    .join('\n')
    .toLowerCase()

  for (const term of SPECULATIVE_DENYLIST) {
    it(`contains no "${term}"`, () => {
      expect(corpus.includes(term)).toBe(false)
    })
  }

  it('no fiat amounts in the copy', () => {
    expect(/[$€£]\s?\d/.test(corpus)).toBe(false)
  })
})
