import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

const SAFE = '0x8E637d9573Ad81B60cb93edA78b9C827860950a4'
// Address inside the onboarded fixture's keys/manager.json (== account.manager).
const CURRENT = '0xa6D478146f03E9473582aCe099c67e3CbB5EC2BE'
const OTHER = '0x1111111111111111111111111111111111111111'

// A minimal geth-v3 keystore — only the plaintext `address` is read by the API.
const keystore = (addr) =>
  JSON.stringify({ version: 3, id: 'test', address: addr.replace(/^0x/, '').toLowerCase(), crypto: {} })

describe('GET /api/signers', () => {
  let fix
  afterEach(() => fix?.cleanup())

  it('lists saved manager keystores and flags the active one', async () => {
    fix = loadFixture('onboarded', {
      'keys/manager-0x2222222222222222222222222222222222222222.json': keystore(OTHER),
    })
    const res = await fix.api.get('/api/signers')
    expect(res.status).toBe(200)
    const addrs = res.body.signers.map((s) => s.address.toLowerCase())
    expect(addrs).toContain(CURRENT.toLowerCase())
    expect(addrs).toContain(OTHER.toLowerCase())
    const current = res.body.signers.find((s) => s.address.toLowerCase() === CURRENT.toLowerCase())
    expect(current.active).toBe(true)
    const other = res.body.signers.find((s) => s.address.toLowerCase() === OTHER.toLowerCase())
    expect(other.active).toBe(false)
  })

  it('excludes backup files (those not ending in .json)', async () => {
    fix = loadFixture('onboarded', {
      'keys/manager.json.1700000000000.bak': keystore(OTHER),
    })
    const res = await fix.api.get('/api/signers')
    const addrs = res.body.signers.map((s) => s.address.toLowerCase())
    expect(addrs).not.toContain(OTHER.toLowerCase())
  })
})

describe('POST /api/signer/activate', () => {
  let fix
  afterEach(() => fix?.cleanup())

  it('copies the matching keystore to manager-<safe>.json', async () => {
    fix = loadFixture('onboarded', { 'keys/manager-extra.json': keystore(OTHER) })
    const res = await fix.api.post('/api/signer/activate').send({ address: OTHER })
    expect(res.status).toBe(200)
    expect(res.body.address.toLowerCase()).toBe(OTHER.toLowerCase())

    const target = path.join(fix.sailDir, 'keys', `manager-${SAFE.toLowerCase()}.json`)
    expect(fs.existsSync(target)).toBe(true)
    const copied = JSON.parse(fs.readFileSync(target, 'utf-8'))
    expect(`0x${copied.address}`.toLowerCase()).toBe(OTHER.toLowerCase())
  })

  it('404s when no saved keystore matches the address', async () => {
    fix = loadFixture('onboarded')
    const res = await fix.api
      .post('/api/signer/activate')
      .send({ address: '0x9999999999999999999999999999999999999999' })
    expect(res.status).toBe(404)
  })

  it('rejects an invalid address', async () => {
    fix = loadFixture('onboarded')
    const res = await fix.api.post('/api/signer/activate').send({ address: 'not-an-address' })
    expect(res.status).toBe(400)
  })
})
