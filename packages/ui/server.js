import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'
import { LocalKeyring, SAFE_V141, SailKernelAbi, buildSafeSetupInitializer, chains, defaultRpcUrls, getNativeCurrencySymbol, getSailDeployment, readPermissionRegistrationFee } from '@sail/sdk'
import * as accountStore from '@sail/sdk/accounts'
import { MAX_SANDBOX_CHAINS, SANDBOX_CHAINS_CEILING, TooManySandboxChainsError, activateSandboxBackup, clampSandboxChainCap, dumpSandboxState, enforceSandboxChainCap, fundErc20, fundNative, isPidAlive, listSandboxBackups, refreshSandboxForks, resetSandbox, resetSandboxProject, restartSandboxFork, resumeSandboxForks, sandboxDirFor, startPeriodicStateDump, startSandboxForks, stopSandboxFork, usdcAddressFor } from '@sail/sandbox'
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatEther, getAddress, http, isAddress, toHex, zeroAddress } from 'viem'
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'

const PORT = Number(process.env.PORT ?? 3334)

// Allowed CORS origins for the local data server / signing-server relay.
// Defaults to the local dashboard only. Operators exposing the signer over a
// tailnet or a custom HTTPS host (F8) can add origins via SAILOR_CORS_ORIGINS,
// a comma-separated list — e.g. `SAILOR_CORS_ORIGINS=https://hermes.example.ts.net`.
const DEFAULT_CORS_ORIGINS = ['http://localhost:3333']
const CORS_ORIGINS = [
  ...DEFAULT_CORS_ORIGINS,
  ...(process.env.SAILOR_CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
]

// Resolve the current file path in both ESM and esbuild CJS bundles.
// import.meta.url is undefined in CJS bundles; __filename is the fallback.
const _thisFile = (() => {
  try { return fileURLToPath(import.meta.url) } catch { return __filename }
})()

/** Read the installed package version by walking up to the nearest package.json. */
function readPackageVersion() {
  let dir = path.dirname(_thisFile)
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
      if (pkg?.version) return String(pkg.version)
    } catch { /* keep walking up */ }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

// The version this server process started with. If the on-disk package is later
// upgraded (npm i @sail.money/sailor@latest) the running process keeps serving
// stale assets/code until restarted — so /api/version compares this snapshot
// against the live on-disk version and the dashboard prompts a reload.
const RUNNING_VERSION = readPackageVersion()

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

// ── Live ⇄ Sandbox peer server launch ────────────────────────────────────────
// The live dashboard's "Try it in a Sandbox" button and the sandbox dashboard's
// "Exit to live dashboard" link both need to start (or find) a SEPARATE server
// process — never toggle a flag on this one. Both directions reuse this same
// self-spawn: this process knows its own file (`_thisFile`) and can launch
// another copy of itself pointed at the other root/port, exactly like the CLI
// does when it first starts either server.

/** Resolves the first free TCP port at or above `from` (probes 127.0.0.1). */
function findFreePort(from) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', () => findFreePort(from + 1).then(resolve, reject))
    server.listen(from, '127.0.0.1', () => server.close(() => resolve(from)))
  })
}

/** Waits until something is listening on `port`, or `timeoutMs` elapses. */
function waitForPortOpen(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) resolve(false)
        else setTimeout(attempt, 150)
      })
    }
    attempt()
  })
}

/** Same deterministic-port formula as the CLI's `projectPort()` (packages/cli/src/lib/packagePaths.ts)
 *  — kept in sync by hand since this file ships as a separate esbuild bundle — so a
 *  server started from the browser lands on the same port `sailor ui start` / `sailor
 *  sandbox start` would pick from the terminal, instead of stacking a redundant instance. */
function deterministicPort(seed) {
  const hash = [...seed].reduce((h, c) => (((h << 5) - h) + c.charCodeAt(0)) >>> 0, 0)
  return 3333 + (hash % 667)
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
}

/** Ensure a peer server (the other of live/sandbox) is running for this same
 *  project, starting it detached if necessary. Never touches `this` process —
 *  only ever reads/writes the peer's own runtime file. */
async function ensurePeerServerRunning({ targetSailDir, targetMode, runtimeFile, preferredPort }) {
  const existing = readJsonSafe(runtimeFile)
  if (existing?.pid && isPidAlive(existing.pid)) return { port: existing.port, started: false }

  const port = await findFreePort(preferredPort)
  const runtimeDir = path.dirname(runtimeFile)
  fs.mkdirSync(runtimeDir, { recursive: true })
  const logFd = fs.openSync(path.join(runtimeDir, 'ui.log'), 'a')

  const child = spawn(process.execPath, [_thisFile], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      SAIL_DIR: targetSailDir,
      SERVE_DIST: '1',
      PORT: String(port),
      SAILOR_UI_MODE: targetMode,
    },
  })
  child.unref()
  fs.closeSync(logFd)

  const ready = await waitForPortOpen(port, 10_000)
  if (!ready) throw new Error(`The ${targetMode} server did not start within 10s.`)

  fs.writeFileSync(runtimeFile, JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString() }, null, 2))
  return { port, started: true }
}

/**
 * Upserts the `SAIL_PASSPHRASE` line in a `.sail/.env.local` file, preserving
 * every other key, and guarantees the file ends up mode 0600 — including when it
 * already existed (writeFileSync's mode is ignored for an existing file, so we
 * chmod explicitly). This is what lets a browser-only operator's `sailor run`
 * (local or the CI cron) unlock the keystore the dashboard just created.
 *
 * Inline copy of persistPassphrase() in packages/cli/src/lib/io.ts — the CLI is
 * TypeScript and cannot be imported across the package/language boundary, so the
 * two carry identical logic. Keep them in sync.
 */
function persistPassphrase(envPath, passphrase) {
  let content = ''
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8').replace(/^SAIL_PASSPHRASE=.*\n?/m, '')
  }
  const trimmed = content.trimEnd()
  content = `${trimmed}${trimmed.length > 0 ? '\n' : ''}SAIL_PASSPHRASE=${passphrase}\n`
  fs.mkdirSync(path.dirname(envPath), { recursive: true })
  fs.writeFileSync(envPath, content, { mode: 0o600 })
  fs.chmodSync(envPath, 0o600)
}

/**
 * Upserts one `KEY=VALUE` in `.sail/.env.local`, preserving every other key; an
 * empty `value` removes the key. Only ever called with a literal `key` from this
 * file, so building the match pattern from it is safe.
 *
 * The file can hold SAIL_PASSPHRASE, so it is (re)written 0600 — writeFileSync's
 * mode is ignored for a file that already exists, hence the explicit chmod.
 */
function upsertEnvVar(envPath, key, value) {
  let content = ''
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8').replace(new RegExp(`^${key}=.*\n?`, 'm'), '')
  }
  const trimmed = content.trimEnd()
  const head = `${trimmed}${trimmed.length > 0 ? '\n' : ''}`
  fs.mkdirSync(path.dirname(envPath), { recursive: true })
  fs.writeFileSync(envPath, value === '' ? head : `${head}${key}=${value}\n`, { mode: 0o600 })
  fs.chmodSync(envPath, 0o600)
}

/** A Reown (WalletConnect) project id: 32 hex characters. Mirrors
 *  PROJECT_ID_RE in src/wagmi.js — keep the two in sync. */
const WALLETCONNECT_PROJECT_ID_RE = /^[0-9a-f]{32}$/i

/** Reject values that would break `.env.local`: a newline injects an extra
 *  KEY=VALUE line (e.g. overwriting SAIL_PASSPHRASE) when the file is re-serialized. */
export function isSafeEnvValue(v) {
  return typeof v === 'string' && !/[\n\r]/.test(v)
}

/** True for a well-formed http(s) URL — rejects other schemes and garbage. */
export function isHttpUrl(v) {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Log the real error server-side; return a generic message so filesystem paths,
 *  RPC URLs and other internals never leak in the response body. */
function serverError(res, err) {
  console.error(err)
  res.status(500).json({ error: 'internal server error' })
}

/**
 * Minimal fixed-window limiter for INBOUND HTTP requests (throttles callers hitting
 * this server), keyed by client IP. No dependency, no shared store — the data server
 * is single-process. NOTE: this is unrelated to the OUTBOUND RPC-429 detection in the
 * CLI (`doctor.ts isRateLimit`), which reacts to an upstream RPC throttling *us*.
 * ponytail: swap for express-rate-limit if this ever runs multi-instance.
 */
function rateLimit({ windowMs, max }) {
  const hits = new Map()
  let lastSweep = 0
  return (req, res, next) => {
    const now = Date.now()
    // Amortized prune (once per window): drop expired entries so the map can't grow
    // unbounded with one-shot client IPs once the server is network-exposed. O(n) at
    // most once per window, not per request.
    if (now - lastSweep > windowMs) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k)
      lastSweep = now
    }
    const ip = req.ip || req.socket?.remoteAddress || 'local'
    const rec = hits.get(ip)
    if (!rec || now > rec.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs })
      return next()
    }
    if (rec.count >= max) return res.status(429).json({ error: 'too many requests' })
    rec.count += 1
    next()
  }
}

// Env-var names checked for a chain's RPC, in order: the numeric form
// (RPC_URL_8453) then the CLI's named alias from the SDK registry (BASE_RPC_URL).
// Derived from the SDK so a new chain needs no edit here.
const rpcEnvKeys = (chainId) => [`RPC_URL_${chainId}`, chains[chainId]?.rpcEnvVar].filter(Boolean)

// Chains the dashboard probes to discover where a (deterministically-addressed)
// SMA is deployed: every mainnet in the SDK registry, plus Base Sepolia for
// test flows. Derived from the registry — adding a mainnet includes it here.
const SUPPORTED_CHAIN_IDS = Object.values(chains)
  .filter((c) => !c.testnet || c.chainId === 84532)
  .map((c) => c.chainId)

// Last-resort public RPC endpoints, keyed by chain id. Used for chain discovery
// and read-only overviews when a project hasn't configured a per-chain RPC, so
// a multi-chain SMA still surfaces every chain it lives on out of the box.
// Sourced from the SDK chain registry (single source of truth) — do not hand-edit.
const DEFAULT_RPC_URLS = { ...defaultRpcUrls }

// Per-chain cache for the governance registration fee. The fee is a per-chain
// value that only changes after a 48h-timelocked admin vote, but /api/overview
// is polled every ~15s — so reading it live on every request would add an RPC
// round-trip (and up to the client's timeout in latency) to each poll. Cache it
// for a few minutes so the poll is cheap while still picking up a fee change
// well within the timelock window. Keyed by chainId → { fee, expiresAt }.
const REGISTRATION_FEE_TTL_MS = 5 * 60 * 1000
const registrationFeeCache = new Map()

/** Resolve the RPC URL for a specific chain from the env, with a public fallback. */
function resolveRpcUrl(env, chainId) {
  const keys = rpcEnvKeys(chainId)
  for (const k of keys) {
    if (env[k]) return env[k]
  }
  // A generic RPC_URL has no chain tag, so it only applies to the project's
  // primary chain (CHAIN_ID). Using it for any other chain would query the
  // wrong network — prefer a chain-correct public endpoint instead.
  if (env.RPC_URL && Number(env.CHAIN_ID) === Number(chainId)) return env.RPC_URL
  return DEFAULT_RPC_URLS[chainId] ?? env.RPC_URL ?? null
}

/**
 * Read the SMA's true on-chain permissionSigner + manager from the kernel.
 * The browser save paths used to default both to the owner address, which
 * desynced .sail/account.json from chain reality (audit: a Safe's real manager
 * differed from the recorded owner). Returns null if the SMA isn't registered
 * or the RPC read fails, so callers fall back to whatever they were given.
 */
async function readKernelSigners(safe, chainId, rpcUrl) {
  try {
    if (!rpcUrl || !isAddress(safe)) return null
    const kernel = getSailDeployment(Number(chainId))?.kernel
    if (!kernel) return null
    // Bounded timeout: this runs inline on the SMA-save request, so a slow or
    // rate-limited RPC must not stall the save. On timeout we fall back to the
    // caller's values rather than block.
    const client = createPublicClient({ transport: http(rpcUrl, { timeout: 4000 }) })
    const registered = await client.readContract({
      address: kernel, abi: SailKernelAbi, functionName: 'registered', args: [getAddress(safe)],
    })
    if (!registered) return null
    const configs = await client.readContract({
      address: kernel, abi: SailKernelAbi, functionName: 'configs', args: [getAddress(safe)],
    })
    const [permissionSigner, manager] = configs
    return { permissionSigner: getAddress(permissionSigner), manager: getAddress(manager) }
  } catch (err) {
    // RPC failure — fall back to caller-provided values, but surface why the
    // account may record owner-as-manager so a desync isn't fully silent.
    console.warn(`[account] on-chain signer read failed for ${safe} on chain ${chainId}; using provided values: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    return null
  }
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

const OVERVIEW_TTL_MS = 10_000

/**
 * Tiny local data server for the Sailor UI.
 *
 * Reads project state from the `.sail/` directory on disk and exposes it
 * over HTTP so the (browser-based) UI can render real account + activity
 * data. There is no hosted backend — this runs on the user's machine
 * alongside the Vite dev server.
 *
 * @param {string} sailDir Absolute path to the project's `.sail/` directory —
 *   or, for a sandbox instance, its `.shipyard/sandbox/` directory (same shape,
 *   different root; see `mode`).
 * @param {{ port?: number, mode?: 'live' | 'sandbox' }} [opts] `mode: 'sandbox'`
 *   enables the `/api/sandbox/*` fork-lifecycle routes. The CLI spawns two
 *   independent server processes — a live one (default mode, `.sail/`) and,
 *   on demand, a sandbox one (`mode: 'sandbox'`, `.shipyard/sandbox/`) — so
 *   there is no single process, and no runtime flag, that can serve both a
 *   real account and a sandbox account at once.
 */
export function startServer(sailDir, { port = PORT, mode = 'live' } = {}) {
  const app = express()
  // Behind a reverse proxy (see SAILOR_HOST exposure), set SAILOR_TRUST_PROXY so Express
  // derives req.ip from X-Forwarded-For — otherwise the rate limiter keys on the proxy's
  // IP and collapses every client into one shared bucket. Value passes through to Express
  // "trust proxy": a hop count ("1"), "true", or a comma-separated IP/subnet allowlist.
  // Default off (direct connections use the real socket IP); only trust XFF when you know
  // a proxy is in front, since a client can otherwise forge the header.
  const trustProxy = process.env.SAILOR_TRUST_PROXY
  if (trustProxy && trustProxy !== 'false' && trustProxy !== '0') {
    const hops = Number(trustProxy)
    app.set('trust proxy', Number.isFinite(hops) ? hops : trustProxy === 'true' ? true : trustProxy)
  }
  app.use(cors({ origin: CORS_ORIGINS }))
  app.use(express.json())

  // Throttle the key-management endpoints. This server can be exposed beyond
  // localhost (SAILOR_HOST), where a network client — which ignores CORS — could
  // otherwise brute-force the keystore passphrase or spam the expensive scrypt KDF.
  // Ceiling (requests/min) is configurable; precedence: env > project config > 100.
  const rateLimitPerMin = (() => {
    const fromEnv = Number(process.env.SAILOR_RATE_LIMIT_PER_MIN)
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(sailDir, 'config.json'), 'utf-8'))
      const fromCfg = Number(cfg?.rateLimitPerMin)
      if (Number.isFinite(fromCfg) && fromCfg > 0) return fromCfg
    } catch { /* no project config — use default */ }
    return 100
  })()
  const keyEndpointLimiter = rateLimit({ windowMs: 60_000, max: rateLimitPerMin })
  app.use('/api/signer', keyEndpointLimiter)
  app.use('/api/onboard/generate-key', keyEndpointLimiter)

  const at = (name) => path.join(sailDir, name)

  // Persist the active chain into config.json. The onboarding stage machine keys
  // off config.json.chainId, so SMA creation must write it through — otherwise it
  // stays null and the stage machine misclassifies on resume. Merges into any
  // existing config; creates the file if absent.
  const syncConfigChainId = (chainId) => {
    if (chainId == null) return
    try {
      const config = (() => { try { return JSON.parse(fs.readFileSync(at('config.json'), 'utf-8')) } catch { return {} } })()
      if (Number(config.chainId) === Number(chainId)) return
      config.chainId = Number(chainId)
      fs.mkdirSync(sailDir, { recursive: true })
      fs.writeFileSync(at('config.json'), `${JSON.stringify(config, null, 2)}\n`)
    } catch { /* best-effort: never block SMA creation on a config write */ }
  }

  // Effective sandbox chain cap — how many local forks one sandbox session may
  // run at once. Precedence: env > project config.json > default, clamped to
  // the supported range ([1, SANDBOX_CHAINS_CEILING]). Re-read per call so a
  // change written through POST /api/sandbox/config takes effect on the next
  // fork operation without restarting the server.
  const resolveSandboxChainCap = () => {
    const fromEnv = Number(process.env.SAILOR_MAX_SANDBOX_CHAINS)
    if (Number.isFinite(fromEnv) && fromEnv > 0) return clampSandboxChainCap(fromEnv)
    try {
      const cfg = JSON.parse(fs.readFileSync(at('config.json'), 'utf-8'))
      if (cfg?.maxSandboxChains != null) return clampSandboxChainCap(cfg.maxSandboxChains)
    } catch { /* no project config — use default */ }
    return MAX_SANDBOX_CHAINS
  }

  // All .sail/account.json + state/accounts.json access goes through the SDK's accounts
  // module — the single owner of that on-disk state. These thin shims bind this server's
  // sailDir so the handlers below read as before.
  const readActiveAccount = () => accountStore.readActiveAccount(sailDir)
  const listAccounts = () => accountStore.listAccounts(sailDir)
  const upsertActiveAccount = (fields) => accountStore.persistAccount(fields, sailDir)

  // ── Per-SMA-per-chain overview cache ────────────────────────────────────
  // Keyed by `${safe}-${chainId}` so multi-chain SMAs get independent snapshots.
  const overviewCacheByAccount = new Map() // `${safeLower}-${chainId}` -> { at, data }
  const overviewInFlight = new Set()
  const overviewCacheKey = (safe, chainId) => `${safe.toLowerCase()}-${chainId}`
  const overviewSnapshotPath = (safe, chainId) => at(`state/overview/${safe.toLowerCase()}-${chainId}.json`)

  const readOverviewSnapshot = (safe, chainId) => {
    try {
      return JSON.parse(fs.readFileSync(overviewSnapshotPath(safe, chainId), 'utf-8'))
    } catch {
      return null
    }
  }
  const writeOverviewSnapshot = (safe, chainId, data) => {
    try {
      fs.mkdirSync(at('state/overview'), { recursive: true })
      fs.writeFileSync(overviewSnapshotPath(safe, chainId), `${JSON.stringify(data, null, 2)}\n`)
    } catch { /* best-effort */ }
  }
  const storeOverview = (safe, chainId, data) => {
    overviewCacheByAccount.set(overviewCacheKey(safe, chainId), { at: Date.now(), data })
    writeOverviewSnapshot(safe, chainId, data)
  }
  const refreshOverviewInBackground = (account) => {
    const key = overviewCacheKey(account.safe, account.chainId)
    if (overviewInFlight.has(key)) return
    overviewInFlight.add(key)
    computeOverview(account)
      .then((data) => storeOverview(account.safe, account.chainId, data))
      .catch(() => {})
      .finally(() => overviewInFlight.delete(key))
  }

  // Cache of chains discovered on-chain per safe. Deployment topology rarely
  // changes, so probing every supported chain on each overview poll would be
  // wasteful — remember it for a few minutes.
  const onchainChainsCache = new Map() // safeLower -> { at, chains: number[] }
  const ONCHAIN_CHAINS_TTL_MS = 5 * 60_000

  // Resolve every chain a given SMA is deployed on. Two layers:
  //
  //  1. On-disk evidence (instant): `account.deployedChains`, the active
  //     chainId, the accounts registry, and the per-chain overview snapshots.
  //     `deployedChains` is only populated when the SMA was created through the
  //     browser flow with the full list in the payload — CLI/onboarding writes
  //     and per-chain creates leave it unset — so the other records backfill it.
  //
  //  2. On-chain discovery: an SMA address is deterministic across chains, so
  //     probe every supported chain for deployed bytecode and include any we
  //     find. This surfaces chains that were never recorded locally (e.g. a
  //     chain deployed from a different machine or before snapshots existed).
  //     Best-effort and cached; failures are ignored.
  // Authoritative on-chain probe: which supported chains this SMA ACTUALLY has bytecode on.
  // The address is deterministic across chains (CREATE2), so we check every configured chain
  // for deployed code. This is the only trustworthy signal that an SMA exists on a chain —
  // on-disk hints (a typed chainId, a stale snapshot) can claim chains it was never deployed
  // to. Cached ~5m; an RPC failure or missing URL counts as "not deployed there".
  const probeDeployedChains = async (safe) => {
    const safeLower = safe.toLowerCase()
    const cached = onchainChainsCache.get(safeLower)
    if (cached && Date.now() - cached.at < ONCHAIN_CHAINS_TTL_MS) return cached.chains
    const env = parseEnvFile(at('.env.local'))
    const found = await Promise.all(
      SUPPORTED_CHAIN_IDS.map(async (cid) => {
        const url = resolveRpcUrl(env, cid)
        if (!url) return null
        try {
          const client = createPublicClient({ transport: http(url) })
          const code = await client.getBytecode({ address: safe })
          return code && code !== '0x' ? cid : null
        } catch { return null }
      })
    )
    const discovered = found.filter((c) => c != null)
    onchainChainsCache.set(safeLower, { at: Date.now(), chains: discovered })
    return discovered
  }

  const resolveDeployedChains = async (account) => {
    const safeLower = account.safe.toLowerCase()
    const chains = new Set()
    if (Array.isArray(account.deployedChains)) {
      for (const c of account.deployedChains) if (c != null) chains.add(Number(c))
    }
    if (account.chainId != null) chains.add(Number(account.chainId))
    // Registry entries for the same safe (each carries its own chainId).
    for (const a of listAccounts()) {
      if (a?.safe?.toLowerCase() === safeLower && a.chainId != null) chains.add(Number(a.chainId))
    }
    // Per-chain overview snapshots: state/overview/<safe>-<chainId>.json
    try {
      for (const f of fs.readdirSync(at('state/overview'))) {
        const m = f.match(/^(.+)-(\d+)\.json$/)
        if (m && m[1] === safeLower) chains.add(Number(m[2]))
      }
    } catch { /* directory may not exist */ }

    // On-chain discovery across supported chains (cached).
    for (const c of await probeDeployedChains(account.safe)) chains.add(c)

    return [...chains].filter((c) => Number.isFinite(c) && c > 0)
  }

  // Sync a record's deployedChains with on-chain reality (best-effort). Called when an SMA
  // becomes active — on import (POST /api/account) or selection (/switch) — because an SMA
  // added on one chain may already be deployed on more (deterministic CREATE2 address). If
  // discovery finds a chain the stored list is missing, persist the union so the switcher
  // widget (which reads accounts.json) never under-reports. Failures leave the record as-is.
  const syncDeployedChains = async (record) => {
    try {
      const chains = await resolveDeployedChains(record)
      const known = new Set((record.deployedChains ?? []).map(Number))
      if (chains.some((c) => !known.has(c))) {
        return accountStore.persistAccount({ safe: record.safe, deployedChains: chains }, sailDir)
      }
    } catch { /* best-effort — never block the import/switch on discovery */ }
    return record
  }

  // Delete all cached overview entries (memory + disk) for a safe across all chains.
  const invalidateOverviewCache = (safe) => {
    const prefix = safe.toLowerCase() + '-'
    for (const k of overviewCacheByAccount.keys()) {
      if (k.startsWith(prefix)) overviewCacheByAccount.delete(k)
    }
    // Best-effort: remove any matching snapshot files.
    try {
      const dir = at('state/overview')
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(safe.toLowerCase() + '-')) {
          try { fs.rmSync(path.join(dir, f)) } catch { /* ignore */ }
        }
      }
    } catch { /* directory may not exist */ }
  }

  // GET /api/account — the active SMA, or 404 before it exists.
  app.get('/api/account', (_req, res) => {
    const account = readActiveAccount()
    if (!account) { res.status(404).json({ error: 'account not found' }); return }
    res.json(account)
  })

  // DELETE /api/account — clear the active pointer so the onboarding wizard shows again.
  app.delete('/api/account', (_req, res) => {
    try {
      accountStore.clearActiveAccount(sailDir)
      overviewCacheByAccount.clear()
      res.json({ ok: true })
    } catch (err) {
      serverError(res, err)
    }
  })

  // POST /api/account — persist a newly deployed SMA from the browser signing flow.
  app.post('/api/account', async (req, res) => {
    const { safe, owner, permissionSigner, manager, managers, chainId, createdAtBlock, saltNonce, txHash, deployedChains, name } = req.body ?? {}
    if (!safe || !owner || !chainId) {
      res.status(400).json({ error: 'safe, owner, and chainId are required' })
      return
    }
    try {
      // Source of truth for the SMA's signer/manager is the kernel, not the owner.
      // Read them on-chain and prefer that; fall back to the body. Leave undefined
      // when neither is known so the merge KEEPS the value already on disk (never
      // clobber a stored signer with `owner` on a partial add-network write).
      const env = parseEnvFile(at('.env.local'))
      // An add-by-address import carries no deploy proof (no saltNonce/txHash) and no chain
      // list — the chain the user picked is only a hint and may be one the SMA was NEVER
      // deployed to. Verify on-chain: deployedChains must be exactly the chains that actually
      // have bytecode, and the active chainId must be one of them. Deploy/add-network writes
      // (which DO carry proof or an explicit chain list) keep their caller-supplied chains.
      const importByAddress = saltNonce == null && txHash == null && !Array.isArray(deployedChains)
      let activeChainId = Number(chainId)
      let effectiveDeployed = deployedChains
      if (importByAddress) {
        const probed = await probeDeployedChains(safe)
        if (probed.length > 0) {
          effectiveDeployed = probed
          if (!probed.includes(activeChainId)) activeChainId = probed[0]
        }
        // probed empty ⇒ no RPC reachable; can't verify, so fall through with the typed hint.
      }
      const onchain = await readKernelSigners(safe, activeChainId, resolveRpcUrl(env, activeChainId))
      // upsertActiveAccount merges by `safe` and writes BOTH files identically, so a
      // partial write here (add-network sends no saltNonce) can't drop stored fields,
      // and it appends to the existing SMA rather than creating a duplicate.
      const merged = upsertActiveAccount({
        safe,
        owner,
        permissionSigner: onchain?.permissionSigner ?? permissionSigner ?? undefined,
        manager: onchain?.manager ?? manager ?? undefined,
        managers,
        chainId: activeChainId,
        createdAtBlock,
        saltNonce: saltNonce != null ? String(saltNonce) : undefined,
        txHash,
        deployedChains: effectiveDeployed,
        name,
      })
      // Non-import writes still reconcile against on-chain reality (cheap, cached); the import
      // path already probed above, so its deployedChains are authoritative — skip the re-probe.
      const synced = importByAddress ? merged : await syncDeployedChains(merged)
      // Keep config.json.chainId in step with the active SMA's chain (stage machine reads it).
      syncConfigChainId(activeChainId)
      res.json({ ok: true, account: synced })
    } catch (err) {
      serverError(res, err)
    }
  })

  // GET /api/accounts — all known SMAs, each annotated with the derived `active` flag.
  app.get('/api/accounts', (_req, res) => {
    res.json(listAccounts())
  })

  // POST /api/account/switch — make a known SMA the active one.
  app.post('/api/account/switch', async (req, res) => {
    const { safe } = req.body ?? {}
    if (!safe) { res.status(400).json({ error: 'safe is required' }); return }
    try {
      const target = accountStore.switchAccount(safe, sailDir)
      if (!target) { res.status(404).json({ error: 'SMA not found in accounts list' }); return }

      // Reconcile deployedChains with on-chain reality on selection (see syncDeployedChains).
      const active = await syncDeployedChains(target)

      // Switching to an SMA on a different chain must move config.json.chainId too,
      // or the stage machine / CLI active chain goes stale (multichain case).
      syncConfigChainId(active.chainId)
      res.json({ ok: true, active })
    } catch (err) {
      serverError(res, err)
    }
  })

  // POST /api/account/rename — update the display name of a known SMA.
  app.post('/api/account/rename', (req, res) => {
    const { safe, name } = req.body ?? {}
    if (!safe || !name) { res.status(400).json({ error: 'safe and name are required' }); return }
    // Cap length and strip control chars: the name lands in accounts.json and the
    // JSONL activity log, where a raw newline would corrupt a record.
    const cleanName = typeof name === 'string' ? name.replace(/\p{Cc}/gu, '').trim() : ''
    if (!cleanName || cleanName.length > 100) {
      res.status(400).json({ error: 'name must be 1–100 characters' }); return
    }
    try {
      if (!listAccounts().some((a) => a.safe.toLowerCase() === safe.toLowerCase())) {
        res.status(404).json({ error: 'SMA not found' }); return
      }
      // renameAccount updates the list entry and keeps account.json in step when the
      // renamed SMA is the active one, so the two files never drift on `name`.
      accountStore.renameAccount(safe, cleanName, sailDir)
      res.json({ ok: true })
    } catch (err) {
      serverError(res, err)
    }
  })

  // The active SMA's address, or null before one exists.
  const readActiveSafe = () => accountStore.readActiveSafe(sailDir)

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
      const accts = listAccounts()
      const knownCount = accts.length
      const legacySafe = accts[0]?.safe ?? activeSafe

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
      const account = readActiveAccount()
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
      serverError(res, err)
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
      fs.writeFileSync(managerKeyPath(safe), `${JSON.stringify(keystore, null, 2)}\n`, { mode: 0o600 })
      fs.chmodSync(managerKeyPath(safe), 0o600)
      // Persist the passphrase so `sailor run` (local + CI cron) can unlock this
      // key non-interactively — the CLI reads SAIL_PASSPHRASE from .sail/.env.local.
      persistPassphrase(at('.env.local'), password)

      // Record the creation (address only — never the secret) in the activity log.
      try {
        const ev = { ts: new Date().toISOString(), actor: 'owner', type: 'signer_created', method, address: keyring.address, safe }
        fs.appendFileSync(at('activity.jsonl'), `${JSON.stringify(ev)}\n`)
      } catch { /* non-fatal */ }

      // Invalidate cached overviews (all chains) for this safe so the new signer shows.
      invalidateOverviewCache(safe)

      res.json({ ok: true, address: keyring.address, revealed })
    } catch (err) {
      serverError(res, err)
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
      // persistAccount sets the new active manager and folds it into managers[] (the
      // rotation history), updating both the list entry and account.json. The on-chain
      // rotation is the source of truth; this only keeps local state in sync.
      accountStore.persistAccount({ safe, manager }, sailDir)
      // Record the rotation in the activity log.
      try {
        const ev = { ts: new Date().toISOString(), actor: 'owner', type: 'signer_rotated', newManager: manager, safe, ...(txHash ? { txHash } : {}) }
        fs.appendFileSync(at('activity.jsonl'), `${JSON.stringify(ev)}\n`)
      } catch { /* non-fatal */ }
      // Invalidate cached overviews (all chains) so the new signer shows immediately.
      invalidateOverviewCache(safe)
      res.json({ ok: true, manager })
    } catch (err) {
      serverError(res, err)
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
      const activeManager = readActiveAccount()?.manager ?? null
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
      serverError(res, err)
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
      // New active signer — drop cached overviews (all chains) so it shows immediately.
      invalidateOverviewCache(safe)
      res.json({ ok: true, address: getAddress(address), file: match })
    } catch (err) {
      serverError(res, err)
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

  // POST /api/mandate-submit { signature, signedAt, permissions, deadline } —
  // takes the browser-produced RegisterPermissions signature, SUBMITS the
  // registration on-chain via the agent (manager) key, then writes the canonical
  // mandate.json. (F18: previously this read the wrong draft shape — yielding an
  // empty permission list — and never registered on-chain, so the rich-UI signing
  // path silently produced a dead local stub. It now mirrors `sailor mandate
  // attach`: the owner's signature + the agent submitting and paying gas.)
  app.post('/api/mandate-submit', async (req, res) => {
    const { signature, signedAt, permissions: signedAddrs, deadline } = req.body ?? {}
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

    const safe = draft.account
    const chainId = draft.chainId
    // Read BOTH draft shapes: `sailor mandate prepare` writes `permissions`
    // (CLI), legacy writes `items`. (This mismatch was the F18 empty-list bug.)
    const draftPerms = draft.permissions ?? draft.items ?? []
    const permissionMeta = draftPerms.map((p) => ({
      template: p.label ?? p.template ?? null,
      address: p.address ?? p.template ?? null,
      explanation: p.explanation ?? null,
    }))

    // Addresses to register, in the exact order the wallet signed them.
    const addrs = (Array.isArray(signedAddrs) && signedAddrs.length
      ? signedAddrs
      : permissionMeta.map((p) => p.address)
    ).filter(Boolean).map((a) => getAddress(a))

    // ── Submit the registration on-chain (agent pays gas + fee) ──────────────
    let txHash = null
    try {
      if (!deadline) throw new Error('missing deadline')
      if (addrs.length === 0) throw new Error('no permissions to register')
      const env = parseEnvFile(at('.env.local'))
      const password = process.env.SAIL_PASSPHRASE || env.SAIL_PASSPHRASE
      if (!password) throw new Error('SAIL_PASSPHRASE not set — cannot unlock the agent key')
      const rpcUrl = env.RPC_URL || env.BASE_SEPOLIA_RPC_URL
      if (!rpcUrl) throw new Error('RPC_URL not set in .sail/.env.local')
      const deployment = getSailDeployment(Number(chainId))
      if (!deployment?.kernel) throw new Error(`No SailKernel deployment for chain ${chainId}`)

      const keyring = await LocalKeyring.fromKeystoreFile(at('keys/manager.json'), password)
      const publicClient = createPublicClient({ transport: http(rpcUrl) })

      // Flat fee × N (0 for zero-fee deploys). The kernel's batch
      // registerPermissions requires msg.value >= flat fee × n.
      const flatFee = await readPermissionRegistrationFee(publicClient, deployment.governance)
      const fee = flatFee * BigInt(addrs.length)

      const chain = defineChain({
        id: Number(chainId),
        name: `chain-${chainId}`,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      })
      const walletClient = createWalletClient({ account: keyring.viemAccount, chain, transport: http(rpcUrl) })
      const data = encodeFunctionData({
        abi: SailKernelAbi,
        functionName: 'registerPermissions',
        args: [getAddress(safe), addrs, BigInt(deadline), signature],
      })
      txHash = await walletClient.sendTransaction({ to: deployment.kernel, data, value: fee, account: keyring.viemAccount, chain })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      if (receipt.status !== 'success') throw new Error(`registerPermissions reverted (tx ${txHash})`)

      // Record each registration in the activity log so the fee actually paid
      // surfaces in Recent Activity — the signer path otherwise writes only
      // mandate.json and its registrations never appeared. Each permission in
      // the batch is charged the same flat fee.
      const feeEth = formatEther(flatFee)
      const feeSymbol = getNativeCurrencySymbol(Number(chainId))
      for (const addr of addrs) {
        const meta = permissionMeta.find((p) => p.address && getAddress(p.address) === addr)
        const ev = {
          ts: new Date().toISOString(),
          actor: 'agent',
          type: 'permission_registered',
          permission: addr,
          ...(meta?.template ? { name: meta.template } : {}),
          sma: safe,
          txHash,
          chainId,
          fee: flatFee.toString(),
          feeEth,
          feeSymbol,
        }
        try { fs.appendFileSync(at('activity.jsonl'), `${JSON.stringify(ev)}\n`) } catch { /* activity log is best-effort */ }
      }
    } catch (err) {
      res.status(500).json({ error: `On-chain registration failed: ${(err?.message ?? String(err)).split('\n')[0]}` })
      return
    }

    const mandate = {
      safe,
      chainId,
      signedAt: signedAt || new Date().toISOString(),
      signature,
      registeredOnChain: true,
      txHash,
      permissions: permissionMeta,
    }
    try {
      fs.mkdirSync(sailDir, { recursive: true })
      let existing = []
      try {
        const raw = JSON.parse(fs.readFileSync(at('mandate.json'), 'utf-8'))
        existing = Array.isArray(raw) ? raw : [raw]
      } catch { /* no existing mandate */ }
      // Replace any prior record for this safe+chain instead of blindly appending
      // duplicates (another half of the F18 bug).
      const deduped = existing.filter(
        (m) => !(m.safe?.toLowerCase() === safe?.toLowerCase() && m.chainId === chainId),
      )
      fs.writeFileSync(at('mandate.json'), `${JSON.stringify([...deduped, mandate], null, 2)}\n`)
      try {
        fs.rmSync(at('mandate-draft.json'))
      } catch {
        // draft already gone — fine
      }
      res.json(mandate)
    } catch (err) {
      serverError(res, err)
    }
  })

  // Reads a single agent PID from a file, or null.
  const readPidFile = (filePath) => {
    try {
      const pid = Number.parseInt(fs.readFileSync(filePath, 'utf-8').trim(), 10)
      return Number.isNaN(pid) ? null : pid
    } catch {
      return null
    }
  }

  // Scans .sail/ for agent-<chainId>.pid files (and legacy agent.pid).
  // Returns an array of { chainId, pid } for every live process found.
  const readAgentPids = () => {
    const results = []
    try {
      const files = fs.readdirSync(sailDir)
      for (const f of files) {
        const chainMatch = f.match(/^agent-(\d+)\.pid$/)
        if (chainMatch) {
          const pid = readPidFile(path.join(sailDir, f))
          if (pid !== null && isAlive(pid)) results.push({ chainId: Number(chainMatch[1]), pid })
        }
      }
    } catch {}
    // Fall back to legacy agent.pid if no chain-specific files found
    if (results.length === 0) {
      const pid = readPidFile(path.join(sailDir, 'agent.pid'))
      if (pid !== null && isAlive(pid)) results.push({ chainId: null, pid })
    }
    return results
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
    const pids = readAgentPids()
    if (pids.length > 0) {
      const first = pids[0]
      return res.json({ running: true, pid: first.pid, pids, source: 'local', githubActions })
    }
    const ageMs = recentActivityMs()
    if (ageMs < 10 * 60 * 1000) return res.json({ running: true, source: 'remote', lastActivityMs: ageMs, githubActions })
    res.json({ running: false, githubActions })
  })

  // POST /api/agent-status { action: 'stop' } — SIGTERM all running agent processes.
  app.post('/api/agent-status', (req, res) => {
    if (req.body?.action !== 'stop') {
      res.status(400).json({ error: 'unknown action' })
      return
    }
    const pids = readAgentPids()
    if (pids.length > 0) {
      const stopped = []
      const errors = []
      for (const { pid } of pids) {
        try { process.kill(pid, 'SIGTERM'); stopped.push(pid) } catch (err) { errors.push(String(err)) }
      }
      if (errors.length > 0) return res.status(500).json({ error: errors.join('; ') })
      return res.json({ ok: true, stopped })
    }
    res.json({ ok: true, running: false })
  })

  // GET /api/station/pending — proxy to the signing server daemon, or [] if not running.
  // (Endpoint path unrenamed — internal-only, never surfaced to a user/agent.)
  // Discovery order: runtime/server.json (written by `sailor signer start`),
  // then port-scan 3141–3150 (same range the UI signing page uses), with a
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

  // A daemon serves exactly one state root (live `.sail/` vs a sandbox's
  // `.shipyard/sandbox/`). A dashboard must only surface a daemon rooted at
  // ITS OWN root — the port-scan fallback can otherwise land on the other
  // surface's daemon, whose approvals would then be logged to (and its
  // requests drawn from) the wrong directory. Daemons advertise their root in
  // /config.sailDir; an older daemon that doesn't is accepted as before.
  function stationMatchesThisRoot(config) {
    if (!config?.sailDir) return true
    return path.resolve(String(config.sailDir)) === path.resolve(sailDir)
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
        if (config && stationMatchesThisRoot(config)) {
          const secret = requestSecret ?? secretFromConfig(config)
          stationCache = { port, secret, expiresAt: Date.now() + 10_000 }
          return stationCache
        }
      }
    } catch { /* fall through to port-scan */ }
    // 2. Port-scan the known range (same as the signing UI page does), reading
    //    the secret out of /config's wsUrl. Skip daemons rooted elsewhere.
    for (const port of STATION_PORTS) {
      try {
        const config = await fetch(`http://127.0.0.1:${port}/config`, { signal: AbortSignal.timeout(300) }).then(r => r.ok ? r.json() : null).catch(() => null)
        if (config && stationMatchesThisRoot(config)) {
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
    const activeAccount = readActiveAccount()
    const hasAccount = activeAccount != null
    const managerKeyPath = at('keys/manager.json')
    let managerAddress = null
    try {
      const ks = JSON.parse(fs.readFileSync(managerKeyPath, 'utf-8'))
      managerAddress = ks?.address ? getAddress(`0x${String(ks.address).replace(/^0x/, '')}`) : null
    } catch {}
    // Prefer config.json.chainId, but fall back to the active account.json when
    // config hasn't been synced yet (defends against a stale config.chainId:null
    // after browser onboarding). config still wins when explicitly set.
    const accountChainId = activeAccount?.chainId ?? null
    const chainId = config?.chainId ?? accountChainId ?? 8453
    let deployment = null
    try { deployment = getSailDeployment(chainId) } catch {}
    // Collect per-chain RPC URLs. Check both numeric (RPC_URL_8453) and named
    // (BASE_RPC_URL) aliases so projects using either format show as configured.
    const rpcByChain = {}
    for (const cid of SUPPORTED_CHAIN_IDS) {
      const url = resolveRpcUrl(env, cid)
      // Only store if an explicit per-chain key matched — don't propagate a
      // generic RPC_URL to every chain in the list.
      const keys = rpcEnvKeys(cid)
      if (keys.some((k) => env[k])) rpcByChain[cid] = url
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
    // Validate at the trust boundary: chainId must be a KNOWN integer (it becomes
    // an env-var key) and values must be single-line http(s) URLs — otherwise a
    // newline could inject an extra KEY=VALUE line (e.g. overwrite SAIL_PASSPHRASE).
    const cid = Number(chainId)
    if (chainId !== undefined && !chains[cid]) {
      res.status(400).json({ error: 'unsupported chainId' }); return
    }
    if (rpcUrl !== undefined && (!isSafeEnvValue(rpcUrl) || !isHttpUrl(rpcUrl))) {
      res.status(400).json({ error: 'invalid rpcUrl' }); return
    }
    if (sailApiKey !== undefined && !isSafeEnvValue(sailApiKey)) {
      res.status(400).json({ error: 'invalid sailApiKey' }); return
    }
    try {
      const config = (() => { try { return JSON.parse(fs.readFileSync(at('config.json'), 'utf-8')) } catch { return null } })()
      const activeChainId = config?.chainId ?? 8453
      const envPath = at('.env.local')
      const existing = parseEnvFile(envPath)
      if (rpcUrl && chainId) {
        // cid is a validated integer — never interpolate the raw chainId here.
        existing[`RPC_URL_${cid}`] = rpcUrl
        // Keep RPC_URL in sync with the active chain so CLI commands work.
        if (cid === Number(activeChainId)) existing.RPC_URL = rpcUrl
      } else if (rpcUrl) {
        existing.RPC_URL = rpcUrl
      }
      if (sailApiKey) existing.SAIL_API_KEY = sailApiKey
      if (chainId) existing.CHAIN_ID = String(cid)
      const content = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
      fs.mkdirSync(sailDir, { recursive: true })
      // 0600: .env.local can hold SAIL_PASSPHRASE (preserved across rewrites), matching the CLI.
      fs.writeFileSync(envPath, content, { mode: 0o600 })
      fs.chmodSync(envPath, 0o600)
      res.json({ ok: true })
    } catch (err) {
      serverError(res, err)
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
      // Enforce the minimum server-side too. The wizard requires 8+ chars, but
      // this endpoint is the real gate — a direct call or any UI regression must
      // not be able to write a weakly/empty-encrypted agent key. Matches the CLI
      // `keys generate` minimum.
      if (typeof passphrase !== 'string' || passphrase.length < 8) {
        res.status(400).json({ error: 'Passphrase must be at least 8 characters.' })
        return
      }
      const privateKey = generatePrivateKey()
      const keyring = LocalKeyring.fromPrivateKey(privateKey)
      const keystore = await keyring.exportKeystore(passphrase)
      fs.mkdirSync(at('keys'), { recursive: true })
      fs.writeFileSync(managerKeyPath, `${JSON.stringify(keystore, null, 2)}\n`, { mode: 0o600 })
      fs.chmodSync(managerKeyPath, 0o600)
      // Persist the passphrase so `sailor run` (local + CI cron) can unlock this
      // key non-interactively — the CLI reads SAIL_PASSPHRASE from .sail/.env.local.
      persistPassphrase(at('.env.local'), passphrase)
      res.json({ address: keyring.address, existed: false })
    } catch (err) {
      serverError(res, err)
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
      serverError(res, err)
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
      serverError(res, err)
    }
  })

  // POST /api/onboard/complete { safe, owner, manager, txHash, chainId } —
  // called after the browser wallet confirms kernel.createAccount. Writes
  // account.json (same format as `sailor onboard`).
  app.post('/api/onboard/complete', async (req, res) => {
    try {
      const { safe, owner, manager, txHash, chainId: reqChainId, saltNonce } = req.body ?? {}
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
      // Prefer the kernel's true manager/permissionSigner over local guesses.
      // Falls back to the request body, then the local keystore, then owner.
      const onchain = await readKernelSigners(safe, chainId, resolveRpcUrl(parseEnvFile(at('.env.local')), Number(chainId)))
      const managerKeyPath = at('keys/manager.json')
      let resolvedManager = onchain?.manager ?? manager
      if (!resolvedManager) {
        try {
          const ks = JSON.parse(fs.readFileSync(managerKeyPath, 'utf-8'))
          resolvedManager = ks?.address ? getAddress(`0x${String(ks.address).replace(/^0x/, '')}`) : owner
        } catch { resolvedManager = owner }
      }
      // Merge-upsert into the master list and mirror into account.json (one writer).
      // saltNonce is the exact salt build-create-tx used — `sailor account predict`
      // and `account add-chain` need it to reproduce the deployed CREATE2 address;
      // upsertActiveAccount guarantees it survives every later partial write.
      const record = upsertActiveAccount({
        safe: getAddress(safe),
        owner: getAddress(owner),
        permissionSigner: onchain?.permissionSigner ?? getAddress(owner),
        manager: getAddress(resolvedManager),
        chainId,
        createdAtBlock,
        txHash: txHash || undefined,
        saltNonce: saltNonce != null ? String(saltNonce) : undefined,
      })
      // Sync the chosen chain into config.json. The onboarding stage machine keys
      // off config.json.chainId; leaving it null after SMA creation caused stage
      // misclassification on resume.
      syncConfigChainId(chainId)
      res.json({ ok: true, account: record })
    } catch (err) {
      serverError(res, err)
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
    const account = readActiveAccount()
    if (!account) {
      res.json(null)
      return
    }
    if (!account?.safe) {
      res.json(null)
      return
    }

    const chainId = account.chainId
    const key = overviewCacheKey(account.safe, chainId)
    const cached = overviewCacheByAccount.get(key)

    // Fresh in memory → serve as-is.
    if (cached && Date.now() - cached.at < OVERVIEW_TTL_MS) {
      res.json(cached.data)
      return
    }

    // Stale memory entry or a persisted snapshot → serve instantly, then
    // refresh from chain in the background.
    const snapshot = cached?.data ?? readOverviewSnapshot(account.safe, chainId)
    if (snapshot) {
      res.json(snapshot)
      refreshOverviewInBackground(account)
      return
    }

    // Cold (never seen this SMA+chain): return a disk-only skeleton instantly so
    // the agent wallet (EOA) address renders without waiting on RPC, then hydrate
    // balances from chain in the background. The dashboard's 2s poll picks up the
    // enriched snapshot. Without this, the locally-known address was trapped
    // behind the overview's balance RPC calls and only appeared once they resolved.
    const skeleton = await computeOverview(account, { localOnly: true })
    res.json(skeleton)
    refreshOverviewInBackground(account)
  })

  // GET /api/overviews — one overview per deployed chain for the active SMA.
  // Used by the multi-chain dashboard to show per-chain mandates + signers.
  app.get('/api/overviews', async (_req, res) => {
    const account = readActiveAccount()
    if (!account?.safe) { res.json([]); return }

    const deployedChains = await resolveDeployedChains(account)

    const results = await Promise.all(
      deployedChains.map(async (cid) => {
        const chainAccount = { ...account, chainId: cid }
        const key = overviewCacheKey(account.safe, cid)
        const cached = overviewCacheByAccount.get(key)
        if (cached && Date.now() - cached.at < OVERVIEW_TTL_MS) return cached.data
        const snapshot = cached?.data ?? readOverviewSnapshot(account.safe, cid)
        if (snapshot) {
          refreshOverviewInBackground(chainAccount)
          return snapshot
        }
        // Cold: return a disk-only skeleton instantly (EOA address, no balances)
        // and hydrate from chain in the background — see /api/overview.
        const skeleton = await computeOverview(chainAccount, { localOnly: true })
        refreshOverviewInBackground(chainAccount)
        return skeleton
      })
    )
    res.json(results)
  })

  // Build the consolidated overview for a local account record by reading the
  // kernel + balances on-chain. Never throws: on RPC failure it returns a
  // best-effort result with `onchainError` set so the UI degrades gracefully.
  async function computeOverview(account, { localOnly = false } = {}) {
    const env = parseEnvFile(at('.env.local'))
    const chainId = Number(account.chainId ?? env.CHAIN_ID ?? 0)
    let kernel = env.KERNEL_ADDRESS
    let governance
    if (!kernel) {
      try {
        const deployment = getSailDeployment(chainId)
        kernel = deployment?.kernel
        governance = deployment?.governance
      } catch {
        kernel = undefined
      }
    } else {
      try {
        governance = getSailDeployment(chainId)?.governance
      } catch {
        governance = undefined
      }
    }
    const rpcUrl = resolveRpcUrl(env, chainId)

    // The live per-permission registration fee for this chain — read
    // independently of the SMA-specific block below since it's a per-chain
    // governance value, not per-account, and only changes after a 48h-timelocked
    // admin vote. Best-effort: a failed read leaves `registrationFee` null so the
    // UI falls back to its static disclosure copy instead of breaking the page.
    let registrationFee = null
    if (!localOnly && governance && rpcUrl) {
      const cached = registrationFeeCache.get(chainId)
      if (cached && cached.expiresAt > Date.now()) {
        registrationFee = cached.fee
      } else {
        try {
          const feeClient = createPublicClient({ transport: http(rpcUrl, { timeout: 4000 }) })
          const feeWei = await readPermissionRegistrationFee(feeClient, governance)
          registrationFee = {
            feeWei: feeWei.toString(),
            feeEth: formatEther(feeWei),
            symbol: getNativeCurrencySymbol(chainId),
          }
          registrationFeeCache.set(chainId, { fee: registrationFee, expiresAt: Date.now() + REGISTRATION_FEE_TTL_MS })
        } catch {
          registrationFee = null
        }
      }
    }

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

    const network = chains[chainId]?.slug ?? null
    const result = {
      generatedAt: new Date().toISOString(),
      chainId,
      network,
      kernel: kernel ?? null,
      rpcConfigured: Boolean(rpcUrl),
      onchain: false,
      registrationFee,
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
    // Resolve the SAME way `sailor run` does (resolveKeyPath): the active SMA's
    // own keystore wins; the legacy flat keys/manager.json is only the fallback
    // when this SMA has no per-SMA key. Unioning all three (the old behavior)
    // surfaced a key belonging to a DIFFERENT SMA as this SMA's "local key", and
    // invented a local key when none on disk applies to the active SMA (audit #10).
    const activeKeyPath =
      [perSmaPath, legacyPerSmaPath].find((p) => fs.existsSync(p)) ??
      (fs.existsSync(flatManagerPath) ? flatManagerPath : null)
    if (activeKeyPath) {
      try {
        const ks = JSON.parse(fs.readFileSync(activeKeyPath, 'utf-8'))
        if (ks?.address) {
          localManagerAddrs.add(getAddress(`0x${String(ks.address).replace(/^0x/, '')}`))
        }
      } catch {
        /* ignore bad/missing keystore */
      }
    }
    const localSigner = localManagerAddrs.size > 0 ? [...localManagerAddrs][0] : null

    if (!localOnly && kernel && isAddress(kernel) && account.safe && isAddress(account.safe)) {
      try {
        const client = createPublicClient({ transport: http(rpcUrl) })
        const safe = getAddress(account.safe)
        const [registered, configs, perms, safeBal] = await Promise.all([
          client.readContract({ address: kernel, abi: SailKernelAbi, functionName: 'registered', args: [safe] }),
          client.readContract({ address: kernel, abi: SailKernelAbi, functionName: 'configs', args: [safe] }),
          client.readContract({ address: kernel, abi: SailKernelAbi, functionName: 'getPermissions', args: [safe] }),
          client.getBalance({ address: safe }),
        ])
        // configs = (permissionSigner, manager, feePolicy, feeAsset, sessionActive)
        const [permissionSigner, manager, , , sessionActive] = configs

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
          // The active manager is per-chain: this chain's on-chain delegate if
          // set, otherwise the owner (who controls the SMA directly until a
          // delegate is registered here). Do NOT fall back to the global
          // account.manager — for a multi-chain SMA that holds the delegate from
          // whichever chain was rotated last, which would wrongly mark a chain's
          // real controller (the owner) as idle.
          const activeLower = (managerSet ? getAddress(manager) : (account.owner ? getAddress(account.owner) : null))?.toLowerCase() ?? null
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
      // localOnly = disk skeleton (no RPC): leave onchain=false with no error so
      // the UI renders the known EOA/mandates instead of an "RPC down" state.
      if (!localOnly) result.onchainError = 'No kernel/RPC configured for on-chain reads'
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

    // Count mandate *documents* (not individual permissions) — one mandate can
    // grant multiple permissions. Primary source: state/mandates.json filtered
    // to this SMA + chain. Fallback: mandate.json filtered by chainId.
    const storeCount = mandatesFromStore(at, account, nameByAddr, templateByAddr, network).length
    if (storeCount > 0) {
      result.mandateCount = storeCount
    } else {
      try {
        const raw = JSON.parse(fs.readFileSync(at('mandate.json'), 'utf-8'))
        const mandates = Array.isArray(raw) ? raw : [raw]
        result.mandateCount = mandates.filter((m) =>
          (m.registeredOnChain || m.signature) &&
          (m.chainId == null || m.chainId === chainId)
        ).length
      } catch {
        result.mandateCount = 0
      }
    }

    return result
  }

  // GET/POST /api/wallet-config — the Reown (WalletConnect) project id, stored in
  // .sail/.env.local. It is a public app identifier rather than a secret, so it is
  // returned to the browser as-is (unlike RPC keys, which are masked).
  app.get('/api/wallet-config', (_req, res) => {
    try {
      const env = parseEnvFile(at('.env.local'))
      const fromEnv = String(process.env.WALLETCONNECT_PROJECT_ID ?? '').trim()
      const projectId = fromEnv || String(env.WALLETCONNECT_PROJECT_ID ?? '').trim()
      res.json({
        walletConnectProjectId: projectId,
        configured: WALLETCONNECT_PROJECT_ID_RE.test(projectId),
        // A process env var wins over the file, so the browser must not offer to
        // edit it — the write would be silently shadowed.
        managedByEnv: fromEnv !== '',
      })
    } catch (err) {
      serverError(res, err)
    }
  })

  app.post('/api/wallet-config', (req, res) => {
    try {
      const raw = req.body?.projectId
      const projectId = typeof raw === 'string' ? raw.trim() : ''
      if (!isSafeEnvValue(projectId)) {
        return res.status(400).json({ error: 'projectId contains an illegal character' })
      }
      // '' clears the setting; anything else must be a real Reown id shape, so a
      // mis-paste is caught here instead of dying silently at the relay.
      if (projectId !== '' && !WALLETCONNECT_PROJECT_ID_RE.test(projectId)) {
        return res.status(400).json({
          error: `Not a Reown project id — expected 32 hex characters, got ${projectId.length}.`,
        })
      }
      upsertEnvVar(at('.env.local'), 'WALLETCONNECT_PROJECT_ID', projectId)
      res.json({ ok: true, walletConnectProjectId: projectId, configured: projectId !== '' })
    } catch (err) {
      serverError(res, err)
    }
  })

  // GET /api/version — running (process-start) vs installed (live on-disk) version.
  // `stale: true` means the package was upgraded under a running `sailor ui`, so
  // the dashboard is serving old assets/code; the client prompts a restart/reload.
  app.get('/api/version', (_req, res) => {
    const installed = readPackageVersion()
    res.json({ running: RUNNING_VERSION, installed, stale: Boolean(RUNNING_VERSION && installed && installed !== RUNNING_VERSION) })
  })

  // Lets the frontend tell a sandbox page apart from a live one (mounts the
  // SandboxBanner / gates the dev-wallet connector) without ever trusting a
  // client-supplied flag — this process's own `mode` is fixed at spawn time.
  app.get('/api/mode', (_req, res) => {
    res.json({ mode })
  })

  // A plain positive decimal string ("0.1", "1000", "5") — the fund routes
  // validate amounts this way (not via `Number(...)`) so an 18-decimal ETH
  // amount survives to fundNative/fundErc20 without floating-point rounding.
  function isPositiveDecimalString(value) {
    return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0
  }

  // ── Sandbox (native local-fork simulation) ──────────────────────────────
  // Only registered on a sandbox-mode server instance (see startServer's
  // `mode` option) — the live server never has these routes at all, so there
  // is no branch here to forget: a request to spin up/tear down anvil forks
  // has no code path that could ever land on a real chain.
  if (mode === 'sandbox') {
    app.post('/api/sandbox/forks', async (req, res) => {
      const { chainIds, primary } = req.body ?? {}
      if (!Array.isArray(chainIds) || chainIds.length === 0 || chainIds.some((c) => !Number.isInteger(c))) {
        return res.status(400).json({ error: 'chainIds must be a non-empty array of integer chain ids' })
      }
      for (const chainId of chainIds) {
        try {
          getSailDeployment(chainId)
        } catch {
          return res.status(400).json({ error: `Chain ${chainId} has no Sail deployment to fork — pick a supported network.` })
        }
      }
      try {
        const result = await startSandboxForks({ sandboxDir: sailDir, chains: chainIds, primary, maxChains: resolveSandboxChainCap() })
        res.json({ ok: true, ...result })
      } catch (e) {
        const status = e instanceof TooManySandboxChainsError ? 400 : 500
        res.status(status).json({ error: e?.message || String(e) })
      }
    })

    app.get('/api/sandbox/forks', async (_req, res) => {
      try {
        const forks = await refreshSandboxForks(sailDir)
        res.json({ forks })
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) })
      }
    })

    // How many forks are currently running (answering as "ready"). The chain
    // cap governs this count; a fork that's "stopped"/"failed"/"spawning"
    // doesn't occupy a live slot.
    const countActiveForks = async () => {
      const forks = await refreshSandboxForks(sailDir)
      return Object.values(forks).filter((f) => f.status === 'ready').length
    }

    // Sandbox chain-cap config. GET reports the effective cap (env > config >
    // default), the hard ceiling, the default, and how many forks are live now
    // — everything the UI needs to render "N of cap networks active" and gate
    // the per-chain toggles. POST persists a new cap into config.json (clamped
    // to the supported range); it does NOT stop any running fork — reducing a
    // live over-cap set is the explicit POST /api/sandbox/forks/reduce below.
    app.get('/api/sandbox/config', async (_req, res) => {
      try {
        const maxChains = resolveSandboxChainCap()
        const activeCount = await countActiveForks()
        res.json({ maxChains, defaultMax: MAX_SANDBOX_CHAINS, ceiling: SANDBOX_CHAINS_CEILING, activeCount, overCap: activeCount > maxChains })
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) })
      }
    })

    app.post('/api/sandbox/config', async (req, res) => {
      const { maxChains } = req.body ?? {}
      if (!Number.isInteger(maxChains) || maxChains < 1) {
        return res.status(400).json({ error: 'maxChains must be a positive integer' })
      }
      const clamped = clampSandboxChainCap(maxChains)
      try {
        const config = (() => { try { return JSON.parse(fs.readFileSync(at('config.json'), 'utf-8')) } catch { return {} } })()
        config.maxSandboxChains = clamped
        fs.mkdirSync(sailDir, { recursive: true })
        fs.writeFileSync(at('config.json'), `${JSON.stringify(config, null, 2)}\n`)
      } catch (e) {
        return res.status(500).json({ error: e?.message || String(e) })
      }
      // Report the *effective* cap, which can differ from what we just wrote if
      // SAILOR_MAX_SANDBOX_CHAINS is set (env wins) — so the UI never shows a
      // saved value the server won't actually honor.
      const effective = resolveSandboxChainCap()
      const activeCount = await countActiveForks()
      res.json({ ok: true, maxChains: effective, requested: clamped, ceiling: SANDBOX_CHAINS_CEILING, activeCount, overCap: activeCount > effective })
    })

    // Explicit "reduce now": stop the lowest-priority live forks until the live
    // set is within the cap (keeps primary + most recent — see
    // enforceSandboxChainCap). The one-click action behind the settings warning
    // when a lowered cap leaves more forks running than allowed.
    app.post('/api/sandbox/forks/reduce', async (_req, res) => {
      try {
        const result = await enforceSandboxChainCap(sailDir, resolveSandboxChainCap())
        res.json({ ok: true, ...result })
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) })
      }
    })

    app.post('/api/sandbox/reset', async (req, res) => {
      try {
        await resetSandbox(sailDir, { purgeState: Boolean(req.body?.purgeState) })
        res.json({ ok: true })
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) })
      }
    })

    // Settings-modal "Reset sandbox" — a full wipe, not just the forks: stops
    // every fork, purges the manifest, retires each chain's dumped anvil
    // state, and moves the SMA record/mandate/activity log/keys into a
    // timestamped backup dir (see resetSandboxProject) so the project looks
    // brand new (onboarding wizard reappears) without destroying anything.
    // Saved worlds: every reset (and every activation) archives the whole
    // sandbox world into _reset-backup-<stamp>/. These two routes let the
    // settings panel navigate between them — list what's saved, and swap a
    // previous world back in (current one is archived first, its forks
    // restart from their dumped chain state).
    app.get('/api/sandbox/backups', (_req, res) => {
      try {
        res.json({ backups: listSandboxBackups(sailDir) })
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) })
      }
    })

    app.post('/api/sandbox/backups/activate', async (req, res) => {
      const name = String(req.body?.name ?? '')
      try {
        const result = await activateSandboxBackup(sailDir, name)
        res.json({ ok: true, ...result })
      } catch (e) {
        const message = e?.message || String(e)
        const status = /Not a sandbox backup name/.test(message) ? 400
          : /No sandbox backup named/.test(message) ? 404
          : 500
        res.status(status).json({ error: message })
      }
    })

    app.post('/api/sandbox/reset-project', async (_req, res) => {
      try {
        const result = await resetSandboxProject(sailDir)
        res.json({ ok: true, ...result })
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) })
      }
    })

    // Settings-modal "Fund gas" — sets an address's native balance directly
    // via anvil_setBalance on the requested chain's sandbox fork. No faucet or
    // real transfer involved; this only ever runs against this sandbox's own
    // forked RPC (see the mode === 'sandbox' gate around this whole block).
    app.post('/api/sandbox/fund/native', async (req, res) => {
      const { chainId, address, amountEth } = req.body ?? {}
      if (!Number.isInteger(chainId)) return res.status(400).json({ error: 'chainId must be an integer' })
      if (!isAddress(address ?? '')) return res.status(400).json({ error: 'address must be a valid 0x address' })
      // Validated as a string, not routed through Number for the actual value
      // passed to fundNative — a JS double can't safely round-trip an 18-decimal
      // ETH amount, and this is a whole-token amount (e.g. "0.1" = 0.1 ETH), not wei.
      const amountStr = String(amountEth ?? '').trim()
      if (!isPositiveDecimalString(amountStr)) return res.status(400).json({ error: 'amountEth must be a positive decimal amount, e.g. "0.1"' })
      try {
        const forks = await refreshSandboxForks(sailDir)
        const fork = forks[String(chainId)]
        if (!fork?.rpcUrl || fork.status !== 'ready') return res.status(400).json({ error: 'That chain has no ready fork to fund on.' })
        const result = await fundNative(fork.rpcUrl, address, amountStr)
        res.json({ ok: true, ...result })
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) })
      }
    })

    // Settings-modal "Fund USDC" — writes a token balance directly via the
    // balanceOf storage slot (no whale account needed) so a chosen SMA can be
    // funded with USDC on any sandbox fork that has a known USDC deployment.
    app.post('/api/sandbox/fund/usdc', async (req, res) => {
      const { chainId, safe, amount } = req.body ?? {}
      if (!Number.isInteger(chainId)) return res.status(400).json({ error: 'chainId must be an integer' })
      if (!isAddress(safe ?? '')) return res.status(400).json({ error: 'safe must be a valid 0x address' })
      // A whole-USDC amount (e.g. "100" = 100 USDC), validated as a string —
      // see the native-funding route above for why this isn't routed through Number.
      const amountStr = String(amount ?? '').trim()
      if (!isPositiveDecimalString(amountStr)) return res.status(400).json({ error: 'amount must be a positive decimal amount, e.g. "100"' })
      const token = usdcAddressFor(chainId)
      if (!token) return res.status(400).json({ error: `No known USDC deployment for chain ${chainId} in sandbox mode.` })
      try {
        const forks = await refreshSandboxForks(sailDir)
        const fork = forks[String(chainId)]
        if (!fork?.rpcUrl || fork.status !== 'ready') return res.status(400).json({ error: 'That chain has no ready fork to fund on.' })
        const result = await fundErc20(fork.rpcUrl, token, safe, amountStr)
        res.json({ ok: true, token, ...result })
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) })
      }
    })

    // Maps stopSandboxFork/restartSandboxFork's thrown-Error-message convention
    // to an HTTP status — both throw plain Errors (no custom error classes),
    // distinguished by message text, so the client can tell "unknown chain"
    // from "can't touch a process we don't own" from an actual failure.
    function sandboxForkErrorStatus(message) {
      if (/No sandbox fork tracked/.test(message)) return 404
      if (/adopted an already-running process/.test(message)) return 409
      return 500
    }

    app.post('/api/sandbox/forks/:chainId/stop', async (req, res) => {
      const chainId = Number(req.params.chainId)
      if (!Number.isInteger(chainId)) return res.status(400).json({ error: 'chainId must be an integer' })
      try {
        const fork = await stopSandboxFork(sailDir, chainId)
        res.json({ ok: true, fork })
      } catch (e) {
        const message = e?.message || String(e)
        res.status(sandboxForkErrorStatus(message)).json({ error: message })
      }
    })

    app.post('/api/sandbox/forks/:chainId/restart', async (req, res) => {
      const chainId = Number(req.params.chainId)
      if (!Number.isInteger(chainId)) return res.status(400).json({ error: 'chainId must be an integer' })
      // Turning a parked/stopped fork back on must respect the cap. Restarting a
      // fork that's already live (stop→start in place) doesn't add a slot, so
      // it's always allowed; only bringing a currently-not-live chain up counts
      // against the limit.
      try {
        const forks = await refreshSandboxForks(sailDir)
        const cap = resolveSandboxChainCap()
        const activeCount = Object.values(forks).filter((f) => f.status === 'ready').length
        const alreadyActive = forks[String(chainId)]?.status === 'ready'
        if (!alreadyActive && activeCount >= cap) {
          return res.status(409).json({ error: `Sandbox is at its ${cap}-chain limit — stop another fork or raise the limit in Sandbox settings before starting this one.` })
        }
      } catch { /* if the pre-check itself fails, fall through and let the restart attempt surface the real error */ }
      try {
        const fork = await restartSandboxFork(sailDir, chainId)
        res.json({ ok: true, fork })
      } catch (e) {
        const message = e?.message || String(e)
        res.status(sandboxForkErrorStatus(message)).json({ error: message })
      }
    })

    // "Exit to live dashboard" — ensure the live server for this same project is
    // running (starting it if not) and hand the browser its port to navigate to.
    app.post('/api/sandbox/exit', async (_req, res) => {
      try {
        const projectRoot = path.resolve(sailDir, '..', '..') // sailDir is <root>/.shipyard/sandbox
        const liveSailDir = path.join(projectRoot, '.sail')
        const runtimeFile = path.join(liveSailDir, 'runtime', 'ui.json')
        const result = await ensurePeerServerRunning({
          targetSailDir: liveSailDir,
          targetMode: 'live',
          runtimeFile,
          preferredPort: deterministicPort(projectRoot),
        })
        res.json(result)
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) })
      }
    })

    // ── Session persistence ──────────────────────────────────────────────
    // Resume: bring back any forks a previous sandbox session left tracked in
    // the manifest, each loading its dumped chain state — so `sailor sandbox
    // stop` + `sailor sandbox start` (or a reboot in between) lands the user
    // back in the same world: same deployed SMA, same signed mandates, same
    // funded balances. Best-effort and idempotent: forks already alive are
    // skipped, per-chain failures are logged, and a fresh (never-onboarded)
    // sandbox has an empty manifest so this is a no-op.
    resumeSandboxForks(sailDir, { maxChains: resolveSandboxChainCap() })
      .then(({ resumed, parked, failed }) => {
        if (resumed.length) console.log(`Sandbox forks resumed from previous session: ${resumed.join(', ')}`)
        if (parked.length) console.log(`Sandbox forks parked (over the ${resolveSandboxChainCap()}-chain limit — resumable from the UI): ${parked.join(', ')}`)
        for (const [chainId, message] of Object.entries(failed)) {
          console.warn(`⚠ Could not resume sandbox fork for chain ${chainId}: ${message}`)
        }
      })
      .catch((e) => console.warn(`⚠ Sandbox fork resume failed: ${e?.message || e}`))

    // Durability: `stopFork` only dumps chain state on a *graceful* stop, so
    // dump every live fork periodically too — a crash, reboot, or plain
    // `kill -9` then costs at most the last interval, not the whole session.
    // unref'd so an exiting server never waits on it.
    const dumpIntervalMs = Number(process.env.SAILOR_SANDBOX_DUMP_INTERVAL_MS) || 60_000
    const dumpTimer = setInterval(() => {
      dumpSandboxState(sailDir).catch(() => { /* best-effort; next tick retries */ })
    }, dumpIntervalMs)
    dumpTimer.unref()
  }

  // "Try it in a Sandbox" — only offered from the live dashboard. Ensures this
  // project's sandbox server is running (starting it if not) and hands the
  // browser its port to navigate to.
  if (mode === 'live') {
    app.post('/api/sandbox/launch', async (_req, res) => {
      try {
        const projectRoot = path.dirname(sailDir) // sailDir is <root>/.sail in live mode
        const sandboxDir = sandboxDirFor(projectRoot)
        const runtimeFile = path.join(sandboxDir, 'runtime', 'ui.json')
        const result = await ensurePeerServerRunning({
          targetSailDir: sandboxDir,
          targetMode: 'sandbox',
          runtimeFile,
          preferredPort: deterministicPort(`${projectRoot}:sandbox`),
        })
        res.json(result)
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) })
      }
    })
  }

  // Serve the built UI if available. SERVE_DIST=1 is the explicit flag set by
  // `sailor ui start`, but we also auto-detect: if index.html exists next to
  // this server file (or at SAILOR_UI_DIST), serve it without the flag so that
  // direct invocations (`node server.js`) don't silently 404 on the root.
  const distDir = process.env.SAILOR_UI_DIST ?? path.join(path.dirname(_thisFile), 'dist')
  const hasUiDist = fs.existsSync(path.join(distDir, 'index.html'))
  if (process.env.SERVE_DIST === '1' || hasUiDist) {
    // Client runtime config, injected into index.html at *serve* time. The npm
    // package ships a pre-built bundle, so any value the client reads through
    // `import.meta.env` is frozen at publish time and an operator can never set
    // it — WALLETCONNECT_PROJECT_ID has to arrive this way instead. Without it
    // the connect modal drops WalletConnect rather than showing a row that
    // cannot pair (see packages/ui/src/wagmi.js).
    const sendIndexHtml = (res) => {
      try {
        const env = parseEnvFile(at('.env.local'))
        const runtimeConfig = {
          walletConnectProjectId: String(
            process.env.WALLETCONNECT_PROJECT_ID ?? env.WALLETCONNECT_PROJECT_ID ?? '',
          ).trim(),
        }
        // Escaping `<` stops a value containing "</script>" closing the tag.
        const json = JSON.stringify(runtimeConfig).replace(/</g, '\\u003c')
        const html = fs
          .readFileSync(path.join(distDir, 'index.html'), 'utf-8')
          .replace('</head>', `  <script>window.__SAILOR_CONFIG__ = ${json}</script>\n  </head>`)
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.send(html)
      } catch (err) {
        serverError(res, err)
      }
    }

    // Must precede express.static, which would otherwise serve the raw,
    // un-injected index.html for `/` and `/index.html`.
    app.get(['/', '/index.html'], (_req, res) => sendIndexHtml(res))

    // Asset files are content-hashed → safe to cache. index.html is NOT hashed,
    // so it must revalidate every load; otherwise the browser keeps an old index
    // that points at stale asset hashes after an upgrade.
    app.use(express.static(distDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
      },
    }))
    app.get('*', (_req, res) => sendIndexHtml(res))
  }

  // Bind localhost by default so the key-management API isn't network-reachable.
  // Set SAILOR_HOST=0.0.0.0 to expose it (behind a domain / for LAN access) — do
  // that only with auth in front, since these endpoints are unauthenticated.
  const bindHost = process.env.SAILOR_HOST ?? '127.0.0.1'
  const httpServer = app.listen(port, bindHost, () => {
    console.log(`Sailor UI running at http://localhost:${port} (reading ${sailDir})`)
  })

  // Crash-durable session persistence (sandbox mode only). `stopFork` dumps each
  // fork's chain state only on a *graceful* stop, so an ungraceful death — an
  // anvil panic (flaky fork upstream), a `kill -9`, a host reboot — would lose
  // every mandate/deploy/balance created since the session came up. This server
  // is the one long-lived process that owns the (detached) forks, so it drives a
  // periodic `dumpSandboxState` for its whole lifetime. Cleared on shutdown; the
  // graceful `sailor sandbox stop` path dumps separately.
  if (mode === 'sandbox') {
    const stopPeriodicDump = startPeriodicStateDump(sailDir, {
      onError: (err) => console.warn(`sandbox periodic state dump failed (will retry): ${err?.message || err}`),
    })
    const stopDump = () => { try { stopPeriodicDump() } catch { /* already stopped */ } }
    httpServer.on('close', stopDump)
    // Attaching a SIGTERM/SIGINT listener suppresses Node's default
    // terminate-on-signal, so these handlers must exit the process themselves —
    // otherwise `sailor sandbox stop` (which SIGTERMs this pid) and Ctrl+C would
    // leave the server bound to its port with the forks still live. We force
    // `process.exit` rather than waiting on `httpServer.close()` to drain: a
    // connected dashboard/signer holds a WebSocket open, and `close()` blocks
    // until every such connection ends — which would hang `sailor sandbox stop`
    // for as long as a browser tab is open. Flush one last state dump first
    // (this is the graceful path, so nothing since the last tick is lost), but
    // bound it so a wedged RPC can never block the exit.
    let shuttingDown = false
    const shutdown = async () => {
      if (shuttingDown) return
      shuttingDown = true
      stopDump()
      const flush = dumpSandboxState(sailDir).catch(() => {})
      await Promise.race([flush, new Promise((r) => setTimeout(r, 3000))])
      process.exit(0)
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  }

  // ── Signing-server WebSocket proxy ────────────────────────────────────────
  // The signing page (#/signer, `#/station` kept as a v1.2.0-compatible alias)
  // needs a live WebSocket to the daemon
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
// The CLI's `sailor ui` command spawns this with SAIL_DIR set; its sandbox
// spawn logic additionally sets SAILOR_UI_MODE=sandbox to enable the
// /api/sandbox/* routes for that instance only.
// Use case-insensitive comparison on Windows: path.resolve() and __filename
// can disagree on drive-letter case (c:\ vs C:\), breaking a strict === check.
const _norm = p => path.resolve(p)[process.platform === 'win32' ? 'toLowerCase' : 'toString']()
const isMain = Boolean(process.argv[1]) && _norm(process.argv[1]) === _norm(_thisFile)
if (isMain) {
  const sailDir = process.env.SAIL_DIR || path.join(process.cwd(), '.sail')
  const mode = process.env.SAILOR_UI_MODE === 'sandbox' ? 'sandbox' : 'live'
  startServer(sailDir, { mode })
}
