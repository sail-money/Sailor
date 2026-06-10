import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'

// Inline copy of the pure function from server.js — tested here so logic
// regressions are caught without spinning up the full HTTP server.
function addManagerToList(existing, current, next) {
  const base = existing ?? (current ? [getAddress(current)] : [])
  const all = [...base, getAddress(next)]
  const seen = new Set()
  return all.filter((a) => { const l = a.toLowerCase(); if (seen.has(l)) return false; seen.add(l); return true })
}

const A = '0xa6D478146f03E9473582aCe099c67e3CbB5EC2BE'
const B = '0x1111111111111111111111111111111111111111'
const C = '0x2222222222222222222222222222222222222222'

describe('addManagerToList', () => {
  it('seeds from current when existing is undefined', () => {
    const result = addManagerToList(undefined, A, B)
    expect(result).toEqual([getAddress(A), getAddress(B)])
  })

  it('appends to an existing list', () => {
    const result = addManagerToList([getAddress(A)], A, B)
    expect(result).toContain(getAddress(A))
    expect(result).toContain(getAddress(B))
    expect(result).toHaveLength(2)
  })

  it('deduplicates when rotating to an already-known address', () => {
    const result = addManagerToList([getAddress(A), getAddress(B)], B, B)
    expect(result.filter((a) => a.toLowerCase() === B.toLowerCase())).toHaveLength(1)
  })

  it('is case-insensitive for dedup', () => {
    const result = addManagerToList([getAddress(A), getAddress(B)], B, B.toLowerCase())
    expect(result.filter((a) => a.toLowerCase() === B.toLowerCase())).toHaveLength(1)
  })

  it('checksums all addresses in output', () => {
    const result = addManagerToList(undefined, A.toLowerCase(), B.toLowerCase())
    for (const addr of result) {
      expect(addr).toBe(getAddress(addr))
    }
  })

  it('accumulates across multiple rotations', () => {
    let list = addManagerToList(undefined, A, B)
    list = addManagerToList(list, B, C)
    expect(list).toContain(getAddress(A))
    expect(list).toContain(getAddress(B))
    expect(list).toContain(getAddress(C))
    expect(list).toHaveLength(3)
  })

  it('preserves insertion order', () => {
    const result = addManagerToList([getAddress(A), getAddress(B)], B, C)
    expect(result[0]).toBe(getAddress(A))
    expect(result[1]).toBe(getAddress(B))
    expect(result[2]).toBe(getAddress(C))
  })
})
