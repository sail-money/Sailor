import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

// The per-permission registration fee surfaced through the UI's HTTP layer:
//  - the activity log records the fee actually paid on registration, and
//  - the mandate draft carries the live fee for the sign-time disclosure.

describe('activity log records the registration fee', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('round-trips fee fields on a permission_registered event', async () => {
    const post = await fix.api.post('/api/activity').send({
      type: 'permission_registered',
      actor: 'agent',
      name: 'boundedApprove',
      permission: '0x1111111111111111111111111111111111111111',
      txHash: '0xabc',
      fee: '10000000000000',
      feeEth: '0.00001',
    })
    expect(post.status).toBe(200)
    expect(post.body.ok).toBe(true)
    expect(post.body.event.fee).toBe('10000000000000')
    expect(post.body.event.feeEth).toBe('0.00001')

    const events = (await fix.api.get('/api/activity')).body
    const registered = events.find(
      (e) => e.type === 'permission_registered' && e.name === 'boundedApprove',
    )
    expect(registered).toBeTruthy()
    expect(registered.fee).toBe('10000000000000')
    expect(registered.feeEth).toBe('0.00001')
  })
})

describe('mandate draft carries the registration fee for sign-time disclosure', () => {
  let fix
  const draft = {
    account: '0x2222222222222222222222222222222222222222',
    chainId: 84532,
    permissions: [
      { address: '0x3333333333333333333333333333333333333333', label: 'boundedApprove' },
      { address: '0x4444444444444444444444444444444444444444', label: 'sharedTransfer' },
      { address: '0x5555555555555555555555555555555555555555', label: 'boundedCall' },
    ],
    createdAt: '2026-06-17T00:00:00Z',
    registrationFee: {
      perPermissionWei: '10000000000000',
      perPermissionEth: '0.00001',
      totalWei: '30000000000000',
      totalEth: '0.00003',
      permissionCount: 3,
      disclosure: 'Registration fee: 0.00003 ETH (3 permissions × 0.00001 ETH)',
    },
  }

  beforeEach(() => {
    fix = loadFixture('onboarded', { 'mandate-draft.json': JSON.stringify(draft) })
  })
  afterEach(() => fix.cleanup())

  it('GET /api/mandate-draft returns the embedded fee block (fee × N)', async () => {
    const res = await fix.api.get('/api/mandate-draft')
    expect(res.status).toBe(200)
    expect(res.body.registrationFee).toBeTruthy()
    expect(res.body.registrationFee.permissionCount).toBe(3)
    expect(res.body.registrationFee.totalEth).toBe('0.00003')
    expect(res.body.registrationFee.disclosure).toBe(
      'Registration fee: 0.00003 ETH (3 permissions × 0.00001 ETH)',
    )
  })
})
