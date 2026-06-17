import fs from 'node:fs'
import path from 'node:path'
import { LocalKeyring } from '@sail/sdk'
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

  it('persists SAIL_PASSPHRASE to .env.local @ 0600 and the value unlocks the keystore', async () => {
    const passphrase = 'test-pass-1234'
    const res = await fix.api.post('/api/onboard/generate-key').send({ passphrase })
    expect(res.status).toBe(200)

    // The passphrase the dashboard used is now in .env.local, mode 0600 — so
    // `sailor run` (which reads SAIL_PASSPHRASE from there) works with no extra step.
    const envPath = path.join(fix.sailDir, '.env.local')
    const env = fs.readFileSync(envPath, 'utf-8')
    expect(env).toContain(`SAIL_PASSPHRASE=${passphrase}`)
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600)

    // The keystore itself is 0600.
    const ksPath = path.join(fix.sailDir, 'keys/manager.json')
    expect(fs.statSync(ksPath).mode & 0o777).toBe(0o600)

    // Round-trip: the persisted value actually decrypts the written keystore and
    // yields the same address — exactly what loadManagerSigner does in `sailor run`.
    const persisted = env.match(/^SAIL_PASSPHRASE=(.*)$/m)[1]
    const keyring = await LocalKeyring.fromKeystore(
      JSON.parse(fs.readFileSync(ksPath, 'utf-8')),
      persisted,
    )
    expect(keyring.address.toLowerCase()).toBe(res.body.address.toLowerCase())
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

  it('syncs the chosen chain into config.json so the stage machine reads it (FUNC-2)', async () => {
    // Reproduce the audit scenario: config.json.chainId starts null.
    const f = loadFixture('fresh', { 'config.json': JSON.stringify({ name: 'demo', chainId: null }) })
    try {
      const res = await f.api.post('/api/onboard/complete').send({
        safe: '0x8E637d9573Ad81B60cb93edA78b9C827860950a4',
        owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5',
        manager: '0xa6D478146f03E9473582aCe099c67e3CbB5EC2BE',
        chainId: 42161,
      })
      expect(res.status).toBe(200)
      // config.json on disk now carries the chosen chain (no longer null).
      const config = JSON.parse(fs.readFileSync(path.join(f.sailDir, 'config.json'), 'utf-8'))
      expect(config.chainId).toBe(42161)
      // The stage machine reads it back as the active chain.
      const state = await f.api.get('/api/onboard/state')
      expect(state.body.chainId).toBe(42161)
    } finally {
      f.cleanup()
    }
  })
})
