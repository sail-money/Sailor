import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { SailKernelAbi, getSailDeployment } from '@sail/sdk'
import { createPublicClient, formatEther, getAddress, http, isAddress } from 'viem'

const PORT = 3334

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

const overviewCache = { at: 0, data: null }
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
      fs.mkdirSync(sailDir, { recursive: true })
      fs.writeFileSync(at('account.json'), `${JSON.stringify({ safe, owner, permissionSigner: permissionSigner ?? owner, manager: manager ?? owner, chainId, createdAtBlock: createdAtBlock ?? '0' }, null, 2)}\n`)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // GET /api/activity — one JSON object per line; empty array if absent.
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
      res.json(events)
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
    const event = { ...ev, ts: ev.ts ?? new Date().toISOString(), actor: ev.actor ?? 'owner' }
    try {
      fs.mkdirSync(sailDir, { recursive: true })
      fs.appendFileSync(at('activity.jsonl'), `${JSON.stringify(event)}\n`)
      res.json({ ok: true, event })
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
    if (overviewCache.data && Date.now() - overviewCache.at < OVERVIEW_TTL_MS) {
      res.json(overviewCache.data)
      return
    }

    let account = null
    try {
      account = JSON.parse(fs.readFileSync(at('account.json'), 'utf-8'))
    } catch {
      res.json(null)
      return
    }

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

        // Balances for every distinct signer address in one parallel batch.
        const signerAddrs = [...new Set([manager, permissionSigner, account.owner].filter(Boolean).map(getAddress))]
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

        result.signers = [
          signerEntry('manager', manager, balanceByAddr),
          // Owner is the permission signer here; only list it once.
          ...(account.owner && getAddress(account.owner) !== getAddress(manager)
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

    overviewCache.at = Date.now()
    overviewCache.data = result
    res.json(result)
  })

  return app.listen(PORT, () => {
    console.log(`Sailor data server on http://localhost:${PORT} (reading ${sailDir})`)
  })
}

// Allow running directly: `SAIL_DIR=/path/to/.sail node server.js`.
// The CLI's `sailor ui` command spawns this with SAIL_DIR set.
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const sailDir = process.env.SAIL_DIR || path.join(process.cwd(), '.sail')
  startServer(sailDir)
}
