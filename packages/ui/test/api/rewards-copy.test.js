import { describe, expect, it } from 'vitest'
import { ALL_REWARDS_COPY, NON_TRANSFERABLE_LABEL } from '../../src/pages/rewards/rewardsCopy.js'

/**
 * Copy discipline (legal): token/campaign copy must celebrate facts only and
 * never imply price, profit, future value, appreciation, or tradability upside.
 */
const SPECULATIVE_DENYLIST = [
  'worth',
  'profit',
  'return', // returns, guaranteed return…
  'price',
  'moon',
  'invest', // invest, investment, investing
  'appreciat', // appreciate, appreciation
  'sell',
  'sold',
  'trade for',
  'tradable',
  'tradeable',
  'value will',
  'will be worth',
  'future value',
  'unlock value',
  'get rich',
  'guaranteed',
  'roi',
  'gains',
  'lambo',
  'pump',
]

describe('rewards copy passes the speculative-language discipline check', () => {
  const corpus = ALL_REWARDS_COPY.join('\n').toLowerCase()

  for (const term of SPECULATIVE_DENYLIST) {
    it(`contains no "${term}"`, () => {
      expect(corpus.includes(term)).toBe(false)
    })
  }

  it('states non-transferable plainly as a present fact', () => {
    expect(NON_TRANSFERABLE_LABEL.toLowerCase()).toContain('non-transferable')
    // No fiat symbols anywhere in the copy.
    expect(/[$€£]\s?\d/.test(corpus)).toBe(false)
  })
})
