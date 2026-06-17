import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

const readConfig = (sailDir) => JSON.parse(fs.readFileSync(path.join(sailDir, 'config.json'), 'utf-8'))

describe('GET /api/account', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('returns the active account', async () => {
    const res = await fix.api.get('/api/account')
    expect(res.status).toBe(200)
    expect(res.body.safe).toBe('0x8E637d9573Ad81B60cb93edA78b9C827860950a4')
    expect(res.body.chainId).toBe(8453)
  })
})

describe('GET /api/account (fresh)', () => {
  let fix
  beforeEach(() => { fix = loadFixture('fresh') })
  afterEach(() => fix.cleanup())

  it('returns 404 before any SMA is set', async () => {
    const res = await fix.api.get('/api/account')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/accounts', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('returns list with the active SMA marked', async () => {
    const res = await fix.api.get('/api/accounts')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    const active = res.body.find(a => a.active)
    expect(active).toBeTruthy()
    expect(active.safe).toBe('0x8E637d9573Ad81B60cb93edA78b9C827860950a4')
  })
})

describe('POST /api/account (register new SMA)', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('creates a second SMA and makes it active', async () => {
    const newSafe = '0x1111111111111111111111111111111111111111'
    const res = await fix.api.post('/api/account').send({
      safe: newSafe,
      owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5',
      chainId: 8453,
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const active = await fix.api.get('/api/account')
    expect(active.body.safe.toLowerCase()).toBe(newSafe.toLowerCase())
  })
})

describe('POST /api/account/switch — multichain chainId sync (FUNC-2)', () => {
  let fix
  const SMA_A = '0x8E637d9573Ad81B60cb93edA78b9C827860950a4' // chain 8453 (active)
  const SMA_B = '0x2222222222222222222222222222222222222222' // chain 42161
  beforeEach(() => {
    // Two SMAs on different chains; active SMA (and config) start on 8453.
    fix = loadFixture('onboarded', {
      'config.json': JSON.stringify({ version: 1, name: 'multichain', chainId: 8453 }),
      'state/accounts.json': JSON.stringify([
        { safe: SMA_A, owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5', chainId: 8453, name: 'On Base' },
        { safe: SMA_B, owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5', chainId: 42161, name: 'On Arbitrum' },
      ]),
    })
  })
  afterEach(() => fix.cleanup())

  it('switching to an SMA on another chain moves config.json.chainId with it', async () => {
    expect(readConfig(fix.sailDir).chainId).toBe(8453)

    const res = await fix.api.post('/api/account/switch').send({ safe: SMA_B })
    expect(res.status).toBe(200)
    expect(res.body.active.chainId).toBe(42161)

    // config.json followed the active SMA — the stage machine / CLI no longer go stale.
    expect(readConfig(fix.sailDir).chainId).toBe(42161)
    const state = await fix.api.get('/api/onboard/state')
    expect(state.body.chainId).toBe(42161)

    // Switching back restores it.
    await fix.api.post('/api/account/switch').send({ safe: SMA_A })
    expect(readConfig(fix.sailDir).chainId).toBe(8453)
  })
})

describe('POST /api/account/rename', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('updates the display name', async () => {
    const res = await fix.api.post('/api/account/rename').send({
      safe: '0x8E637d9573Ad81B60cb93edA78b9C827860950a4',
      name: 'My Renamed SMA',
    })
    expect(res.status).toBe(200)

    const accounts = await fix.api.get('/api/accounts')
    const target = accounts.body.find(
      a => a.safe.toLowerCase() === '0x8e637d9573ad81b60cb93eda78b9c827860950a4'
    )
    expect(target.name).toBe('My Renamed SMA')
  })
})

describe('GET /api/mandate', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('returns mandates as an array', async () => {
    const res = await fix.api.get('/api/mandate')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    const mandate = res.body[0]
    expect(mandate.safe).toBe('0x8E637d9573Ad81B60cb93edA78b9C827860950a4')
    expect(mandate.registeredOnChain).toBe(true)
    expect(mandate.permissions.length).toBeGreaterThan(0)
    expect(mandate.permissions[0].template).toBe('lifi-swap')
  })
})
