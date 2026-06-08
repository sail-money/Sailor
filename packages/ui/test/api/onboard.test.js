import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

describe('GET /api/onboard/state', () => {
  let fix
  beforeEach(() => { fix = loadFixture('fresh') })
  afterEach(() => fix.cleanup())

  it('fresh fixture → hasAccount false, no manager key', async () => {
    const res = await fix.api.get('/api/onboard/state')
    expect(res.status).toBe(200)
    expect(res.body.hasAccount).toBe(false)
    expect(res.body.hasManagerKey).toBe(false)
    expect(res.body.managerAddress).toBeNull()
    expect(res.body.chainId).toBe(8453)
  })
})

describe('GET /api/onboard/state (onboarded)', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('onboarded fixture → hasAccount true, manager address present', async () => {
    const res = await fix.api.get('/api/onboard/state')
    expect(res.status).toBe(200)
    expect(res.body.hasAccount).toBe(true)
    expect(res.body.hasManagerKey).toBe(true)
    expect(res.body.managerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(res.body.kernel).toBeTruthy()
  })
})

describe('POST /api/onboard/generate-key', () => {
  let fix
  beforeEach(() => { fix = loadFixture('fresh') })
  afterEach(() => fix.cleanup())

  it('generates a new key and returns an address', async () => {
    const res = await fix.api.post('/api/onboard/generate-key').send({ passphrase: 'test-pass-1234' })
    expect(res.status).toBe(200)
    expect(res.body.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(res.body.existed).toBe(false)
  })

  it('second call returns same address + existed:true', async () => {
    const first = await fix.api.post('/api/onboard/generate-key').send({ passphrase: 'test-pass-1234' })
    const second = await fix.api.post('/api/onboard/generate-key').send({ passphrase: 'different' })
    expect(second.status).toBe(200)
    expect(second.body.existed).toBe(true)
    expect(second.body.address).toBe(first.body.address)
  })
})

describe('POST /api/onboard/build-create-tx', () => {
  let fix
  beforeEach(() => { fix = loadFixture('fresh') })
  afterEach(() => fix.cleanup())

  it('returns to/data/chainId for valid owner+manager', async () => {
    const res = await fix.api
      .post('/api/onboard/build-create-tx')
      .send({
        owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5',
        manager: '0xa6D478146f03E9473582aCe099c67e3CbB5EC2BE',
      })
    expect(res.status).toBe(200)
    expect(res.body.to).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(res.body.data).toMatch(/^0x/)
    expect(res.body.chainId).toBe(8453)
  })

  it('rejects invalid addresses', async () => {
    const res = await fix.api
      .post('/api/onboard/build-create-tx')
      .send({ owner: 'not-an-address', manager: '0xa6D478146f03E9473582aCe099c67e3CbB5EC2BE' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/onboard/complete', () => {
  let fix
  beforeEach(() => { fix = loadFixture('fresh') })
  afterEach(() => fix.cleanup())

  it('writes account.json and returns the record', async () => {
    const res = await fix.api.post('/api/onboard/complete').send({
      safe: '0x8E637d9573Ad81B60cb93edA78b9C827860950a4',
      owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5',
      manager: '0xa6D478146f03E9473582aCe099c67e3CbB5EC2BE',
      txHash: '0xdeadbeef',
      chainId: 8453,
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.account.safe).toBe('0x8E637d9573Ad81B60cb93edA78b9C827860950a4')

    // Verify account.json was actually written
    const state = await fix.api.get('/api/onboard/state')
    expect(state.body.hasAccount).toBe(true)
  })

  it('rejects invalid safe address', async () => {
    const res = await fix.api.post('/api/onboard/complete').send({
      safe: 'bad',
      owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5',
    })
    expect(res.status).toBe(400)
  })
})
