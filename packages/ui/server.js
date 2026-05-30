import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { LocalKeyring, SailKernelAbi, getSailDeployment } from '@sail/sdk'
import { createPublicClient, formatEther, getAddress, http, isAddress, toHex, zeroAddress } from 'viem'
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'

const PORT = Number(process.env.PORT ?? 3334)

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
}

/**
 * Classify a native-balance reading into a top-up status. Thresholds are in
 * ETH and deliberately conservative — Base gas is cheap, so "low" is an early
 * heads-up to refill a delegated signer, not an outage.
 */
function balanceStatus(wei) {
  const eth = Number(formatEther(wei))
  if (eth < 0.0005) return 'critical'
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
export function startServer(sailDir) {
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

  // Per-SMA delegated-signer keystore path.
  const managerKeyPath = (safe) => at(`keys/manager-${safe.toLowerCase()}.json`)

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

  // GET /api/mandate — the signed mandate, or null if not signed yet.
  app.get('/api/mandate', (_req, res) => {
    try {
      res.json(JSON.parse(fs.readFileSync(at('mandate.json'), 'utf-8')))
    } catch {
      res.json(null)
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
      fs.writeFileSync(at('mandate.json'), `${JSON.stringify(mandate, null, 2)}\n`)
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

  // GET /api/agent-status — whether `sailor run` is currently running.
  app.get('/api/agent-status', (_req, res) => {
    const pid = readAgentPid()
    if (pid !== null && isAlive(pid)) res.json({ running: true, pid })
    else res.json({ running: false })
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
  // The station writes its port to .sail/runtime/server.json when it starts.
  app.get('/api/station/pending', async (_req, res) => {
    try {
      const stateRaw = fs.readFileSync(at('runtime/server.json'), 'utf-8')
      const { port } = JSON.parse(stateRaw)
      if (!port) { res.json([]); return }
      const response = await fetch(`http://127.0.0.1:${port}/pending`)
      if (!response.ok) { res.json([]); return }
      res.json(await response.json())
    } catch {
      res.json([])
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

    // Friendly name lookup: address → most-recently-deployed mandate name.
    const nameByAddr = new Map()
    try {
      const tracked = JSON.parse(fs.readFileSync(at('state/mandates.json'), 'utf-8'))
      for (const m of tracked.mandates ?? []) {
        if (m.address && m.name) nameByAddr.set(m.address.toLowerCase(), m.name)
      }
    } catch {
      /* no local mandate history — names fall back to the address */
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

        // A delegated-signer key created locally (via the dashboard's "add
        // signer" flow or the CLI) for this SMA — surfaced even before it has
        // been delegated on-chain, so the user sees the key they just made.
        let localSigner = null
        try {
          const ks = JSON.parse(fs.readFileSync(managerKeyPath(safe), 'utf-8'))
          if (ks?.address) localSigner = getAddress(`0x${String(ks.address).replace(/^0x/, '')}`)
        } catch {
          /* no local signer key for this SMA */
        }

        // Address to display as the manager: the on-chain delegate if set,
        // otherwise the locally-created key (pending on-chain delegation).
        const managerAddr = managerSet ? getAddress(manager) : localSigner

        // Balances for every distinct *real* signer address in one parallel batch.
        const signerAddrs = [
          ...new Set([managerAddr, account.owner ? getAddress(account.owner) : null].filter(Boolean)),
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

        result.mandates = perms.map((addr) => ({
          address: addr,
          name: nameByAddr.get(addr.toLowerCase()) ?? null,
          network,
        }))

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

        result.signers = [
          managerEntry,
          // Owner is the permission signer here; only list it once.
          ...(account.owner && (!managerAddr || getAddress(account.owner) !== managerAddr)
            ? [signerEntry('owner', getAddress(account.owner), balanceByAddr)]
            : []),
        ]
      } catch (err) {
        result.onchainError = err instanceof Error ? err.message : String(err)
        // Best-effort mandate list from the local active set when chain is down.
        try {
          const local = JSON.parse(fs.readFileSync(at('mandate.json'), 'utf-8'))
          result.mandates = (local.permissions ?? []).map((addr) => ({
            address: addr,
            name: nameByAddr.get(String(addr).toLowerCase()) ?? null,
            network,
          }))
        } catch {
          /* no local mandate */
        }
      }
    } else {
      result.onchainError = 'No kernel/RPC configured for on-chain reads'
    }

    return result
  }

  // When SERVE_DIST=1 (set by `sailor ui`), also serve the built UI so a
  // single process handles everything — no Vite dev server needed.
  if (process.env.SERVE_DIST === '1') {
    const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
    app.use(express.static(distDir))
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
  }

  return app.listen(PORT, () => {
    console.log(`Sailor UI running at http://localhost:${PORT} (reading ${sailDir})`)
  })
}

// Allow running directly: `SAIL_DIR=/path/to/.sail node server.js`.
// The CLI's `sailor ui` command spawns this with SAIL_DIR set.
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const sailDir = process.env.SAIL_DIR || path.join(process.cwd(), '.sail')
  startServer(sailDir)
}
