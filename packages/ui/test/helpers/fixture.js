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
 * ephemeral port. Returns { server, api, sailDir, cleanup }.
 *
 * `patches` is an object of relative-path → string content written into the
 * temp dir after copying, so individual tests can tweak state without forking
 * a new fixture folder.
 *
 * Usage:
 *   const { api, cleanup } = loadFixture('onboarded')
 *   const res = await api.get('/api/overview')
 *   cleanup()
 */
export function loadFixture(name, patches = {}) {
  const src = path.join(FIXTURES, name)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `sailor-test-${name}-`))
  copyDir(src, tmp)

  for (const [rel, content] of Object.entries(patches)) {
    const dest = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, content)
  }

  const server = startServer(tmp, { port: 0 })

  return {
    server,
    api: request(server),
    sailDir: tmp,
    cleanup() {
      server.close()
      fs.rmSync(tmp, { recursive: true, force: true })
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
