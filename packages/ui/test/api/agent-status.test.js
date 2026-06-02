import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture, recentActivityLine } from '../helpers/fixture.js'

describe('GET /api/agent-status', () => {
  describe('no activity, no PID → not running', () => {
    let fix
    beforeEach(() => { fix = loadFixture('onboarded') })
    afterEach(() => fix.cleanup())

    it('returns running:false when last activity is old', async () => {
      const res = await fix.api.get('/api/agent-status')
      expect(res.status).toBe(200)
      expect(res.body.running).toBe(false)
    })
  })

  describe('recent activity → remote agent detected', () => {
    let fix
    beforeEach(() => {
      fix = loadFixture('onboarded', {
        'activity.jsonl': recentActivityLine(60_000) + '\n',
      })
    })
    afterEach(() => fix.cleanup())

    it('returns running:true with source:remote when activity < 10 min old', async () => {
      const res = await fix.api.get('/api/agent-status')
      expect(res.status).toBe(200)
      expect(res.body.running).toBe(true)
      expect(res.body.source).toBe('remote')
      expect(typeof res.body.lastActivityMs).toBe('number')
      expect(res.body.lastActivityMs).toBeLessThan(10 * 60 * 1000)
    })
  })

  describe('fresh fixture → not running', () => {
    let fix
    beforeEach(() => { fix = loadFixture('fresh') })
    afterEach(() => fix.cleanup())

    it('returns running:false with no errors', async () => {
      const res = await fix.api.get('/api/agent-status')
      expect(res.status).toBe(200)
      expect(res.body.running).toBe(false)
    })
  })
})
