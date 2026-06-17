import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ISOLATION (the core property of the rewards module):
 *
 * The operational dashboard must NOT import from or depend on the rewards
 * module. If `src/pages/rewards/` were deleted, the dashboard must compile and
 * run exactly as today. The only file allowed to reference the rewards module
 * is the top-level router (`main.jsx`).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '../../src')
const REWARDS_DIR = path.join(SRC, 'pages/rewards')

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (/\.(jsx?|css)$/.test(entry.name)) out.push(p)
  }
  return out
}

/** Files that make up the operational app, EXCLUDING the rewards module itself
 *  and the router that wires it in. */
function operationalFiles() {
  return walk(SRC).filter(
    (f) => !f.startsWith(REWARDS_DIR) && path.basename(f) !== 'main.jsx',
  )
}

describe('rewards module is fully isolated from the operational app', () => {
  it('no operational file imports the rewards module', () => {
    const offenders = []
    for (const f of operationalFiles()) {
      const src = fs.readFileSync(f, 'utf-8')
      // Catch any import/require referencing the rewards module path.
      if (/pages\/rewards/.test(src)) offenders.push(path.relative(SRC, f))
    }
    expect(offenders).toEqual([])
  })

  it('the dashboard, in particular, has no rewards import', () => {
    const dashDir = path.join(SRC, 'pages/dashboard')
    for (const f of walk(dashDir)) {
      const src = fs.readFileSync(f, 'utf-8')
      expect(src.includes('pages/rewards')).toBe(false)
    }
  })

  it('the rewards module does not import from the dashboard (one-directional)', () => {
    for (const f of walk(REWARDS_DIR)) {
      const src = fs.readFileSync(f, 'utf-8')
      expect(src.includes('pages/dashboard')).toBe(false)
    }
  })

  it('only the router references the rewards page (the single wiring point)', () => {
    const main = fs.readFileSync(path.join(SRC, 'main.jsx'), 'utf-8')
    expect(main.includes('pages/rewards/RewardsPage')).toBe(true)
    expect(main.includes("route.startsWith('/rewards')")).toBe(true)
  })

  it('removing the rewards dir would not break dashboard imports (proven by the above + a dependency scan)', () => {
    // The rewards module imports only shared/design + shared hooks + its own
    // files — never dashboard internals — so it is safe to delete in isolation.
    const allowedPrefixes = ['../shared', '../../hooks', '../../data', './', 'react', 'wagmi', 'viem']
    for (const f of walk(REWARDS_DIR)) {
      if (!f.endsWith('.jsx') && !f.endsWith('.js')) continue
      const src = fs.readFileSync(f, 'utf-8')
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
      for (const imp of imports) {
        const ok = allowedPrefixes.some((p) => imp === p || imp.startsWith(p))
        expect(ok, `unexpected rewards import: ${imp} in ${path.basename(f)}`).toBe(true)
      }
    }
  })
})
