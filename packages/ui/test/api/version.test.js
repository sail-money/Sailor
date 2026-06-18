import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

describe('GET /api/version', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('reports running/installed versions and is not stale in a single process', async () => {
    const res = await fix.api.get('/api/version')
    expect(res.status).toBe(200)
    // running is the version this process started with; installed is read live.
    // In one process they're the same, so the dashboard must NOT show the banner.
    expect(res.body).toHaveProperty('running')
    expect(res.body).toHaveProperty('installed')
    expect(res.body.stale).toBe(false)
  })
})
