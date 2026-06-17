import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ERC20_REWARDS_ABI,
  SAIL_TOKEN_PLACEHOLDER,
  isTokenConfigured,
  resolveFromBlock,
  resolveTokenAddress,
} from '../../src/pages/rewards/rewardsConfig.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_SRC = path.join(__dirname, '../../src/pages/rewards/rewardsConfig.js')

const REAL_ADDR = '0x1111111111111111111111111111111111111111'

describe('$SAIL token address is config-driven, not hardcoded', () => {
  it('resolves the address from env when set', () => {
    expect(resolveTokenAddress({ VITE_SAIL_TOKEN_ADDRESS: REAL_ADDR })).toBe(REAL_ADDR)
  })

  it('falls back to a clear placeholder when unset or invalid', () => {
    expect(resolveTokenAddress({})).toBe(SAIL_TOKEN_PLACEHOLDER)
    expect(resolveTokenAddress({ VITE_SAIL_TOKEN_ADDRESS: 'not-an-address' })).toBe(SAIL_TOKEN_PLACEHOLDER)
  })

  it('reports configured only once a real address is present', () => {
    expect(isTokenConfigured({})).toBe(false)
    expect(isTokenConfigured({ VITE_SAIL_TOKEN_ADDRESS: REAL_ADDR })).toBe(true)
  })

  it('source contains no hardcoded non-placeholder token address', () => {
    const src = fs.readFileSync(CONFIG_SRC, 'utf-8')
    // The only 0x… literal allowed is the all-zero placeholder.
    const addrs = src.match(/0x[0-9a-fA-F]{40}/g) ?? []
    for (const a of addrs) {
      expect(a.toLowerCase()).toBe(SAIL_TOKEN_PLACEHOLDER)
    }
  })
})

describe('from-block config for the on-chain history scan', () => {
  it("defaults to 'earliest' and parses a numeric block", () => {
    expect(resolveFromBlock({})).toBe('earliest')
    expect(resolveFromBlock({ VITE_SAIL_TOKEN_FROM_BLOCK: '' })).toBe('earliest')
    expect(resolveFromBlock({ VITE_SAIL_TOKEN_FROM_BLOCK: '12345' })).toBe(12345n)
  })
})

describe('balance is read from chain state via balanceOf', () => {
  it('exposes balanceOf + the Transfer event in the ABI', () => {
    const fns = ERC20_REWARDS_ABI.filter((x) => x.type === 'function').map((x) => x.name)
    expect(fns).toContain('balanceOf')
    expect(fns).toContain('decimals')
    const events = ERC20_REWARDS_ABI.filter((x) => x.type === 'event').map((x) => x.name)
    expect(events).toContain('Transfer')
  })
})
