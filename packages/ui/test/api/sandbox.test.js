import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadFixture } from '../helpers/fixture.js'

describe('GET /api/mode', () => {
  it('reports live on a plain server instance', async () => {
    const fix = loadFixture('fresh')
    try {
      const res = await fix.api.get('/api/mode')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ mode: 'live' })
    } finally {
      fix.cleanup()
    }
  })

  it('reports sandbox when started with mode: sandbox', async () => {
    const fix = loadFixture('fresh', {}, { mode: 'sandbox' })
    try {
      const res = await fix.api.get('/api/mode')
      expect(res.body).toEqual({ mode: 'sandbox' })
    } finally {
      fix.cleanup()
    }
  })
})

describe('/api/sandbox/* route gating', () => {
  it('is never registered on a live-mode server — no branch to forget', async () => {
    const fix = loadFixture('fresh')
    try {
      // Express's SPA catch-all (`app.get('*', ...)`, when a UI dist build is
      // present) answers 200 for any unmatched route, so the real signal here
      // is that the response is NOT the sandbox JSON shape — the route handler
      // itself was never added to this app.
      const res = await fix.api.get('/api/sandbox/forks')
      expect(res.body).not.toHaveProperty('forks')
    } finally {
      fix.cleanup()
    }
  })
})

describe('POST /api/sandbox/forks validation', () => {
  let fix
  beforeEach(() => { fix = loadFixture('fresh', {}, { mode: 'sandbox' }) })
  afterEach(() => fix.cleanup())

  it('rejects an empty chainIds array', async () => {
    const res = await fix.api.post('/api/sandbox/forks').send({ chainIds: [] })
    expect(res.status).toBe(400)
  })

  it('rejects non-integer chain ids', async () => {
    const res = await fix.api.post('/api/sandbox/forks').send({ chainIds: ['base'] })
    expect(res.status).toBe(400)
  })

  it('rejects a chain with no Sail deployment before ever touching the fork engine', async () => {
    const res = await fix.api.post('/api/sandbox/forks').send({ chainIds: [999999] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no Sail deployment/i)
  })

  it('rejects a 4th chain — the cap is enforced server-side, not just in the UI', async () => {
    // 8453 Base, 42161 Arbitrum, 1 Ethereum all have bundled deployments; a 4th
    // (10 Optimism) pushes this over MAX_SANDBOX_CHAINS regardless of validity.
    const res = await fix.api.post('/api/sandbox/forks').send({ chainIds: [8453, 42161, 1, 10] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at most 3/i)
  }, 10_000)
})

describe('sandbox state isolation', () => {
  it('never writes into a sibling live sailDir, and vice versa', async () => {
    const live = loadFixture('fresh')
    const sandbox = loadFixture('fresh', {}, { mode: 'sandbox' })
    try {
      // Two genuinely separate temp roots, one per mode/instance — the same
      // shape a real project's .sail/ vs .shipyard/sandbox/ split relies on.
      expect(sandbox.sailDir).not.toBe(live.sailDir)

      const res = await sandbox.api.post('/api/activity').send({ type: 'sandbox-only-marker' })
      expect(res.status).toBe(200)

      const sandboxLog = fs.readFileSync(path.join(sandbox.sailDir, 'activity.jsonl'), 'utf-8')
      expect(sandboxLog).toContain('sandbox-only-marker')

      // The live fixture's own root must be completely untouched by that write.
      expect(fs.existsSync(path.join(live.sailDir, 'activity.jsonl'))).toBe(false)
      const liveRes = await live.api.get('/api/activity')
      expect(liveRes.status).toBe(200)
      expect(JSON.stringify(liveRes.body)).not.toContain('sandbox-only-marker')
    } finally {
      live.cleanup()
      sandbox.cleanup()
    }
  })
})
