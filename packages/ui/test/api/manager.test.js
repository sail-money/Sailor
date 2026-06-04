import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

const SAFE = '0x8E637d9573Ad81B60cb93edA78b9C827860950a4'
const NEW_MANAGER = '0x1111111111111111111111111111111111111111'

describe('POST /api/manager/complete', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('persists the rotated manager into account.json and the SMA list', async () => {
    const res = await fix.api.post('/api/manager/complete').send({
      newManager: NEW_MANAGER,
      txHash: '0xabc',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.manager.toLowerCase()).toBe(NEW_MANAGER.toLowerCase())

    const account = await fix.api.get('/api/account')
    expect(account.body.manager.toLowerCase()).toBe(NEW_MANAGER.toLowerCase())

    const accounts = await fix.api.get('/api/accounts')
    const target = accounts.body.find((a) => a.safe.toLowerCase() === SAFE.toLowerCase())
    expect(target.manager.toLowerCase()).toBe(NEW_MANAGER.toLowerCase())
  })

  it('records the rotation in the activity log', async () => {
    await fix.api.post('/api/manager/complete').send({ newManager: NEW_MANAGER })
    const activity = await fix.api.get('/api/activity')
    const ev = activity.body.find((e) => e.type === 'signer_rotated')
    expect(ev).toBeTruthy()
    expect(ev.newManager.toLowerCase()).toBe(NEW_MANAGER.toLowerCase())
  })

  it('rejects an invalid manager address', async () => {
    const res = await fix.api.post('/api/manager/complete').send({ newManager: 'not-an-address' })
    expect(res.status).toBe(400)
  })
})
