/**
 * Sail Intelligence — https://api.sail.money
 *
 * Risk and yield intelligence provider for the Sail Protocol.
 * Exposes Sonar (risk detection), the Yield Engine (opportunity discovery
 * and allocation), and the Vault Source registry.
 *
 * Agents use this as the default data source when evaluating positions,
 * screening vaults, and requesting rebalancing plans.
 */

export const SAIL_INTELLIGENCE_BASE_URL = 'https://api.sail.money'
export const SAIL_INTELLIGENCE_DOCS_URL = 'https://api.sail.money/docs'

// ── Types ─────────────────────────────────────────────────────────────────────

export type RiskTier = 'blocked' | 'caution' | 'clear'

export interface VaultScreenResult {
  address: string
  chain: string
  token: string
  tier: RiskTier
  disabled: boolean
  flags: string[]
}

export interface AllocationItem {
  vault: string
  chain: string
  token: string
  weight: number
  valueUsd: number
  expectedApy: number
}

export interface AllocationResult {
  items: AllocationItem[]
  totalApy: number
  generatedAt: string
}

export interface OpportunityItem {
  vault: string
  chain: string
  token: string
  apy: number
  tvlUsd: number
  riskTier: RiskTier
}

export interface RebalancePlan {
  exit: AllocationItem[]
  keep: AllocationItem[]
  enter: AllocationItem[]
  generatedAt: string
}

export interface SailIntelligenceOptions {
  /** API key — passed as `X-API-Key` header. */
  apiKey: string
  /** Override the base URL (for testing / staging). Defaults to `https://api.sail.money`. */
  baseUrl?: string
}

// ── Client ────────────────────────────────────────────────────────────────────

export class SailIntelligence {
  private readonly base: string
  private readonly headers: Record<string, string>

  constructor(opts: SailIntelligenceOptions) {
    this.base = opts.baseUrl ?? SAIL_INTELLIGENCE_BASE_URL
    this.headers = {
      'Content-Type': 'application/json',
      'X-API-Key': opts.apiKey,
    }
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.base}${path}`)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    const res = await fetch(url.toString(), { headers: this.headers })
    if (!res.ok) throw new Error(`Sail Intelligence ${path} → ${res.status}`)
    return res.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Sail Intelligence ${path} → ${res.status}`)
    return res.json() as Promise<T>
  }

  /** Global risk snapshot — disabled vaults, depegged tokens, current risk scores. */
  riskSummary() {
    return this.get<{ disabledVaults: string[]; depeggedTokens: string[]; updatedAt: string }>(
      '/v1/risks/summary',
    )
  }

  /**
   * Screen up to 200 vault addresses for risk tier (blocked / caution / clear).
   * Use before any trade to confirm the target vault is Sonar-clean.
   */
  screenVaults(addresses: string[]): Promise<VaultScreenResult[]> {
    return this.post('/v1/sonar/screen', { addresses })
  }

  /**
   * Pre-trade validation for a single position.
   * Returns whether the trade is safe to execute right now.
   */
  validateTrade(vault: string, valueUsd: number, token: string): Promise<{ safe: boolean; reason?: string }> {
    return this.post('/v1/sonar/validate', { vault, valueUsd, token })
  }

  /** Top Sonar-filtered yield opportunities, sorted by APY. */
  opportunities(opts?: { chain?: string; token?: string; limit?: number }): Promise<OpportunityItem[]> {
    const params: Record<string, string> = {}
    if (opts?.chain) params.chain = opts.chain
    if (opts?.token) params.token = opts.token
    if (opts?.limit) params.limit = String(opts.limit)
    return this.get('/v1/engine/opportunities', params)
  }

  /**
   * Recommend an allocation across top-APY Sonar-clean sources.
   * Pass `valueUsd` and optionally constrain by chain or token.
   */
  allocate(opts: { valueUsd: number; chain?: string; token?: string }): Promise<AllocationResult> {
    return this.post('/v1/engine/allocate', opts)
  }

  /**
   * Compute a rebalancing plan — which positions to exit, keep, and enter.
   * Pass current holdings as `{ vault, valueUsd }[]`.
   */
  rebalance(
    current: { vault: string; valueUsd: number }[],
    opts?: { chain?: string; token?: string },
  ): Promise<RebalancePlan> {
    return this.post('/v1/engine/rebalance', { current, ...opts })
  }

  /**
   * Check up to 500 institutional positions for active risk flags.
   * Returns positions that need action (exit or caution).
   */
  checkPortfolio(
    positions: { vault: string; valueUsd: number }[],
  ): Promise<{ flagged: (typeof positions[number] & { flags: string[]; tier: RiskTier })[] }> {
    return this.post('/v1/portfolio/check', { positions })
  }

  /** Detailed risk intelligence for a single vault. */
  vaultRisk(vaultAddress: string): Promise<VaultScreenResult & { collateralTree: unknown; riskScore: number }> {
    return this.get(`/v1/vault/${vaultAddress}`)
  }
}
