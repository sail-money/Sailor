import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

describe('GET /api/overview (onboarded — snapshot cached, no RPC)', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('returns overview from the pre-built snapshot', async () => {
    const res = await fix.api.get('/api/overview')
    expect(res.status).toBe(200)
    expect(res.body).not.toBeNull()
    expect(res.body.sma.address).toBe('0x8E637d9573Ad81B60cb93edA78b9C827860950a4')
    expect(res.body.chainId).toBe(8453)
    expect(res.body.network).toBe('base')
  })

  it('snapshot has onchain:true and real signer data', async () => {
    const res = await fix.api.get('/api/overview')
    expect(res.body.onchain).toBe(true)
    expect(res.body.signers.length).toBeGreaterThan(0)
    expect(res.body.signers[0].role).toBe('manager')
    expect(res.body.signers[0].address).toBeTruthy()
  })

  it('mandates include the lifi-swap template', async () => {
    const res = await fix.api.get('/api/overview')
    expect(res.body.mandates.length).toBeGreaterThan(0)
    const mandate = res.body.mandates[0]
    expect(mandate.template).toBe('lifi-swap')
    expect(mandate.address).toBeTruthy()
  })

  it('signer with low balance has status:low', async () => {
    const res = await fix.api.get('/api/overview')
    const manager = res.body.signers.find(s => s.role === 'manager')
    expect(manager.status).toBe('low')
  })
})

describe('GET /api/overview (fresh — no account)', () => {
  let fix
  beforeEach(() => { fix = loadFixture('fresh') })
  afterEach(() => fix.cleanup())

  it('returns null before an SMA is created', async () => {
    const res = await fix.api.get('/api/overview')
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })
})

describe('GET /api/positions', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('returns vault positions array', async () => {
    const res = await fix.api.get('/api/positions')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.positions)).toBe(true)
    expect(res.body.positions.length).toBeGreaterThan(0)
    expect(res.body.positions[0]).toHaveProperty('protocol')
    expect(res.body.positions[0]).toHaveProperty('valueUsd')
  })
})
