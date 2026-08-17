import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { startServer } from '../../server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(__dirname, '../fixtures')

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d)
  }
}

/**
 * Copies a named fixture to a fresh temp dir and starts the server on an
 * ephemeral port. Returns { server, api, sailDir, projectRoot, cleanup }.
 *
 * `patches` is an object of relative-path → string content written into the
 * temp dir after copying, so individual tests can tweak state without forking
 * a new fixture folder. `opts.mode: 'sandbox'` starts the server with the
 * /api/sandbox/* routes enabled, same as a real sandbox instance.
 *
 * Usage:
 *   const { api, cleanup } = loadFixture('onboarded')
 *   const res = await api.get('/api/overview')
 *   cleanup()
 */
export function loadFixture(name, patches = {}, opts = {}) {
  const src = path.join(FIXTURES, name)
  // `projectRoot` is the per-test isolated PROJECT root (like a real checkout); the fixture content
  // is the project's state dir — matching real usage (sailDir = <project>/.sail, or
  // <project>/.shipyard/sandbox for the native sandbox) so anything the server resolves relative to
  // sailDir's parent (e.g. `src/strategy/*.ts`) also lands inside `projectRoot` and gets removed by
  // `cleanup()` below, instead of escaping to a path shared across test runs.
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `sailor-test-${name}-`))
  const sailDir = path.join(
    projectRoot,
    opts.sailDirRel ?? (opts.mode === 'sandbox' ? path.join('.shipyard', 'sandbox') : '.sail'),
  )
  copyDir(src, sailDir)

  for (const [rel, content] of Object.entries(patches)) {
    const dest = path.join(sailDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, content)
  }

  const server = startServer(sailDir, { port: 0, mode: opts.mode ?? 'live', projectRoot })

  return {
    server,
    api: request(server),
    sailDir,
    projectRoot,
    cleanup() {
      server.close()
      fs.rmSync(projectRoot, { recursive: true, force: true })
    },
  }
}

/**
 * Returns a fresh activity.jsonl line with a timestamp `msAgo` milliseconds
 * in the past. Default 60 000 ms (1 minute) = within the 10-minute remote
 * agent window.
 */
export function recentActivityLine(msAgo = 60_000) {
  const ts = new Date(Date.now() - msAgo).toISOString()
  return JSON.stringify({
    ts,
    type: 'tick_end',
    actor: 'agent',
    safe: '0x8E637d9573Ad81B60cb93edA78b9C827860950a4',
  })
}
