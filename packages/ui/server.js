import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'
import { LocalKeyring, SAFE_V141, SailKernelAbi, buildSafeSetupInitializer, getSailDeployment } from '@sail/sdk'
import { createPublicClient, encodeFunctionData, formatEther, getAddress, http, isAddress, toHex, zeroAddress } from 'viem'
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'

const PORT = Number(process.env.PORT ?? 3334)

// Resolve the current file path in both ESM and esbuild CJS bundles.
// import.meta.url is undefined in CJS bundles; __filename is the fallback.
const _thisFile = (() => {
  try { return fileURLToPath(import.meta.url) } catch { return __filename }
})()

// ── Overview helpers ─────────────────────────────────────────────────────────

/** Minimal `.env`-style parser for `.sail/.env.local` (RPC_URL, KERNEL_ADDRESS…). */
function parseEnvFile(file) {
  const out = {}
  let raw
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

const CHAIN_NAMES = {
  1: 'ethereum',
  10: 'optimism',
  137: 'polygon',
  8453: 'base',
  42161: 'arbitrum',
  84532: 'base-sepolia',
  130: 'unichain',
}

/**
 * Classify a native-balance reading into a top-up status. Thresholds are in
 * ETH and deliberately conservative — Base gas is cheap, so "low" is an early
 * heads-up to refill a delegated signer, not an outage.
 */
function balanceStatus(wei) {
  if (wei === 0n) return 'critical'
  const eth = Number(formatEther(wei))
  if (eth < 0.002) return 'low'
  return 'ok'
}

function signerEntry(role, address, balanceByAddr) {
  const wei = balanceByAddr.get(address.toLowerCase()) ?? 0n
  return {
    role,
    address,
    balanceWei: wei.toString(),
    balanceEth: formatEther(wei),
    status: balanceStatus(wei),
  }
}

/** Deduplicated managers list that always includes both the old and new address. */
function addManagerToList(existing, current, next) {
  const base = existing ?? (current ? [getAddress(current)] : [])
  const all = [...base, getAddress(next)]
  const seen = new Set()
  return all.filter((a) => { const l = a.toLowerCase(); if (seen.has(l)) return false; seen.add(l); return true })
}

const OVERVIEW_TTL_MS = 10_000

/**
 * Tiny local data server for the Sailor UI.
 *
 * Reads project state from the `.sail/` directory on disk and exposes it
 * over HTTP so the (browser-based) UI can render real account + activity
 * data. There is no hosted backend — this runs on the user's machine
 * alongside the Vite dev server.
 *
 * @param {string} sailDir Absolute path to the project's `.sail/` directory.
 */
export function startServer(sailDir, { port = PORT } = {}) {
  const app = express()
  app.use(cors({ origin: 'http://localhost:3333' }))
  app.use(express.json())

  const at = (name) => path.join(sailDir, name)

  // ── Per-SMA overview cache ───────────────────────────────────────────────
  // Switching between SMAs should feel instant. The consolidated overview is
  // several RPC reads, so we cache it per account (keyed by safe address) in
  // memory AND on disk. A switch serves the last snapshot immediately and
  // refreshes from chain in the background (stale-while-revalidate), so the UI
  // never blocks on RPC for an SMA it has seen before — even across restarts.
  const overviewCacheByAccount = new Map() // safeLower -> { at, data }
  const overviewInFlight = new Set() // safeLower currently refreshing
  const overviewSnapshotPath = (safe) => at(`state/overview/${safe.toLowerCase()}.json`)

  const readOverviewSnapshot = (safe) => {
    try {
      return JSON.parse(fs.readFileSync(overviewSnapshotPath(safe), 'utf-8'))
    } catch {
      return null
    }
  }
  const writeOverviewSnapshot = (safe, data) => {
    try {
      fs.mkdirSync(at('state/overview'), { recursive: true })
      fs.writeFileSync(overviewSnapshotPath(safe), `${JSON.stringify(data, null, 2)}\n`)
    } catch {
      /* best-effort disk cache — fine if it fails */
    }
  }
  const storeOverview = (safe, data) => {
    overviewCacheByAccount.set(safe.toLowerCase(), { at: Date.now(), data })
    writeOverviewSnapshot(safe, data)
  }
  // Refresh one account's overview from chain in the background, deduped per safe.
  const refreshOverviewInBackground = (account) => {
    const key = account.safe.toLowerCase()
    if (overviewInFlight.has(key)) return
    overviewInFlight.add(key)
    computeOverview(account)
      .then((data) => storeOverview(account.safe, data))
      .catch(() => {})
      .finally(() => overviewInFlight.delete(key))
  }

  // GET /api/account — the deployed SMA, or 404 before it exists.
  app.get('/api/account', (_req, res) => {
    try {
      const raw = fs.readFileSync(at('account.json'), 'utf-8')
      res.json(JSON.parse(raw))
    } catch {
      res.status(404).json({ error: 'account not found' })
    }
  })

  // DELETE /api/account — remove account.json so the onboarding wizard shows again.
  app.delete('/api/account', (_req, res) => {
    try {
      fs.rmSync(at('account.json'), { force: true })
      overviewCacheByAccount.clear()
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // POST /api/account — persist a newly deployed SMA from the browser signing flow.
  app.post('/api/account', (req, res) => {
    const { safe, owner, permissionSigner, manager, chainId, createdAtBlock } = req.body ?? {}
    if (!safe || !owner || !chainId) {
      res.status(400).json({ error: 'safe, owner, and chainId are required' })
      return
    }
    try {
      fs.mkdirSync(at('state'), { recursive: true })
      const record = { safe, owner, permissionSigner: permissionSigner ?? owner, manager: manager ?? owner, chainId, createdAtBlock: createdAtBlock ?? '0' }

      // Load the known-SMAs list. If it doesn't exist yet, the first SMA was
      // created outside the browser (CLI / onboarding writes account.json
      // directly and never seeds this list). Backfill it from the currently
      // active account.json *before* we overwrite it, otherwise creating a
      // second SMA would silently drop the first from the list.
      const accountsPath = at('state/accounts.json')
      let accounts = []
      try {
        accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'))
      } catch {
        try {
          const prev = JSON.parse(fs.readFileSync(at('account.json'), 'utf-8'))
          if (prev?.safe) accounts.push({ ...prev, name: 'SMA 1', addedAt: null })
        } catch { /* truly the first SMA — nothing to backfill */ }
      }

      if (!accounts.find((a) => a.safe.toLowerCase() === safe.toLowerCase())) {
        accounts.push({ ...record, name: `SMA ${accounts.length + 1}`, addedAt: new Date().toISOString() })
      }
      fs.writeFileSync(accountsPath, `${JSON.stringify(accounts, null, 2)}\n`)

      // Make the new SMA the active one.
      fs.writeFileSync(at('account.json'), `${JSON.stringify(record, null, 2)}\n`)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // GET /api/accounts — all known SMAs in order of creation.
  app.get('/api/accounts', (_req, res) => {
    try {
      const accounts = JSON.parse(fs.readFileSync(at('state/accounts.json'), 'utf-8'))
      // Annotate which one is currently active
      let active = null
      try { active = JSON.parse(fs.readFileSync(at('account.json'), 'utf-8')).safe } catch { /* none */ }
      res.json(accounts.map((a) => ({ ...a, active: a.safe.toLowerCase() === active?.toLowerCase() })))
    } catch {
      // Fall back to current account.json as a single-item list
      try {
        const a = JSON.parse(fs.readFileSync(at('account.json'), 'utf-8'))
        res.json([{ ...a, name: 'My SMA', active: true, addedAt: null }])
      } catch {
        res.json([])
      }
    }
  })

  // POST /api/account/switch — make a known SMA the active one.
  app.post('/api/account/switch', (req, res) => {
    const { safe } = req.body ?? {}
    if (!safe) { res.status(400).json({ error: 'safe is required' }); return }
    try {
      const accounts = JSON.parse(fs.readFileSync(at('state/accounts.json'), 'utf-8'))
      const target = accounts.find((a) => a.safe.toLowerCase() === safe.toLowerCase())
      if (!target) { res.status(404).json({ error: 'SMA not found in accounts list' }); return }
      fs.writeFileSync(at('account.json'), `${JSON.stringify(target, null, 2)}\n`)
      res.json({ ok: true, active: target })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // POST /api/account/rename — update the display name of a known SMA.
  app.post('/api/account/rename', (req, res) => {
    const { safe, name } = req.body ?? {}
    if (!safe || !name) { res.status(400).json({ error: 'safe and name are required' }); return }
    try {
      const accountsPath = at('state/accounts.json')
      const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'))
      const idx = accounts.findIndex((a) => a.safe.toLowerCase() === safe.toLowerCase())
      if (idx === -1) { res.status(404).json({ error: 'SMA not found' }); return }
      accounts[idx] = { ...accounts[idx], name }
      fs.writeFileSync(accountsPath, `${JSON.stringify(accounts, null, 2)}\n`)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // The active SMA's address, or null before one exists.
  const readActiveSafe = () => {
    try {
      return JSON.parse(fs.readFileSync(at('account.json'), 'utf-8')).safe ?? null
    } catch {
      return null
    }
  }

  // GET /api/activity — events for the *active* SMA only. Each event carries a
  // `safe` tag (stamped on write); legacy events written before per-SMA tagging
  // have none and are attributed to the first known SMA — the one that existed
  // before a second was ever created. With a single SMA (no accounts list) we
  // don't filter, preserving the original behavior.
  app.get('/api/activity', (_req, res) => {
    try {
      const raw = fs.readFileSync(at('activity.jsonl'), 'utf-8')
      const events = raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter((e) => e !== null)

      const activeSafe = readActiveSafe()
      let knownCount = 0
      let legacySafe = activeSafe
      try {
        const accts = JSON.parse(fs.readFileSync(at('state/accounts.json'), 'utf-8'))
        knownCount = accts.length
        if (accts[0]?.safe) legacySafe = accts[0].safe
      } catch {
        /* no list yet — single-SMA project */
      }

      // Only one (or zero) SMA in play: nothing to disambiguate, return all.
      if (!activeSafe || knownCount < 2) {
        res.json(events)
        return
      }

      const active = activeSafe.toLowerCase()
      const fallback = (legacySafe ?? activeSafe).toLowerCase()
      res.json(events.filter((e) => (e.safe ? String(e.safe).toLowerCase() : fallback) === active))
    } catch {
      res.json([])
    }
  })

  // GET /api/positions — latest positions snapshot from state/positions-<chainId>.json
  app.get('/api/positions', (_req, res) => {
    try {
      const account = JSON.parse(fs.readFileSync(at('account.json'), 'utf-8'))
      const chainId = account?.chainId ?? 8453
      const posFile = at(`state/positions-${chainId}.json`)
      const data = JSON.parse(fs.readFileSync(posFile, 'utf-8'))
      res.json(data)
    } catch {
      res.json({ positions: [], updatedAt: null })
    }
  })

  // POST /api/activity — append one event to the unified log. Used by the
  // browser for owner-submitted actions (e.g. a wallet-signed mandate revoke)
  // so they show up in Recent Activity alongside CLI- and agent-written events.
  // Local-first, single user: we trust the caller and only require a `type`.
  app.post('/api/activity', (req, res) => {
    const ev = req.body
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') {
      res.status(400).json({ error: 'event with a string "type" is required' })
      return
    }
    // Tag the event with the SMA it belongs to so Recent Activity stays
    // per-SMA. Honor an explicit `safe` if the caller set one.
    const event = {
      ...ev,
      ts: ev.ts ?? new Date().toISOString(),
      actor: ev.actor ?? 'owner',
      safe: ev.safe ?? readActiveSafe() ?? undefined,
    }
    try {
      fs.mkdirSync(sailDir, { recursive: true })
      fs.appendFileSync(at('activity.jsonl'), `${JSON.stringify(event)}\n`)
      res.json({ ok: true, event })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // Per-SMA delegated-signer keystore path. Canonical form keeps the `0x`
  // prefix — manager-0x<address>.json — matching the CLI's keyPath() so both
  // write/read the same file for a given SMA.
  const managerKeyPath = (safe) => at(`keys/manager-${safe.toLowerCase()}.json`)
  // Legacy per-SMA filename written by older CLIs (no `0x` prefix). Read as a
  // fallback so a key created by an older CLI is still discovered.
  const legacyManagerKeyPath = (safe) => at(`keys/manager-${safe.toLowerCase().replace(/^0x/, '')}.json`)

  // POST /api/signer — create or import the delegated-signer (manager) key for
  // the active SMA. Stored as a geth-v3 encrypted keystore (scrypt + aes-128-ctr,
  // the same format `sailor run` loads) at .sail/keys/manager-<safe>.json.
  //
  // Security: the secret (private key / recovery phrase) and the password are
  // used only to derive + encrypt the key, are NEVER logged, and are NEVER
  // returned to the browser. The one exception is `method: "generate"`, which
  // returns the freshly-minted private key exactly once so the user can back it
  // up — after that it lives only inside the encrypted keystore.
  app.post('/api/signer', async (req, res) => {
    const { method, secret, password, derivationPath } = req.body ?? {}
    if (typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'A password of at least 8 characters is required to encrypt the key.' })
      return
    }
    const safe = readActiveSafe()
    if (!safe) {
      res.status(400).json({ error: 'No active SMA to attach a signer to.' })
      return
    }

    // Resolve a raw private key from the chosen method.
    let privateKey
    let revealed = null
    try {
      if (method === 'generate') {
        privateKey = generatePrivateKey()
        revealed = privateKey // shown to the user once, for backup
      } else if (method === 'privateKey') {
        if (typeof secret !== 'string' || !secret.trim()) throw new Error('Enter a private key.')
        const pk = secret.trim().startsWith('0x') ? secret.trim() : `0x${secret.trim()}`
        privateKeyToAccount(pk) // throws on malformed key
        privateKey = pk
      } else if (method === 'mnemonic') {
        const phrase = typeof secret === 'string' ? secret.trim().replace(/\s+/g, ' ') : ''
        const words = phrase ? phrase.split(' ').length : 0
        if (words !== 12 && words !== 24) throw new Error('Enter a 12- or 24-word recovery phrase.')
        const acct = mnemonicToAccount(phrase, derivationPath ? { path: derivationPath } : undefined)
        const pkBytes = acct.getHdKey().privateKey
        if (!pkBytes) throw new Error('Could not derive a key from that phrase.')
        privateKey = toHex(pkBytes)
      } else {
        throw new Error('Unknown method — expected generate, privateKey, or mnemonic.')
      }
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid key material.' })
      return
    }

    try {
      const keyring = LocalKeyring.fromPrivateKey(privateKey)
      const keystore = await keyring.exportKeystore(password)
      fs.mkdirSync(at('keys'), { recursive: true })
      fs.writeFileSync(managerKeyPath(safe), `${JSON.stringify(keystore, null, 2)}\n`)

      // Record the creation (address only — never the secret) in the activity log.
      try {
        const ev = { ts: new Date().toISOString(), actor: 'owner', type: 'signer_created', method, address: keyring.address, safe }
        fs.appendFileSync(at('activity.jsonl'), `${JSON.stringify(ev)}\n`)
      } catch { /* non-fatal */ }

      // Invalidate the cached overview so the new local signer shows immediately.
      overviewCacheByAccount.delete(safe.toLowerCase())
      try { fs.rmSync(overviewSnapshotPath(safe)) } catch { /* none */ }

      res.json({ ok: true, address: keyring.address, revealed })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // POST /api/manager/complete { newManager, txHash } — called by the dashboard
  // after the owner's on-chain rotation (Safe.execTransaction → setManager)
  // confirms. Persists the new delegated signer into account.json + the
  // multi-SMA list (so `sailor run` / the switcher read it), records the event,
  // and drops the cached overview so the new signer shows immediately. The
  // on-chain rotation is the source of truth; this only keeps local state in sync.
  app.post('/api/manager/complete', (req, res) => {
    const { newManager, txHash } = req.body ?? {}
    if (!isAddress(newManager)) {
      res.status(400).json({ error: 'newManager must be a valid address' })
      return
    }
    const safe = readActiveSafe()
    if (!safe) {
      res.status(400).json({ error: 'No active SMA.' })
      return
    }
    try {
      const manager = getAddress(newManager)
      // Update the active account.json.
      try {
        const account = JSON.parse(fs.readFileSync(at('account.json'), 'utf-8'))
        if (account?.safe?.toLowerCase() === safe.toLowerCase()) {
          const managers = addManagerToList(account.managers, account.manager, manager)
          fs.writeFileSync(at('account.json'), `${JSON.stringify({ ...account, manager, managers }, null, 2)}\n`)
        }
      } catch { /* no account.json — nothing to update */ }
      // Update the matching entry in the multi-SMA list.
      try {
        const listPath = at('state/accounts.json')
        const list = JSON.parse(fs.readFileSync(listPath, 'utf-8'))
        const idx = list.findIndex((a) => a.safe?.toLowerCase() === safe.toLowerCase())
        if (idx !== -1) {
          const entry = list[idx]
          const managers = addManagerToList(entry.managers, entry.manager, manager)
          list[idx] = { ...entry, manager, managers }
          fs.writeFileSync(listPath, `${JSON.stringify(list, null, 2)}\n`)
        }
      } catch { /* no list yet */ }
      // Record the rotation in the activity log.
      try {
        const ev = { ts: new Date().toISOString(), actor: 'owner', type: 'signer_rotated', newManager: manager, safe, ...(txHash ? { txHash } : {}) }
        fs.appendFileSync(at('activity.jsonl'), `${JSON.stringify(ev)}\n`)
      } catch { /* non-fatal */ }
      // Invalidate the cached overview so the new signer + cleared mandates show.
      overviewCacheByAccount.delete(safe.toLowerCase())
      try { fs.rmSync(overviewSnapshotPath(safe)) } catch { /* none */ }
      res.json({ ok: true, manager })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // Is `file` a delegated-signer (manager) keystore? Matches `manager.json`,
  // the per-SMA `manager-<safe>.json` (written with or without a 0x prefix by
  // the UI vs the CLI), and the CLI's per-manager store `managers/<hex>.json`.
  // Backups (manager.json.<ts>.bak, .bak-0x… ) don't end in `.json`, so
  // they're excluded; so are the permissionSigner keys.
  const isManagerKeyFile = (file) =>
    file === 'manager.json' ||
    (file.startsWith('manager-') && file.endsWith('.json')) ||
    (file.startsWith('managers/') && file.endsWith('.json'))

  // Keystore files eligible for listing/activation: top-level keys/ plus the
  // CLI's per-manager store keys/managers/ (paths relative to keys/).
  const listManagerKeyFiles = () => {
    let files = []
    try { files = fs.readdirSync(at('keys')) } catch { files = [] }
    try {
      files.push(...fs.readdirSync(at('keys/managers')).map((f) => `managers/${f}`))
    } catch { /* per-manager store not created yet */ }
    return files
  }

  // Read the plaintext `address` field of a geth-v3 keystore (stored without the
  // 0x prefix). Never decrypts. Returns a checksummed address, or null.
  const keystoreAddress = (file) => {
    try {
      const ks = JSON.parse(fs.readFileSync(at(`keys/${file}`), 'utf-8'))
      if (!ks?.address) return null
      return getAddress(String(ks.address).startsWith('0x') ? ks.address : `0x${ks.address}`)
    } catch {
      return null
    }
  }

  // GET /api/signers — delegated-signer (manager) keystores this project already
  // holds in .sail/keys/, so the dashboard can rotate to a key it already has
  // instead of generating or importing a new one. Reads only the plaintext
  // `address` of each keystore — never decrypts, never returns a secret. The
  // entry whose address matches the active SMA's current manager is flagged
  // `active`. De-duplicated by address (the same key can live in several files).
  app.get('/api/signers', (_req, res) => {
    try {
      const files = listManagerKeyFiles()
      const activeSafe = readActiveSafe()
      let activeManager = null
      try { activeManager = JSON.parse(fs.readFileSync(at('account.json'), 'utf-8')).manager ?? null } catch { /* none */ }
      const activeFile = activeSafe ? `manager-${activeSafe.toLowerCase()}.json` : null

      const byAddress = new Map()
      for (const file of files) {
        if (!isManagerKeyFile(file)) continue
        const address = keystoreAddress(file)
        if (!address) continue
        const key = address.toLowerCase()
        const isActiveFile = activeFile != null && file.toLowerCase() === activeFile
        // Prefer the per-active-SMA file as the canonical record for an address.
        if (!byAddress.has(key) || isActiveFile) {
          byAddress.set(key, {
            address,
            file,
            active: !!activeManager && activeManager.toLowerCase() === key,
          })
        }
      }
      res.json({ signers: [...byAddress.values()] })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // POST /api/signer/activate { address } — make a saved manager keystore the
  // active local signer for the current SMA by copying it to
  // keys/manager-<safe>.json (the file `sailor run` loads). Used by the
  // dashboard's "use a saved manager" rotation path once the on-chain
  // setManager confirms. The on-chain rotation is the source of truth; this only
  // points the local agent at the matching key it already holds. Never reads or
  // returns the secret.
  app.post('/api/signer/activate', (req, res) => {
    const { address } = req.body ?? {}
    if (!isAddress(address)) {
      res.status(400).json({ error: 'address must be a valid address' })
      return
    }
    const safe = readActiveSafe()
    if (!safe) {
      res.status(400).json({ error: 'No active SMA.' })
      return
    }
    try {
      const files = listManagerKeyFiles()
      const want = getAddress(address).toLowerCase()
      const match = files.find((file) => isManagerKeyFile(file) && keystoreAddress(file)?.toLowerCase() === want)
      if (!match) {
        res.status(404).json({ error: 'No saved keystore matches that address.' })
        return
      }
      const source = at(`keys/${match}`)
      const target = managerKeyPath(safe)
      if (path.resolve(source) !== path.resolve(target)) {
        fs.mkdirSync(at('keys'), { recursive: true })
        fs.copyFileSync(source, target)
      }
      // New active signer — drop the cached overview so it shows immediately.
      overviewCacheByAccount.delete(safe.toLowerCase())
      try { fs.rmSync(overviewSnapshotPath(safe)) } catch { /* none */ }
      res.json({ ok: true, address: getAddress(address), file: match })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // GET /api/mandate — the signed mandate, or null if not signed yet.
  app.get('/api/mandate', (_req, res) => {
    try {
      const raw = JSON.parse(fs.readFileSync(at('mandate.json'), 'utf-8'))
      res.json(Array.isArray(raw) ? raw : [raw])
    } catch {
      res.json([])
    }
  })

  // GET /api/mandate-draft — a mandate awaiting signature (from `sailor
  // mandate prepare`), or null.
  app.get('/api/mandate-draft', (_req, res) => {
    try {
      res.json(JSON.parse(fs.readFileSync(at('mandate-draft.json'), 'utf-8')))
    } catch {
      res.json(null)
    }
  })

  // DELETE /api/mandate-draft — discard the draft without signing.
  app.delete('/api/mandate-draft', (_req, res) => {
    try { fs.rmSync(at('mandate-draft.json'), { force: true }) } catch { /* fine */ }
    res.json({ ok: true })
  })

  // POST /api/mandate-submit { signature, signedAt } — combines the draft with
  // the browser-produced signature into the canonical mandate.json shape (the
  // same shape `sailor mandate sign` writes, so downstream code is path-agnostic),
  // then deletes the draft. Returns the persisted mandate.
  app.post('/api/mandate-submit', (req, res) => {
    const { signature, signedAt } = req.body ?? {}
    if (!signature) {
      res.status(400).json({ error: 'missing signature' })
      return
    }
    let draft
    try {
      draft = JSON.parse(fs.readFileSync(at('mandate-draft.json'), 'utf-8'))
    } catch {
      res.status(404).json({ error: 'no mandate draft to submit' })
      return
    }
    const mandate = {
      safe: draft.account,
      chainId: draft.chainId,
      signedAt: signedAt || new Date().toISOString(),
      signature,
      registeredOnChain: false,
      permissions: (draft.items ?? []).map((it) => ({
        template: it.template,
        params: it.params,
        explanation: it.explanation,
      })),
    }
    try {
      fs.mkdirSync(sailDir, { recursive: true })
      let existing = []
      try {
        const raw = JSON.parse(fs.readFileSync(at('mandate.json'), 'utf-8'))
        existing = Array.isArray(raw) ? raw : [raw]
      } catch { /* no existing mandate */ }
      fs.writeFileSync(at('mandate.json'), `${JSON.stringify([...existing, mandate], null, 2)}\n`)
      try {
        fs.rmSync(at('mandate-draft.json'))
      } catch {
        // draft already gone — fine
      }
      res.json(mandate)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // Reads the agent PID, or null if no (valid) PID file exists.
  const readAgentPid = () => {
    try {
      const pid = Number.parseInt(fs.readFileSync(at('agent.pid'), 'utf-8').trim(), 10)
      return Number.isNaN(pid) ? null : pid
    } catch {
      return null
    }
  }

  // True if a process with the given PID is currently alive.
  const isAlive = (pid) => {
    try {
      process.kill(pid, 0) // signal 0 = existence check only
      return true
    } catch {
      return false
    }
  }

  // Checks activity.jsonl for a recent entry — detects remote agents (CI/GH
  // Actions) that don't write a local PID file. "Recent" = last entry within
  // 10 minutes, treating that as the agent being actively scheduled.
  const recentActivityMs = () => {
    try {
      const raw = fs.readFileSync(at('activity.jsonl'), 'utf-8').trimEnd()
      const lastLine = raw.slice(raw.lastIndexOf('\n') + 1)
      const entry = JSON.parse(lastLine)
      if (entry?.ts) return Date.now() - new Date(entry.ts).getTime()
    } catch {}
    return Infinity
  }

  // Scans the project root (.sail/..) for GH Actions workflows that invoke
  // sailor. Returns { file, repoUrl } when found, null otherwise. repoUrl
  // is parsed from the workflow's `uses: actions/checkout` or left null.
  const detectGithubActions = () => {
    try {
      const workflowsDir = path.resolve(sailDir, '../.github/workflows')
      const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      for (const file of files) {
        const content = fs.readFileSync(path.join(workflowsDir, file), 'utf-8')
        if (!content.includes('sailor') && !content.includes('sail')) continue
        // Try to extract the repo remote from .git/config so we can link
        // directly to the repo secrets page.
        let repoUrl = null
        try {
          const gitConfig = fs.readFileSync(path.resolve(sailDir, '../.git/config'), 'utf-8')
          const match = gitConfig.match(/url\s*=\s*(https:\/\/github\.com\/[^\s]+)/)
          if (match) repoUrl = match[1].replace(/\.git$/, '')
        } catch {}
        return { file, repoUrl }
      }
    } catch {}
    return null
  }

  // GET /api/agent-status — whether `sailor run` is currently running.
  // Local agent: PID file + process check. Remote agent (CI / GH Actions):
  // falls back to activity.jsonl recency (within 10 min = running).
  // Either way, surfaces GH Actions workflow info so the UI can guide
  // users who deployed to CI but haven't set secrets or triggered the run.
  app.get('/api/agent-status', (_req, res) => {
    const githubActions = detectGithubActions()
    const pid = readAgentPid()
    if (pid !== null && isAlive(pid)) return res.json({ running: true, pid, source: 'local', githubActions })
    const ageMs = recentActivityMs()
    if (ageMs < 10 * 60 * 1000) return res.json({ running: true, source: 'remote', lastActivityMs: ageMs, githubActions })
    res.json({ running: false, githubActions })
  })

  // POST /api/agent-status { action: 'stop' } — SIGTERM the running agent.
  app.post('/api/agent-status', (req, res) => {
    if (req.body?.action !== 'stop') {
      res.status(400).json({ error: 'unknown action' })
      return
    }
    const pid = readAgentPid()
    if (pid !== null && isAlive(pid)) {
      try {
        process.kill(pid, 'SIGTERM')
        res.json({ ok: true, stopped: pid })
      } catch (err) {
        res.status(500).json({ error: String(err) })
      }
    } else {
      res.json({ ok: true, running: false })
    }
  })

  // GET /api/station/pending — proxy to the signing station daemon, or [] if not running.
  // Discovery order: runtime/server.json (written by `sailor station start`),
  // then port-scan 3141–3150 (same range the UI station page uses), with a
  // short timeout so a stale/hanging daemon never blocks the dashboard.
  //
  // The daemon gates /pending behind the per-startup requestSecret (see
  // packages/cli/src/signing/server.ts), so discovery must capture that secret
  // and the proxy must forward it as `x-sailor-secret` — otherwise every read
  // 403s and the dashboard bell silently shows an empty queue. We get the secret
  // either straight from runtime/server.json or, on the port-scan path, from
  // /config's wsUrl (the daemon embeds `?secret=…` for requests with no Origin,
  // which a server-side fetch is).
  const STATION_PORTS = Array.from({ length: 10 }, (_, i) => 3141 + i)
  let stationCache = null // { port, secret, expiresAt }

  function secretFromConfig(config) {
    try {
      return new URL(config?.wsUrl ?? '').searchParams.get('secret') ?? null
    } catch {
      return null
    }
  }

  async function discoverStation() {
    if (stationCache && Date.now() < stationCache.expiresAt) {
      return stationCache
    }
    // 1. Try runtime/server.json first — cheapest path, and it carries the secret.
    try {
      const { port, requestSecret } = JSON.parse(fs.readFileSync(at('runtime/server.json'), 'utf-8'))
      if (port) {
        const config = await fetch(`http://127.0.0.1:${port}/config`, { signal: AbortSignal.timeout(500) }).then(r => r.ok ? r.json() : null).catch(() => null)
        if (config) {
          const secret = requestSecret ?? secretFromConfig(config)
          stationCache = { port, secret, expiresAt: Date.now() + 10_000 }
          return stationCache
        }
      }
    } catch { /* fall through to port-scan */ }
    // 2. Port-scan the known range (same as the station UI page does), reading
    //    the secret out of /config's wsUrl.
    for (const port of STATION_PORTS) {
      try {
        const config = await fetch(`http://127.0.0.1:${port}/config`, { signal: AbortSignal.timeout(300) }).then(r => r.ok ? r.json() : null).catch(() => null)
        if (config) {
          stationCache = { port, secret: secretFromConfig(config), expiresAt: Date.now() + 10_000 }
          return stationCache
        }
      } catch { /* next */ }
    }
    stationCache = null
    return null
  }

  app.get('/api/station/pending', async (_req, res) => {
    try {
      const station = await discoverStation()
      if (!station) { res.json([]); return }
      const response = await fetch(`http://127.0.0.1:${station.port}/pending`, {
        headers: station.secret ? { 'x-sailor-secret': station.secret } : {},
        signal: AbortSignal.timeout(2_000),
      })
      if (!response.ok) {
        // A 403 means we found the daemon but lack/holds a stale secret — drop the
        // cache so the next poll re-discovers it instead of looping on a bad secret.
        if (response.status === 403) stationCache = null
        res.json([]); return
      }
      res.json(await response.json())
    } catch {
      res.json([])
    }
  })

  // ── UI Onboarding ─────────────────────────────────────────────────────────
  //
  // Three-step browser-driven setup (alternative to `sailor onboard` CLI):
  //   1. User connects wallet in browser  (no server call)
  //   2. POST /api/onboard/generate-key   → server writes keys/manager.json
  //   3. Browser sends kernel.createAccount tx via wagmi
  //   4. POST /api/onboard/complete       → server writes account.json
  //
  // The CLI path (sailor onboard) remains unchanged and uses the same files.

  // GET /api/onboard/state — tells the wizard what's already done.
  app.get('/api/onboard/state', (_req, res) => {
    const config = (() => { try { return JSON.parse(fs.readFileSync(at('config.json'), 'utf-8')) } catch { return null } })()
    const env = parseEnvFile(at('.env.local'))
    const hasAccount = fs.existsSync(at('account.json'))
    const managerKeyPath = at('keys/manager.json')
    let managerAddress = null
    try {
      const ks = JSON.parse(fs.readFileSync(managerKeyPath, 'utf-8'))
      managerAddress = ks?.address ? getAddress(`0x${String(ks.address).replace(/^0x/, '')}`) : null
    } catch {}
    const chainId = config?.chainId ?? 8453
    let deployment = null
    try { deployment = getSailDeployment(chainId) } catch {}
    // Collect per-chain RPC URLs: RPC_URL_<chainId> entries, plus RPC_URL as
    // the active chain's fallback so existing single-chain projects still work.
    const SUPPORTED_CHAIN_IDS = [8453, 42161, 130, 84532]
    const rpcByChain = {}
    for (const cid of SUPPORTED_CHAIN_IDS) {
      const perChainKey = `RPC_URL_${cid}`
      if (env[perChainKey]) rpcByChain[cid] = env[perChainKey]
    }
    // If the project has a single RPC_URL but no per-chain entry for its chain,
    // surface it under the active chainId so the UI can show it.
    if (env.RPC_URL && !rpcByChain[chainId]) rpcByChain[chainId] = env.RPC_URL
    res.json({
      hasAccount,
      hasManagerKey: Boolean(managerAddress),
      managerAddress,
      hasRpc: Boolean(env.RPC_URL || Object.keys(rpcByChain).length > 0),
      rpcUrl: env.RPC_URL ?? null,
      rpcByChain,
      hasSailApiKey: Boolean(env.SAIL_API_KEY),
      chainId,
      projectName: config?.name ?? null,
      kernel: deployment?.kernel ?? config?.contracts?.kernel ?? null,
      safeModuleEnabler: deployment?.safeModuleEnabler ?? null,
      proxyFactory: SAFE_V141.proxyFactory,
      singleton: SAFE_V141.singletonL2,
      standardFeePolicy: deployment?.standardFeePolicy ?? config?.contracts?.standardFeePolicy ?? null,
    })
  })

  // POST /api/onboard/save-config { rpcUrl, chainId } — saves the RPC URL for
  // a specific chain as RPC_URL_<chainId> and also updates RPC_URL if this is
  // the active project chain, so existing CLI commands keep working.
  app.post('/api/onboard/save-config', (req, res) => {
    const { rpcUrl, sailApiKey, chainId } = req.body ?? {}
    try {
      const config = (() => { try { return JSON.parse(fs.readFileSync(at('config.json'), 'utf-8')) } catch { return null } })()
      const activeChainId = config?.chainId ?? 8453
      const envPath = at('.env.local')
      const existing = parseEnvFile(envPath)
      if (rpcUrl && chainId) {
        existing[`RPC_URL_${chainId}`] = rpcUrl
        // Keep RPC_URL in sync with the active chain so CLI commands work.
        if (Number(chainId) === Number(activeChainId)) existing.RPC_URL = rpcUrl
      } else if (rpcUrl) {
        existing.RPC_URL = rpcUrl
      }
      if (sailApiKey) existing.SAIL_API_KEY = sailApiKey
      if (chainId) existing.CHAIN_ID = String(chainId)
      const content = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
      fs.mkdirSync(sailDir, { recursive: true })
      fs.writeFileSync(envPath, content)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // POST /api/onboard/generate-key { passphrase } — generates a manager key at
  // keys/manager.json if one doesn't already exist. Returns the address.
  app.post('/api/onboard/generate-key', async (req, res) => {
    const managerKeyPath = at('keys/manager.json')
    // Return existing key address without regenerating.
    if (fs.existsSync(managerKeyPath)) {
      try {
        const ks = JSON.parse(fs.readFileSync(managerKeyPath, 'utf-8'))
        const addr = ks?.address ? getAddress(`0x${String(ks.address).replace(/^0x/, '')}`) : null
        return res.json({ address: addr, existed: true })
      } catch {}
    }
    try {
      const passphrase = req.body?.passphrase ?? ''
      const privateKey = generatePrivateKey()
      const keyring = LocalKeyring.fromPrivateKey(privateKey)
      const keystore = await keyring.exportKeystore(passphrase)
      fs.mkdirSync(at('keys'), { recursive: true })
      fs.writeFileSync(managerKeyPath, `${JSON.stringify(keystore, null, 2)}\n`)
      res.json({ address: keyring.address, existed: false })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // POST /api/onboard/build-create-tx { owner, manager, chainId? } — builds the
  // kernel.createAccount calldata so the browser can send the tx via wagmi
  // without importing the SDK. chainId in the body overrides config.json.
  app.post('/api/onboard/build-create-tx', (req, res) => {
    try {
      const { owner, manager, chainId: reqChainId, saltNonce: reqSaltNonce } = req.body ?? {}
      if (!isAddress(owner) || !isAddress(manager)) {
        return res.status(400).json({ error: 'owner and agent wallet must be valid addresses' })
      }
      const config = (() => { try { return JSON.parse(fs.readFileSync(at('config.json'), 'utf-8')) } catch { return {} } })()
      const chainId = reqChainId ?? config?.chainId ?? 8453
      let deployment = null
      try { deployment = getSailDeployment(chainId) } catch {}
      const kernel = deployment?.kernel ?? config?.contracts?.kernel
      if (!kernel) return res.status(400).json({ error: 'no kernel address for this chain' })
      const safeModuleEnabler = deployment?.safeModuleEnabler
      const standardFeePolicy = deployment?.standardFeePolicy ?? config?.contracts?.standardFeePolicy ?? zeroAddress
      const initializer = buildSafeSetupInitializer({
        owners: [owner],
        threshold: 1n,
        kernel,
        safeModuleEnabler,
      })
      // If a saltNonce is provided (multi-chain deployment), reuse it so all
      // chains produce the same Safe address via CREATE2.
      const saltNonce = reqSaltNonce != null ? BigInt(reqSaltNonce) : BigInt(Date.now())
      const data = encodeFunctionData({
        abi: SailKernelAbi,
        functionName: 'createAccount',
        args: [
          SAFE_V141.proxyFactory,
          SAFE_V141.singletonL2,
          initializer,
          saltNonce,
          owner,       // permissionSigner = owner's wallet
          manager,     // manager = agent key
          standardFeePolicy,
          zeroAddress, // feeAsset (native)
        ],
      })
      res.json({ to: kernel, data, chainId, saltNonce: saltNonce.toString() })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // POST /api/onboard/build-register-path { owner, manager, chainId?, saltNonce? } —
  // Alternative to build-create-tx for chains where the kernel doesn't trust the factory.
  // Returns the deploy tx (SafeProxyFactory.createProxyWithNonce) and the kernel address.
  // The wizard parses the Safe address from the deploy receipt and builds registerAccount itself.
  app.post('/api/onboard/build-register-path', (req, res) => {
    try {
      const { owner, manager, chainId: reqChainId, saltNonce: reqSaltNonce } = req.body ?? {}
      if (!isAddress(owner) || !isAddress(manager)) {
        return res.status(400).json({ error: 'owner and agent wallet must be valid addresses' })
      }
      const config = (() => { try { return JSON.parse(fs.readFileSync(at('config.json'), 'utf-8')) } catch { return {} } })()
      const chainId = reqChainId ?? config?.chainId ?? 8453
      let deployment = null
      try { deployment = getSailDeployment(chainId) } catch {}
      const kernel = deployment?.kernel ?? config?.contracts?.kernel
      if (!kernel) return res.status(400).json({ error: 'no kernel address for this chain' })
      const safeModuleEnabler = deployment?.safeModuleEnabler

      const initializer = buildSafeSetupInitializer({
        owners: [owner],
        threshold: 1n,
        kernel,
        safeModuleEnabler,
      })
      const saltNonce = reqSaltNonce != null ? BigInt(reqSaltNonce) : BigInt(Date.now())

      const PROXY_FACTORY_ABI = [{
        name: 'createProxyWithNonce',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: '_singleton', type: 'address' },
          { name: 'initializer', type: 'bytes' },
          { name: 'saltNonce', type: 'uint256' },
        ],
        outputs: [{ type: 'address' }],
      }]
      const deployData = encodeFunctionData({
        abi: PROXY_FACTORY_ABI,
        functionName: 'createProxyWithNonce',
        args: [SAFE_V141.singletonL2, initializer, saltNonce],
      })

      res.json({
        deployTx: { to: SAFE_V141.proxyFactory, data: deployData, chainId },
        kernel,
        saltNonce: saltNonce.toString(),
      })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // POST /api/onboard/complete { safe, owner, manager, txHash, chainId } —
  // called after the browser wallet confirms kernel.createAccount. Writes
  // account.json (same format as `sailor onboard`).
  app.post('/api/onboard/complete', async (req, res) => {
    try {
      const { safe, owner, manager, txHash, chainId: reqChainId } = req.body ?? {}
      if (!isAddress(safe) || !isAddress(owner)) {
        return res.status(400).json({ error: 'safe and owner must be valid addresses' })
      }
      const config = (() => { try { return JSON.parse(fs.readFileSync(at('config.json'), 'utf-8')) } catch { return {} } })()
      const chainId = reqChainId ?? config?.chainId ?? 8453
      let createdAtBlock = '0'
      try {
        const env = parseEnvFile(at('.env.local'))
        if (env.RPC_URL) {
          const client = createPublicClient({ transport: http(env.RPC_URL) })
          createdAtBlock = (await client.getBlockNumber()).toString()
        }
      } catch {}
      const managerKeyPath = at('keys/manager.json')
      let resolvedManager = manager
      if (!resolvedManager) {
        try {
          const ks = JSON.parse(fs.readFileSync(managerKeyPath, 'utf-8'))
          resolvedManager = ks?.address ? getAddress(`0x${String(ks.address).replace(/^0x/, '')}`) : owner
        } catch { resolvedManager = owner }
      }
      const record = {
        safe: getAddress(safe),
        owner: getAddress(owner),
        permissionSigner: getAddress(owner),
        manager: getAddress(resolvedManager),
        chainId,
        createdAtBlock,
        ...(txHash ? { txHash } : {}),
      }
      fs.mkdirSync(sailDir, { recursive: true })
      // Append to multi-SMA list before overwriting the active pointer.
      const listPath = at('state/accounts.json')
      try {
        fs.mkdirSync(at('state'), { recursive: true })
        const existing = (() => { try { return JSON.parse(fs.readFileSync(listPath, 'utf-8')) } catch { return [] } })()
        const already = existing.find((a) => a.safe?.toLowerCase() === record.safe.toLowerCase())
        if (!already) existing.push(record)
        fs.writeFileSync(listPath, `${JSON.stringify(existing, null, 2)}\n`)
      } catch {}
      fs.writeFileSync(at('account.json'), `${JSON.stringify(record, null, 2)}\n`)
      res.json({ ok: true, account: record })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // GET /api/wizard-state — current wizard progress, or null.
  app.get('/api/wizard-state', (_req, res) => {
    try {
      const raw = fs.readFileSync(at('.wizard-state.json'), 'utf-8')
      res.json(JSON.parse(raw))
    } catch {
      res.json(null)
    }
  })

  // POST /api/wizard-state — persist the wizard progress object.
  app.post('/api/wizard-state', (req, res) => {
    try {
      fs.mkdirSync(sailDir, { recursive: true })
      fs.writeFileSync(at('.wizard-state.json'), `${JSON.stringify(req.body, null, 2)}\n`)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // GET /api/positions — latest vault positions snapshot for the active SMA.
  // Written by the agent at state/positions-<chainId>.json after each tick.
  app.get('/api/positions', (_req, res) => {
    try {
      const account = JSON.parse(fs.readFileSync(at('account.json'), 'utf-8'))
      const chainId = account?.chainId ?? 8453
      const file = at(`state/positions-${chainId}.json`)
      res.json(JSON.parse(fs.readFileSync(file, 'utf-8')))
    } catch {
      res.status(404).json({ error: 'no positions snapshot' })
    }
  })

  // Build a mandate list from state/mandates.json filtered to the active SMA.
  // Used as a fallback when on-chain reads are unavailable.
  function mandatesFromStore(at, account, nameByAddr, templateByAddr, network) {
    try {
      const store = JSON.parse(fs.readFileSync(at('state/mandates.json'), 'utf-8'))
      const safe = account?.safe?.toLowerCase()
      return (store.mandates ?? [])
        .filter((m) => m.address && m.chainId === account?.chainId &&
          (m.attachments ?? []).some((a) => a.sma?.toLowerCase() === safe))
        .map((m) => ({
          address: m.address,
          name: m.name ?? nameByAddr.get(m.address.toLowerCase()) ?? null,
          template: m.name ?? templateByAddr.get(m.address.toLowerCase()) ?? null,
          network,
        }))
    } catch {
      return []
    }
  }

  // GET /api/overview — the consolidated, local-first monitoring view:
  //   • the SMA (from account.json), confirmed against the kernel on-chain
  //   • the mandates currently attached on-chain (getPermissions), enriched
  //     with friendly names from state/mandates.json
  //   • the delegated signer (manager) + owner + the SMA itself, each with
  //     their native ETH balance and a top-up status
  //
  // On-chain reads use the project's RPC (.sail/.env.local → RPC_URL) and the
  // kernel from .env.local / the SDK deployment registry. If the chain is
  // unreachable we still return the local account + a best-effort mandate list
  // so the UI degrades gracefully instead of going blank.
  app.get('/api/overview', async (_req, res) => {
    let account = null
    try {
      account = JSON.parse(fs.readFileSync(at('account.json'), 'utf-8'))
    } catch {
      res.json(null)
      return
    }
    if (!account?.safe) {
      res.json(null)
      return
    }

    const key = account.safe.toLowerCase()
    const cached = overviewCacheByAccount.get(key)

    // Fresh in memory → serve as-is.
    if (cached && Date.now() - cached.at < OVERVIEW_TTL_MS) {
      res.json(cached.data)
      return
    }

    // Stale memory entry or a persisted snapshot → serve instantly, then
    // refresh from chain in the background. This is what makes switching SMAs
    // feel immediate: a previously-seen SMA never blocks on RPC.
    const snapshot = cached?.data ?? readOverviewSnapshot(account.safe)
    if (snapshot) {
      res.json(snapshot)
      refreshOverviewInBackground(account)
      return
    }

    // Cold (never seen this SMA): compute once synchronously, cache, return.
    const data = await computeOverview(account)
    storeOverview(account.safe, data)
    res.json(data)
  })

  // Build the consolidated overview for a local account record by reading the
  // kernel + balances on-chain. Never throws: on RPC failure it returns a
  // best-effort result with `onchainError` set so the UI degrades gracefully.
  async function computeOverview(account) {
    const env = parseEnvFile(at('.env.local'))
    const chainId = Number(account.chainId ?? env.CHAIN_ID ?? 0)
    let kernel = env.KERNEL_ADDRESS
    if (!kernel) {
      try {
        kernel = getSailDeployment(chainId)?.kernel
      } catch {
        kernel = undefined
      }
    }
    const rpcUrl = env.RPC_URL

    // Friendly name lookup: address → name or template.
    const nameByAddr = new Map()
    const templateByAddr = new Map()
    try {
      const tracked = JSON.parse(fs.readFileSync(at('state/mandates.json'), 'utf-8'))
      for (const m of tracked.mandates ?? []) {
        if (m.address && m.name) nameByAddr.set(m.address.toLowerCase(), m.name)
      }
    } catch {
      /* no local mandate history */
    }
    try {
      const raw = JSON.parse(fs.readFileSync(at('mandate.json'), 'utf-8'))
      const locals = Array.isArray(raw) ? raw : [raw]
      for (const local of locals) {
        for (const p of local.permissions ?? []) {
          if (p.address && p.template) templateByAddr.set(p.address.toLowerCase(), p.template)
        }
      }
    } catch {
      /* no mandate.json */
    }

    const network = CHAIN_NAMES[chainId] ?? null
    const result = {
      generatedAt: new Date().toISOString(),
      chainId,
      network,
      kernel: kernel ?? null,
      rpcConfigured: Boolean(rpcUrl),
      onchain: false,
      sma: {
        address: account.safe,
        owner: account.owner,
        manager: account.manager,
        permissionSigner: account.permissionSigner,
        network,
        registered: null,
        sessionActive: null,
        balanceWei: null,
        balanceEth: null,
        balanceStatus: null,
      },
      mandates: [],
      signers: [],
    }

    // Discover local agent keystores for the manager (gas payer) *outside* the on-chain block
    // so we can surface the address(es) for funding even when RPC is missing or down.
    const localManagerAddrs = new Set()
    const perSmaPath = managerKeyPath(account.safe)
    const legacyPerSmaPath = legacyManagerKeyPath(account.safe)
    const flatManagerPath = at('keys/manager.json')
    for (const p of [perSmaPath, legacyPerSmaPath, flatManagerPath]) {
      try {
        if (fs.existsSync(p)) {
          const ks = JSON.parse(fs.readFileSync(p, 'utf-8'))
          if (ks?.address) {
            localManagerAddrs.add(getAddress(`0x${String(ks.address).replace(/^0x/, '')}`))
          }
        }
      } catch {
        /* ignore bad/missing keystore */
      }
    }
    const localSigner = localManagerAddrs.size > 0 ? [...localManagerAddrs][0] : null

    if (kernel && isAddress(kernel) && account.safe && isAddress(account.safe)) {
      try {
        const client = createPublicClient({ transport: http(rpcUrl) })
        const safe = getAddress(account.safe)
        const [registered, configs, perms, safeBal] = await Promise.all([
          client.readContract({ address: kernel, abi: SailKernelAbi, functionName: 'registered', args: [safe] }),
          client.readContract({ address: kernel, abi: SailKernelAbi, functionName: 'configs', args: [safe] }),
          client.readContract({ address: kernel, abi: SailKernelAbi, functionName: 'getPermissions', args: [safe] }),
          client.getBalance({ address: safe }),
        ])
        const [permissionSigner, manager, , sessionActive] = configs

        // An unregistered SMA has no delegated signer yet: the kernel returns
        // the zero address for `manager`. Treat that as "not configured" rather
        // than a real signer — otherwise we'd read (and display) the burn
        // address' balance, which is both meaningless and confusing.
        const managerSet = Boolean(manager) && getAddress(manager) !== zeroAddress

        // Use the local manager addrs discovered earlier (outside the RPC block).
        // Address to display as the manager: the on-chain delegate if set,
        // otherwise the locally-created key (pending on-chain delegation).
        const managerAddr = managerSet ? getAddress(manager) : localSigner

        // Balances for every distinct *real* signer address (on-chain manager/owner + any local agent keys that
        // will actually sign the gas txs) — also include all historically-known managers from account.managers.
        const knownManagerAddrs = (account.managers ?? []).map((a) => getAddress(a))
        const signerAddrs = [
          ...new Set([managerAddr, account.owner ? getAddress(account.owner) : null, ...localManagerAddrs, ...knownManagerAddrs].filter(Boolean)),
        ]
        const balances = await Promise.all(signerAddrs.map((a) => client.getBalance({ address: a })))
        const balanceByAddr = new Map(signerAddrs.map((a, i) => [a.toLowerCase(), balances[i]]))

        result.onchain = true
        result.sma.registered = registered
        result.sma.sessionActive = sessionActive
        result.sma.manager = manager
        result.sma.permissionSigner = permissionSigner
        result.sma.balanceWei = safeBal.toString()
        result.sma.balanceEth = formatEther(safeBal)
        result.sma.balanceStatus = balanceStatus(safeBal)

        result.mandates = perms.length > 0
          ? perms.map((addr) => ({
              address: addr,
              name: nameByAddr.get(addr.toLowerCase()) ?? null,
              template: templateByAddr.get(addr.toLowerCase()) ?? null,
              network,
            }))
          : mandatesFromStore(at, account, nameByAddr, templateByAddr, network)

        let managerEntry
        if (managerSet) {
          managerEntry = signerEntry('manager', managerAddr, balanceByAddr)
        } else if (localSigner) {
          // Key exists locally but isn't the kernel's delegate yet. Show its
          // address/balance but mark it 'local' so the UI says "not delegated".
          managerEntry = { ...signerEntry('manager', localSigner, balanceByAddr), status: 'local' }
        } else {
          managerEntry = { role: 'manager', address: null, balanceWei: null, balanceEth: null, status: 'unconfigured' }
        }

        // Attach the full known-managers list so the UI can show all addresses
        // (active + idle) in the account-details section.
        if (knownManagerAddrs.length > 0) {
          // Prefer the on-chain manager; fall back to account.manager when the
          // kernel hasn't had setManager called yet (zero address on-chain).
          const activeLower = (managerSet ? getAddress(manager) : account.manager ?? null)?.toLowerCase() ?? null
          managerEntry.managers = knownManagerAddrs.map((a) => {
            const bal = balanceByAddr.get(a.toLowerCase())
            return {
              address: a,
              balanceEth: bal != null ? formatEther(bal) : null,
              isActive: a.toLowerCase() === activeLower,
            }
          })
        }

        const signers = [managerEntry]
        // Always expose any local manager keystore addresses (the actual keys the agent/run will load and use
        // to sign+pay gas). If they differ from the on-chain registered manager (e.g. on-chain set to owner EOA,
        // or stale per-SMA key), still list them with "Local" so the user can copy the address and fund it.
        for (const la of localManagerAddrs) {
          if (getAddress(la) !== (managerAddr ? getAddress(managerAddr) : null)) {
            signers.push({ ...signerEntry('manager', la, balanceByAddr), status: 'local' })
          }
        }

        result.signers = [
          ...signers,
          // Owner is the permission signer here; only list it once.
          ...(account.owner && (!managerAddr || getAddress(account.owner) !== managerAddr)
            ? [signerEntry('owner', getAddress(account.owner), balanceByAddr)]
            : []),
        ]
      } catch (err) {
        result.onchainError = err instanceof Error ? err.message : String(err)
        result.mandates = mandatesFromStore(at, account, nameByAddr, templateByAddr, network)
      }
    } else {
      result.onchainError = 'No kernel/RPC configured for on-chain reads'
      result.mandates = mandatesFromStore(at, account, nameByAddr, templateByAddr, network)
    }

    // If we have local manager keys but no signers were populated (e.g. no RPC, onchain error path,
    // or on-chain manager not set), still expose the local keystore address(es). This is the address
    // the agent will load (via sailor run / loadManagerSigner) and use to pay gas — the whole point
    // of showing it in the UI for easy funding from the owner's connected wallet.
    if (result.signers.length === 0 && localManagerAddrs.size > 0) {
      result.signers = [...localManagerAddrs].map((la) => ({
        role: 'manager',
        address: la,
        balanceWei: null,
        balanceEth: null,
        status: 'local',
      }))
    }

    // Attach the full managers list to the first manager signer entry, regardless
    // of whether the on-chain read succeeded. This lets the UI show all known
    // managers (active + idle) even when RPC is down or the kernel read failed.
    if (account.managers?.length > 0) {
      // On-chain manager takes precedence; fall back to account.manager for projects
      // where setManager hasn't been called on this kernel yet (on-chain = zero addr).
      const onchainMgr = result.sma.manager
      const activeLower = (
        onchainMgr && onchainMgr !== zeroAddress ? onchainMgr : account.manager ?? null
      )?.toLowerCase() ?? null
      const managersPayload = account.managers.map((a) => ({
        address: getAddress(a),
        balanceEth: null,
        isActive: a.toLowerCase() === activeLower,
      }))
      const mgrSigner = result.signers.find((s) => s.role === 'manager')
      if (mgrSigner && !mgrSigner.managers) mgrSigner.managers = managersPayload
    }

    try {
      const raw = JSON.parse(fs.readFileSync(at('mandate.json'), 'utf-8'))
      const mandates = Array.isArray(raw) ? raw : [raw]
      result.mandateCount = mandates.filter((m) => m.registeredOnChain || m.signature).length
    } catch {
      result.mandateCount = 0
    }

    return result
  }

  // Serve the built UI if available. SERVE_DIST=1 is the explicit flag set by
  // `sailor ui start`, but we also auto-detect: if index.html exists next to
  // this server file (or at SAILOR_UI_DIST), serve it without the flag so that
  // direct invocations (`node server.js`) don't silently 404 on the root.
  const distDir = process.env.SAILOR_UI_DIST ?? path.join(path.dirname(_thisFile), 'dist')
  const hasUiDist = fs.existsSync(path.join(distDir, 'index.html'))
  if (process.env.SERVE_DIST === '1' || hasUiDist) {
    app.use(express.static(distDir))
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
  }

  const httpServer = app.listen(port, () => {
    console.log(`Sailor UI running at http://localhost:${port} (reading ${sailDir})`)
  })

  // ── Signing-station WebSocket proxy ───────────────────────────────────────
  // The signing station page (#/station) needs a live WebSocket to the daemon
  // to receive requests and send the owner's signed/rejected decisions. The
  // daemon authenticates that socket with the per-startup requestSecret, and
  // deliberately withholds the secret from cross-origin /config responses — so a
  // page served here (port 3333), not by the daemon itself, can't open the
  // socket directly. Rather than leak the secret into the browser (re-opening
  // the cross-origin-injection hole the daemon's secret closes), we relay the
  // socket through this server: it discovers the daemon, holds the secret
  // server-side, and pipes frames both ways. The browser only ever talks to its
  // own same-origin endpoint.
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname
    try {
      pathname = new URL(req.url, `http://localhost:${PORT}`).pathname
    } catch {
      socket.destroy()
      return
    }
    if (pathname !== '/api/station/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (client) => relayToDaemon(client))
  })

  async function relayToDaemon(client) {
    const station = await discoverStation()
    if (!station?.secret) {
      // No daemon, or we couldn't obtain its secret. Close so the page shows
      // "disconnected" and retries on its next poll.
      try { client.close(1011, 'signing daemon unavailable') } catch { /* already closed */ }
      return
    }
    const upstream = new WebSocket(`ws://127.0.0.1:${station.port}/?secret=${encodeURIComponent(station.secret)}`)
    // Frames the browser sends before the upstream socket is open are buffered,
    // then flushed on connect — otherwise an early wallet-connected/signed frame
    // would be dropped.
    let upstreamOpen = false
    const queued = []

    upstream.on('open', () => {
      upstreamOpen = true
      for (const frame of queued) upstream.send(frame)
      queued.length = 0
    })
    upstream.on('message', (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(data.toString())
    })
    upstream.on('close', () => { try { client.close() } catch { /* already closed */ } })
    upstream.on('error', () => {
      // A bad/stale secret reaches here as a 1008 close → drop the discovery
      // cache so the next connection re-resolves the daemon.
      stationCache = null
      try { client.close(1011, 'daemon connection failed') } catch { /* already closed */ }
    })

    client.on('message', (data) => {
      const frame = data.toString()
      if (upstreamOpen) upstream.send(frame)
      else queued.push(frame)
    })
    client.on('close', () => { try { upstream.close() } catch { /* already closed */ } })
    client.on('error', () => { try { upstream.close() } catch { /* already closed */ } })
  }

  return httpServer
}

// Allow running directly: `SAIL_DIR=/path/to/.sail node server.js`.
// The CLI's `sailor ui` command spawns this with SAIL_DIR set.
// Use case-insensitive comparison on Windows: path.resolve() and __filename
// can disagree on drive-letter case (c:\ vs C:\), breaking a strict === check.
const _norm = p => path.resolve(p)[process.platform === 'win32' ? 'toLowerCase' : 'toString']()
const isMain = Boolean(process.argv[1]) && _norm(process.argv[1]) === _norm(_thisFile)
if (isMain) {
  const sailDir = process.env.SAIL_DIR || path.join(process.cwd(), '.sail')
  startServer(sailDir)
}
