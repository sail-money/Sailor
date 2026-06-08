import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

describe('GET /api/activity', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('returns array of events', async () => {
    const res = await fix.api.get('/api/activity')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('events have ts and type fields', async () => {
    const res = await fix.api.get('/api/activity')
    for (const ev of res.body) {
      expect(ev).toHaveProperty('ts')
      expect(ev).toHaveProperty('type')
    }
  })

  it('includes tick_start, log, tick_end, and owner_signed events', async () => {
    const res = await fix.api.get('/api/activity')
    const types = new Set(res.body.map(e => e.type))
    expect(types.has('tick_start')).toBe(true)
    expect(types.has('tick_end')).toBe(true)
    expect(types.has('log')).toBe(true)
    expect(types.has('owner_signed')).toBe(true)
  })
})

describe('GET /api/activity (no file)', () => {
  let fix
  beforeEach(() => { fix = loadFixture('fresh') })
  afterEach(() => fix.cleanup())

  it('returns empty array when no activity.jsonl', async () => {
    const res = await fix.api.get('/api/activity')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('POST /api/activity', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('appends a new event and returns it', async () => {
    const before = (await fix.api.get('/api/activity')).body.length

    const res = await fix.api.post('/api/activity').send({
      type: 'owner_signed',
      msg: 'Test event from test suite',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.event.type).toBe('owner_signed')
    expect(res.body.event.ts).toBeTruthy()

    const after = (await fix.api.get('/api/activity')).body.length
    expect(after).toBe(before + 1)
  })

  it('rejects events without a type', async () => {
    const res = await fix.api.post('/api/activity').send({ msg: 'no type' })
    expect(res.status).toBe(400)
  })
})
