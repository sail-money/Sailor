import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

const TOKEN = 'test-api-token'

describe('SAILOR_API_TOKEN gate', () => {
  let fix

  beforeEach(() => {
    const previous = process.env.SAILOR_API_TOKEN
    process.env.SAILOR_API_TOKEN = TOKEN
    try {
      fix = loadFixture('onboarded')
    } finally {
      if (previous === undefined) delete process.env.SAILOR_API_TOKEN
      else process.env.SAILOR_API_TOKEN = previous
    }
  })

  afterEach(() => {
    fix.cleanup()
  })

  it('rejects privileged routes without a bearer token', async () => {
    const switchRes = await fix.api.post('/api/account/switch').send({ safe: '0x8E637d9573Ad81B60cb93edA78b9C827860950a4' })
    expect(switchRes.status).toBe(401)

    const statusRes = await fix.api.post('/api/agent-status').send({ running: false })
    expect(statusRes.status).toBe(401)

    const strategies = await fix.api.get('/api/strategies')
    expect(strategies.status).toBe(401)
  })

  it('allows privileged routes with the bearer token', async () => {
    const res = await fix.api
      .get('/api/strategies')
      .set('Authorization', `Bearer ${TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('strategies')
  })

  it('leaves /api/mode and /api/version public', async () => {
    const mode = await fix.api.get('/api/mode')
    expect(mode.status).toBe(200)

    const version = await fix.api.get('/api/version')
    expect(version.status).toBe(200)
  })
})
