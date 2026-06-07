/**
 * Sailor data seam — the single boundary between the dashboard UI and the
 * Sailor framework's local `/api` server (packages/ui/server.js).
 *
 * ── How this works ─────────────────────────────────────────────────────────
 * TODAY (mockup): every function returns mock data shaped EXACTLY like the
 * live `/api` response, so surfaces are design-complete and demoable with no
 * backend. The mocks live in this file.
 *
 * LATER (live): flip `USE_LIVE = true`. Each function then hits its real
 * same-origin `/api/*` endpoint via `api()`. The shapes already match, so the
 * swap is mechanical — nothing downstream changes. You can also flip a single
 * function to live by editing just that function (e.g. for incremental wiring).
 *
 * Every export documents the exact endpoint + method it maps to. Response
 * shapes are verified against:
 *   - Sailor/packages/ui/server.js              (the REST contract)
 *   - Sailor/packages/sdk/src/signing.ts        (the signing protocol types)
 *
 * UI copy uses Owner / Mandate signer / Agent wallet; the API uses
 * owner / permissionSigner / manager. Map at the edges, never leak code terms.
 */

// Flip to true once this dashboard is served by the Sailor `/api` server
// (same origin). Until then, all calls resolve from the mock fixtures below.
export const USE_LIVE = false

/* Generic same-origin JSON helper (used only when USE_LIVE). */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} /api${path} → ${res.status}`)
  return res.json()
}

/* Small latency so mock flows feel real (spinners, disabled states fire). */
const settle = (value, ms = 420) =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

/* ════════════════════════════════════════════════════════════════════════
   MOCK STATE — mutable in-memory store so save/generate flows persist within
   a session. Mirrors what the server reads from `.sail/`.
   ════════════════════════════════════════════════════════════════════════ */

const SMA_ADDRESS = '0x4e2a91b3F7c5dA8bC09f1E2d3B4a5C6d7E8f9c8b'
const OWNER_ADDRESS = '0x6f2A8b3f9C4d5E1A7B0c2D3E4F5A6B7C8D9E0F12'
const MANAGER_ADDRESS = '0xc0Fe18a32bD8e0F9c1A2d3B4c5E6f7891f283574'

const mock = {
  // GET /api/onboard/state shape (server.js ~802)
  onboardState: {
    hasAccount: true,
    hasManagerKey: true,
    managerAddress: MANAGER_ADDRESS,
    hasRpc: true,
    rpcUrl: 'https://arb-mainnet.g.alchemy.com/v2/demo-key-•••••',
    hasSailApiKey: false,
    chainId: 42161,
    projectName: 'defi-conservative',
    kernel: '0x5A11A1bC0dE0kErNeL0000000000000000000001',
    safeModuleEnabler: '0x5A11M0dULeEnAbLeR000000000000000000000002',
    proxyFactory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
    singleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
    standardFeePolicy: '0x5A11FeEP0LiCY00000000000000000000000003',
  },

  // GET /api/overview shape (server.js ~1148 computeOverview)
  overview: {
    generatedAt: new Date('2026-06-07T04:00:00Z').toISOString(),
    chainId: 42161,
    network: 'Arbitrum',
    kernel: '0x5A11A1bC0dE0kErNeL0000000000000000000001',
    rpcConfigured: true,
    onchain: true,
    sma: {
      address: SMA_ADDRESS,
      owner: OWNER_ADDRESS,
      manager: MANAGER_ADDRESS,
      permissionSigner: OWNER_ADDRESS,
      network: 'Arbitrum',
      registered: true,
      sessionActive: true,
      balanceWei: '17000000000000000',
      balanceEth: '0.017',
      balanceStatus: 'funded', // 'funded' | 'low' | 'empty'
    },
    mandates: [
      { address: '0x8B4D9e0F1A2c3B5d7E8f0123456789ABcDeF0042', name: 'Yield mandate', template: 'sail.permission.morpho.v1', network: 'Arbitrum' },
    ],
    // signerEntry shape: { role, address, balanceWei, balanceEth, status }
    // role: 'manager' | 'owner'; status: 'funded' | 'low' | 'empty' | 'local' | 'unconfigured'
    signers: [
      { role: 'manager', address: MANAGER_ADDRESS, balanceWei: '1500000000000000', balanceEth: '0.0015', status: 'low' },
      { role: 'owner',   address: OWNER_ADDRESS,   balanceWei: '12340000000000000', balanceEth: '0.01234', status: 'funded' },
    ],
  },

  // GET /api/station/pending → SigningRequest[]  (@sail/sdk/signing.ts)
  // Each is SigningRequestBase + (type:'transaction'|'typed-data').
  pending: [
    {
      id: 'req-9d4a',
      kind: 'register-permission',
      title: 'Authorize a new yield permission',
      description:
        'Adds a Morpho Blue deposit permission to the DeFi conservative mandate. Your agent may deposit idle USDC into whitelisted Morpho vaults, capped per trade — nothing else.',
      chainId: 42161,
      createdAt: Date.parse('2026-06-07T03:58:00Z'),
      type: 'typed-data',
      details: [
        { label: 'Permission', value: 'Deposit into Morpho Blue vaults' },
        { label: 'Per-trade cap', value: '$500' },
        { label: 'Assets', value: 'USDC' },
        { label: 'Mandate signer', value: '0x6f2A…0F12' },
      ],
      typedData: {
        domain: { name: 'SailKernel', version: '1', chainId: 42161, verifyingContract: '0x5A11A1bC0dE0kErNeL0000000000000000000001' },
        types: {
          RegisterPermission: [
            { name: 'account', type: 'address' },
            { name: 'permission', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'RegisterPermission',
        message: {
          account: SMA_ADDRESS,
          permission: '0x9b4c8e1a3f76de28aB00000000000000000000A1',
          nonce: '3',
          deadline: '1780000000',
        },
      },
    },
    {
      id: 'req-7c1b',
      kind: 'deploy-mandate',
      title: 'Deploy the BTC hedge mandate',
      description:
        'Deploys a new permission contract that lets the BTC hedge agent open and close perp positions on GMX within a fixed notional cap. Contract-creation transaction — review the bytecode before signing.',
      chainId: 42161,
      createdAt: Date.parse('2026-06-07T03:40:00Z'),
      type: 'transaction',
      details: [
        { label: 'Action', value: 'Deploys a new mandate contract' },
        { label: 'Venue', value: 'GMX (perps)' },
        { label: 'Notional cap', value: '$2,000' },
      ],
      // contract-creation tx → no `to`; `data` is the creation bytecode
      value: '0',
      data: '0x60806040523480156100105760...e1ef286beef',
    },
  ],

  // GET /api/mandate-draft → { account, chainId, items[] } | null (server.js ~576)
  mandateDraft: null,
}

/* ════════════════════════════════════════════════════════════════════════
   ONBOARDING / CONFIG
   ════════════════════════════════════════════════════════════════════════ */

/** GET /api/onboard/state — what's already configured. */
export async function getOnboardState() {
  if (USE_LIVE) return api('/onboard/state')
  return settle({ ...mock.onboardState })
}

/** POST /api/onboard/save-config { rpcUrl, sailApiKey, chainId } → { ok } */
export async function saveConfig({ rpcUrl, sailApiKey, chainId } = {}) {
  if (USE_LIVE) return api('/onboard/save-config', { method: 'POST', body: { rpcUrl, sailApiKey, chainId } })
  if (rpcUrl != null) { mock.onboardState.rpcUrl = rpcUrl; mock.onboardState.hasRpc = Boolean(rpcUrl) }
  if (sailApiKey != null) mock.onboardState.hasSailApiKey = Boolean(sailApiKey)
  if (chainId != null) { mock.onboardState.chainId = chainId; mock.overview.chainId = chainId }
  return settle({ ok: true })
}

/** POST /api/onboard/generate-key { passphrase } → { address, existed } */
export async function generateKey({ passphrase } = {}) {
  if (USE_LIVE) return api('/onboard/generate-key', { method: 'POST', body: { passphrase } })
  if (mock.onboardState.hasManagerKey) {
    return settle({ address: mock.onboardState.managerAddress, existed: true })
  }
  // Deterministic mock address so the flow shows a stable result.
  mock.onboardState.hasManagerKey = true
  mock.onboardState.managerAddress = MANAGER_ADDRESS
  return settle({ address: MANAGER_ADDRESS, existed: false }, 900)
}

/* ════════════════════════════════════════════════════════════════════════
   MONITORING
   ════════════════════════════════════════════════════════════════════════ */

/** GET /api/overview — consolidated on-chain view (SMA + signers + mandates). */
export async function getOverview() {
  if (USE_LIVE) return api('/overview')
  return settle({ ...mock.overview })
}

/* ════════════════════════════════════════════════════════════════════════
   SIGNING (daemon bridge)
   ════════════════════════════════════════════════════════════════════════ */

/** GET /api/station/pending → SigningRequest[] (poll ~3s). */
export async function getPending() {
  if (USE_LIVE) return api('/station/pending')
  return settle(mock.pending.map((r) => ({ ...r })), 200)
}

/** GET /api/mandate-draft → { account, chainId, items[] } | null. */
export async function getMandateDraft() {
  if (USE_LIVE) return api('/mandate-draft')
  return settle(mock.mandateDraft)
}

/** POST /api/mandate-submit { signature, signedAt } → mandate. */
export async function submitMandate({ signature, signedAt } = {}) {
  if (USE_LIVE) return api('/mandate-submit', { method: 'POST', body: { signature, signedAt } })
  return settle({ ok: true, signedAt: signedAt ?? new Date().toISOString() })
}

/* Test-only: lets the mockup resolve a pending request (remove it from the
   queue) so Authorize/Reject visibly clears the banner. No live equivalent —
   the daemon emits `request-resolved` over the socket instead. */
export function _mockResolvePending(id) {
  const i = mock.pending.findIndex((r) => r.id === id)
  if (i >= 0) mock.pending.splice(i, 1)
}
