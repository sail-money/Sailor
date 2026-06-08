/**
 * Sailor data seam — single boundary between the dashboard UI and the
 * Sailor framework's local `/api` server (packages/ui/server.js).
 *
 * Every export maps to one endpoint. Response shapes are verified against:
 *   - Sailor/packages/ui/server.js          (the REST contract)
 *   - Sailor/packages/sdk/src/signing.ts    (the signing protocol types)
 *
 * UI copy uses Owner / Mandate signer / Agent wallet; the API uses
 * owner / permissionSigner / manager. Map at the edges, never leak code terms.
 */

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} /api${path} → ${res.status}`)
  return res.json()
}

/* ════════════════════════════════════════════════════════════════════════
   ONBOARDING / CONFIG
   ════════════════════════════════════════════════════════════════════════ */

/** GET /api/onboard/state — what's already configured. */
export async function getOnboardState() {
  return api('/onboard/state')
}

/** POST /api/onboard/save-config { rpcUrl, sailApiKey, chainId } → { ok } */
export async function saveConfig({ rpcUrl, sailApiKey, chainId } = {}) {
  return api('/onboard/save-config', { method: 'POST', body: { rpcUrl, sailApiKey, chainId } })
}

/** POST /api/onboard/generate-key { passphrase } → { address, existed } */
export async function generateKey({ passphrase } = {}) {
  return api('/onboard/generate-key', { method: 'POST', body: { passphrase } })
}

/**
 * POST /api/onboard/build-create-tx { owner, manager, chainId, saltNonce }
 *   → { to, data, chainId, saltNonce }
 */
export async function buildCreateTx({ owner, manager, chainId, saltNonce } = {}) {
  return api('/onboard/build-create-tx', { method: 'POST', body: { owner, manager, chainId, saltNonce } })
}

/**
 * POST /api/onboard/build-register-path { owner, manager, chainId, saltNonce }
 *   → { deployTx: { to, data }, kernel }
 */
export async function buildRegisterPath({ owner, manager, chainId, saltNonce } = {}) {
  return api('/onboard/build-register-path', { method: 'POST', body: { owner, manager, chainId, saltNonce } })
}

/**
 * POST /api/onboard/complete { safe, owner, manager, txHash, chainId } → { ok }
 */
export async function onboardComplete({ safe, owner, manager, txHash, chainId } = {}) {
  return api('/onboard/complete', { method: 'POST', body: { safe, owner, manager, txHash, chainId } })
}

/* ════════════════════════════════════════════════════════════════════════
   MONITORING
   ════════════════════════════════════════════════════════════════════════ */

/** GET /api/overview — consolidated on-chain view (SMA + signers + mandates). */
export async function getOverview({ fresh } = {}) {
  return api(fresh ? '/overview?fresh=1' : '/overview')
}

/** POST /api/account/rename { safe, name } → { ok } */
export async function renameAccount({ safe, name } = {}) {
  return api('/account/rename', { method: 'POST', body: { safe, name } })
}

/* ──────────────────────────────────────────────────────────────────────────
   MANAGER-KEY ROTATION
   ────────────────────────────────────────────────────────────────────────── */

/** GET /api/account/rotation-preview → { safe, chainId, owner, permissionSigner, currentManager, permissions[] } */
export async function getRotationPreview() {
  return api('/account/rotation-preview')
}

/** POST /api/account/build-set-manager { newManager } → { to, data, chainId, oldManager, permissions[] } */
export async function buildSetManager({ newManager } = {}) {
  return api('/account/build-set-manager', { method: 'POST', body: { newManager } })
}

/** POST /api/account/rotate-generate-key { passphrase? } → { address } */
export async function rotateGenerateKey({ passphrase } = {}) {
  return api('/account/rotate-generate-key', { method: 'POST', body: { passphrase } })
}

/** POST /api/account/build-reattach { permissions[] } → { typedData, deadline } */
export async function buildReattach({ permissions } = {}) {
  return api('/account/build-reattach', { method: 'POST', body: { permissions } })
}

/** POST /api/account/build-reattach-tx { permissions[], deadline, signature } → { to, data, value, chainId } */
export async function buildReattachTx({ permissions, deadline, signature } = {}) {
  return api('/account/build-reattach-tx', { method: 'POST', body: { permissions, deadline, signature } })
}

/** POST /api/account/build-revoke { permissions[] } → { typedData, deadline } */
export async function buildRevoke({ permissions } = {}) {
  return api('/account/build-revoke', { method: 'POST', body: { permissions } })
}

/** POST /api/account/build-revoke-tx { permissions[], deadline, signature } → { to, data, chainId } */
export async function buildRevokeTx({ permissions, deadline, signature } = {}) {
  return api('/account/build-revoke-tx', { method: 'POST', body: { permissions, deadline, signature } })
}

/** POST /api/account/revoke-complete { permissions[], txHash } → { ok, revoked } */
export async function revokeComplete({ permissions, txHash } = {}) {
  return api('/account/revoke-complete', { method: 'POST', body: { permissions, txHash } })
}

/** GET /api/mandate-templates → { templates: [{ name, inputs: [{name,type}] }] } */
export async function getMandateTemplates() {
  return api('/mandate-templates')
}

/** POST /api/account/build-deploy-mandate { template, args[] } → { data, chainId, name } */
export async function buildDeployMandate({ template, args } = {}) {
  return api('/account/build-deploy-mandate', { method: 'POST', body: { template, args } })
}

/** POST /api/account/mandate-complete { name, address, template?, constructorArgs?, deployTxHash, registerTxHash } → { ok, address } */
export async function mandateComplete({ name, address, template, constructorArgs, deployTxHash, registerTxHash } = {}) {
  return api('/account/mandate-complete', {
    method: 'POST',
    body: { name, address, template, constructorArgs, deployTxHash, registerTxHash },
  })
}

/** POST /api/account/rotate-complete { newManager, txHash, reattachTxHash?, permissions? } → { ok, manager } */
export async function rotateComplete({ newManager, txHash, reattachTxHash, permissions } = {}) {
  return api('/account/rotate-complete', {
    method: 'POST',
    body: { newManager, txHash, reattachTxHash, permissions },
  })
}

/** GET /api/account — the active SMA record (account.json). Throws on 404 (no SMA yet). */
export async function getAccount() {
  return api('/account')
}

/** GET /api/accounts — every known SMA, each annotated `active`. */
export async function getAccounts() {
  return api('/accounts')
}

/** POST /api/account/switch { safe } — make a known SMA the active one. */
export async function switchAccount({ safe } = {}) {
  return api('/account/switch', { method: 'POST', body: { safe } })
}

/** GET /api/activity — append-only event log (newest last). */
export async function getActivity() {
  return api('/activity')
}

/** GET /api/agent-status — is the agent running, and from where. */
export async function getAgentStatus() {
  return api('/agent-status')
}

/** POST /api/agent-status { action: 'stop' } — SIGTERM a locally-running agent. */
export async function stopAgent() {
  return api('/agent-status', { method: 'POST', body: { action: 'stop' } })
}

/* ════════════════════════════════════════════════════════════════════════
   SIGNING (daemon bridge)
   ════════════════════════════════════════════════════════════════════════ */

/** GET /api/station/pending → SigningRequest[] */
export async function getPending() {
  return api('/station/pending')
}

/** GET /api/mandate-draft → { account, chainId, items[] } | null */
export async function getMandateDraft() {
  return api('/mandate-draft')
}

/** POST /api/mandate-submit { signature, signedAt } → mandate */
export async function submitMandate({ signature, signedAt } = {}) {
  return api('/mandate-submit', { method: 'POST', body: { signature, signedAt } })
}
