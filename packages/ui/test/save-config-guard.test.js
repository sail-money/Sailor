import assert from 'node:assert/strict'
import { test } from 'vitest'
import { isHttpUrl, isSafeEnvValue } from '../server.js'

// Guards the .env.local injection fix (server.js POST /api/onboard/save-config):
// a newline in a value would inject an extra KEY=VALUE line — e.g. overwrite
// SAIL_PASSPHRASE — when the env file is re-serialized as `${k}=${v}` per line.
test('isSafeEnvValue rejects newline-injection payloads', () => {
  assert.equal(isSafeEnvValue('https://mainnet.base.org'), true)
  assert.equal(isSafeEnvValue('1\nSAIL_PASSPHRASE=attacker'), false)
  assert.equal(isSafeEnvValue('x\rY=z'), false)
  assert.equal(isSafeEnvValue(42), false)
})

test('isHttpUrl accepts http(s) only', () => {
  assert.equal(isHttpUrl('https://mainnet.base.org'), true)
  assert.equal(isHttpUrl('http://localhost:8545'), true)
  assert.equal(isHttpUrl('file:///etc/passwd'), false)
  assert.equal(isHttpUrl('1\nSAIL_PASSPHRASE=x'), false)
  assert.equal(isHttpUrl('not a url'), false)
})
