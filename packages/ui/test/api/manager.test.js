import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

const SAFE = '0x8E637d9573Ad81B60cb93edA78b9C827860950a4'
const MANAGER_A = '0xa6D478146f03E9473582aCe099c67e3CbB5EC2BE' // seeded in fixture
const MANAGER_B = '0x1111111111111111111111111111111111111111' // new manager
const MANAGER_C = '0x2222222222222222222222222222222222222222' // second rotation

describe('POST /api/manager/complete', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('persists the rotated manager into account.json and the SMA list', async () => {
    const res = await fix.api.post('/api/manager/complete').send({
      newManager: MANAGER_B,
      txHash: '0xabc',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.manager.toLowerCase()).toBe(MANAGER_B.toLowerCase())

    const account = await fix.api.get('/api/account')
    expect(account.body.manager.toLowerCase()).toBe(MANAGER_B.toLowerCase())

    const accounts = await fix.api.get('/api/accounts')
    const target = accounts.body.find((a) => a.safe.toLowerCase() === SAFE.toLowerCase())
    expect(target.manager.toLowerCase()).toBe(MANAGER_B.toLowerCase())
  })

  it('appends new manager to the managers list without dropping the old one', async () => {
    await fix.api.post('/api/manager/complete').send({ newManager: MANAGER_B })

    const account = await fix.api.get('/api/account')
    const managers = account.body.managers?.map((a) => a.toLowerCase()) ?? []
    expect(managers).toContain(MANAGER_A.toLowerCase())
    expect(managers).toContain(MANAGER_B.toLowerCase())
  })

  it('deduplicates the managers list on repeated rotation to the same address', async () => {
    await fix.api.post('/api/manager/complete').send({ newManager: MANAGER_B })
    await fix.api.post('/api/manager/complete').send({ newManager: MANAGER_B })

    const account = await fix.api.get('/api/account')
    const managers = account.body.managers?.map((a) => a.toLowerCase()) ?? []
    expect(managers.filter((a) => a === MANAGER_B.toLowerCase())).toHaveLength(1)
  })

  it('accumulates all managers across multiple rotations', async () => {
    await fix.api.post('/api/manager/complete').send({ newManager: MANAGER_B })
    await fix.api.post('/api/manager/complete').send({ newManager: MANAGER_C })

    const account = await fix.api.get('/api/account')
    const managers = account.body.managers?.map((a) => a.toLowerCase()) ?? []
    expect(managers).toContain(MANAGER_A.toLowerCase())
    expect(managers).toContain(MANAGER_B.toLowerCase())
    expect(managers).toContain(MANAGER_C.toLowerCase())
  })

  it('mirrors managers list into the SMA accounts list', async () => {
    await fix.api.post('/api/manager/complete').send({ newManager: MANAGER_B })

    const accounts = await fix.api.get('/api/accounts')
    const target = accounts.body.find((a) => a.safe.toLowerCase() === SAFE.toLowerCase())
    const managers = target?.managers?.map((a) => a.toLowerCase()) ?? []
    expect(managers).toContain(MANAGER_A.toLowerCase())
    expect(managers).toContain(MANAGER_B.toLowerCase())
  })

  it('records the rotation in the activity log', async () => {
    await fix.api.post('/api/manager/complete').send({ newManager: MANAGER_B })
    const activity = await fix.api.get('/api/activity')
    const ev = activity.body.find((e) => e.type === 'signer_rotated')
    expect(ev).toBeTruthy()
    expect(ev.newManager.toLowerCase()).toBe(MANAGER_B.toLowerCase())
  })

  it('rejects an invalid manager address', async () => {
    const res = await fix.api.post('/api/manager/complete').send({ newManager: 'not-an-address' })
    expect(res.status).toBe(400)
  })

  it('rejects a missing manager address', async () => {
    const res = await fix.api.post('/api/manager/complete').send({})
    expect(res.status).toBe(400)
  })
})
