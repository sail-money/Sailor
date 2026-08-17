import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

const SAFE = '0x8E637d9573Ad81B60cb93edA78b9C827860950a4'
const OWNER = '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5'
const MANAGER = '0xa6D478146f03E9473582aCe099c67e3CbB5EC2BE'

describe('Strategies API', () => {
  let fix
  const onboard = () =>
    fix.api.post('/api/onboard/complete').send({ safe: SAFE, owner: OWNER, manager: MANAGER, chainId: 8453 })
  beforeEach(() => {
    fix = loadFixture('fresh')
  })
  afterEach(() => {
    fix.cleanup()
  })

  it('creates, activates, and deletes a strategy (one SMA + one executable)', async () => {
    await onboard()
    const create = await fix.api.post('/api/strategies').send({ name: 'Yield', sma: SAFE, executable: 'agent', chains: [8453], description: 'rotate' })
    expect(create.status).toBe(200)
    expect(create.body.strategy).toMatchObject({ name: 'Yield', description: 'rotate', active: false, executable: 'agent' })
    expect(create.body.strategy.chains).toEqual([8453])

    // sma + executable are required.
    const missing = await fix.api.post('/api/strategies').send({ name: 'NoSma' })
    expect(missing.status).toBe(400)

    // Duplicate name rejected.
    const dup = await fix.api.post('/api/strategies').send({ name: 'yield', sma: SAFE, executable: 'agent' })
    expect(dup.status).toBe(400)

    const activate = await fix.api.post('/api/strategies/Yield').send({ active: true })
    expect(activate.status).toBe(200)
    expect(activate.body.strategy.active).toBe(true)

    const list = await fix.api.get('/api/strategies')
    expect(list.body.strategies.some((s) => s.name === 'Yield')).toBe(true)

    const del = await fix.api.delete('/api/strategies/Yield')
    expect(del.status).toBe(200)
    const after = await fix.api.get('/api/strategies')
    expect(after.body.strategies.some((s) => s.name === 'Yield')).toBe(false)
  })

  it('round-trips per-chain env to .sail/env/<slug>.json', async () => {
    const empty = await fix.api.get('/api/env/8453')
    expect(empty.status).toBe(200)
    expect(empty.body.values).toEqual({})

    const save = await fix.api.post('/api/env/8453').send({ values: { MORPHO_TOKEN_ADDR: '0xabc', USDC: '0xdef' } })
    expect(save.status).toBe(200)

    const read = await fix.api.get('/api/env/8453') // 8453 → slug "base"
    expect(read.body.values).toEqual({ MORPHO_TOKEN_ADDR: '0xabc', USDC: '0xdef' })
    const file = path.join(fix.sailDir, 'env', 'base.json')
    expect(fs.existsSync(file)).toBe(true)
  })

  it('sets chains and clears to executable-driven (cross-chain)', async () => {
    await onboard()
    await fix.api.post('/api/strategies').send({ name: 'Flow', sma: SAFE, executable: 'agent', chains: [8453] })

    // Clear chains → executable-driven (no chains key).
    const cleared = await fix.api.post('/api/strategies/Flow').send({ chains: [] })
    expect(cleared.status).toBe(200)
    expect(cleared.body.strategy.chains).toBeUndefined()

    // Set them again.
    const set = await fix.api.post('/api/strategies/Flow').send({ chains: [8453] })
    expect(set.status).toBe(200)
    expect(set.body.strategy.chains).toEqual([8453])
  })

  it('GET /api/strategies/:sma filters to one SMA (case-insensitive), 400 on non-address', async () => {
    await onboard()
    await fix.api.post('/api/strategies').send({ name: 'yield', sma: SAFE, executable: 'agent', chains: [8453] })

    const forSma = await fix.api.get(`/api/strategies/${SAFE.toLowerCase()}`)
    expect(forSma.status).toBe(200)
    expect(forSma.body.strategies.map((s) => s.name)).toEqual(['yield'])

    const other = await fix.api.get('/api/strategies/0x1111111111111111111111111111111111111111')
    expect(other.status).toBe(200)
    expect(other.body.strategies).toEqual([])

    const bad = await fix.api.get('/api/strategies/not-an-address')
    expect(bad.status).toBe(400)
  })

  it('scaffolds an executable and lists it (camelCase enforced)', async () => {
    // Keep state somewhere that cannot be mistaken for the project root. This
    // covers custom SAIL_DIR values as well as .shipyard/sandbox's nested state.
    fix.cleanup()
    fix = loadFixture('onboarded', {}, { sailDirRel: path.join('state', 'custom') })

    const bad = await fix.api.post('/api/executables').send({ name: 'bad_name' })
    expect(bad.status).toBe(400)

    const ok = await fix.api.post('/api/executables').send({ name: 'checkData' })
    expect(ok.status).toBe(200)
    const file = path.join(fix.projectRoot, 'src', 'strategy', 'checkData.ts')
    expect(fs.existsSync(file)).toBe(true)

    const list = await fix.api.get('/api/executables')
    expect(list.body.executables).toContain('checkData')

    // Duplicate rejected.
    const again = await fix.api.post('/api/executables').send({ name: 'checkData' })
    expect(again.status).toBe(409)
  })
})
