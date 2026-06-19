/**
 * Standalone script used by playwright.config.js as the webServer command.
 * Copies the 'onboarded' fixture to a temp dir, starts server.js with
 * SERVE_DIST=1 on port 14333, and keeps alive until the process is killed.
 *
 * The port is hardcoded so Playwright's `url` health-check knows where to look.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../../server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI_TEST_PORT = Number(process.env.SAILOR_TEST_PORT ?? 14333)

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d)
  }
}

const fixture = path.join(__dirname, '../fixtures/onboarded')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sailor-ui-playwright-'))
copyDir(fixture, tmp)

const uiDist = path.resolve(__dirname, '../../dist')
process.env.SERVE_DIST = '1'
process.env.SAILOR_UI_DIST = uiDist

startServer(tmp, { port: UI_TEST_PORT })

process.on('SIGTERM', () => {
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(0)
})
process.on('SIGINT', () => {
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(0)
})
