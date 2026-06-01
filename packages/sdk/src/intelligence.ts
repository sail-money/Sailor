/**
 * Sail Intelligence — https://api.sail.money
 *
 * AUTO-GENERATED from the OpenAPI spec at build time.
 * Do not edit manually — run `pnpm build` to regenerate.
 *
 * Spec version : 1.0.0
 * Generated at : 2026-06-01T08:30:11.022Z
 */

export const SAIL_INTELLIGENCE_BASE_URL = "https://api.sail.money";
export const SAIL_INTELLIGENCE_DOCS_URL = "https://api.sail.money/docs";

// ── Types (generated from spec schemas) ───────────────────────────────────────

export interface AffectedPosition {
  vault_address: string;
  chain: string | null;
  token: string | null;
  issues: PositionIssue[];
}

export interface AllocationItem {
  /** Vault contract address receiving allocation. */
  vault_address: string;
  /** Chain where the selected vault is deployed. */
  chain: string;
  /** Primary deposit token symbol for the selected vault. */
  token: string;
  /** Underlying protocol or venue name when available. */
  protocol?: string | null;
  /** Recommended portfolio weight for the vault. */
  weight: number;
  /** Recommended USD notional allocated to the vault. */
  value_usd: number;
  /** Expected APY contribution from the selected vault. */
  expected_apy: number;
}

export interface AllocationRequest {
  /** Total portfolio value in USD. */
  portfolio_value_usd: number;
  /** Market: 'usd' or 'eur'. */
  market?: string;
  /** Restrict to these chains. Omit for all chains. */
  allowed_chains?: string[] | null;
  /** Maximum number of vault positions. */
  max_positions?: number;
  /** Apply Sonar risk filtering. When False, pure yield logic — all market vaults included regardless of risk flags. */
  sonar_enabled?: boolean;
}

export interface AllocationResponse {
  /** Requested market segment. */
  market: string;
  /** Total USD portfolio value used for the allocation run. */
  total_value_usd: number;
  /** Recommended institutional allocation across selected vaults. */
  allocations: AllocationItem[];
  /** Expected blended APY for the proposed allocation. */
  expected_portfolio_apy: number;
  /** Whether Sonar filtering was applied during allocation. */
  sonar_enabled: boolean;
  /** UTC timestamp of the latest Sonar pipeline run. */
  last_pipeline_run: string | null;
  /** UTC timestamp when the allocation was produced. */
  checked_at: string;
}

export interface BenchmarkResponse {
  market: string;
  chain?: string | null;
  vault_count: number;
  best_apy: number;
  worst_apy: number;
  median_apy: number;
  mean_apy: number;
  best_vault?: string | null;
  sonar_enabled: boolean;
  last_pipeline_run: string | null;
  checked_at: string;
}

export interface CollateralTree {
  /** Vault deposit token used as the root of the collateral dependency tree. */
  deposit_token: string;
  /** Terminal underlying assets reached by the collateral expansion. */
  primitive_leaves: string[];
  /** Expanded collateral structure used by Sonar dependency analysis. */
  collateral_tokens: Record<string, unknown>[];
  /** UTC timestamp when the collateral tree was last built. */
  last_built: string;
}

export interface ComparePosition {
  vault_address: string;
  value_usd: number;
}

export interface CompareRequest {
  /** Current portfolio positions. */
  current: ComparePosition[];
  /** Proposed portfolio positions. */
  proposed: ComparePosition[];
  /** Market: 'usd' or 'eur'. */
  market?: string;
}

export interface CompareResponse {
  /** Estimated APY of the current portfolio. */
  current_portfolio_apy: number;
  /** Estimated APY of the proposed portfolio. */
  proposed_portfolio_apy: number;
  /** APY delta between proposed and current portfolios. */
  apy_change: number;
  /** Number of Sonar risk flags in the current portfolio. */
  current_risk_flags: number;
  /** Number of Sonar risk flags in the proposed portfolio. */
  proposed_risk_flags: number;
  /** Net change in Sonar risk flags between portfolios. */
  risk_change: number;
  /** Vault addresses exited by the proposed portfolio. */
  positions_exited: string[];
  /** Vault addresses entered by the proposed portfolio. */
  positions_entered: string[];
  /** Overall assessment: improvement, degradation, or neutral. */
  assessment: string;
  /** UTC timestamp of the latest Sonar pipeline run. */
  last_pipeline_run: string | null;
  /** UTC timestamp when the comparison was produced. */
  checked_at: string;
}

export interface DepeggedTokens {
  /** Total number of currently flagged depegged tokens. */
  count: number;
  /** Depegged tokens grouped by chain. */
  by_chain: Record<string, string[]>;
}

export interface DetectorClearance {
  /** Sonar detector name used in the audit trail. */
  detector: string;
  /** Detector outcome for the vault: clear or flagged. */
  status: string;
  /** Optional detector-specific explanation. */
  detail?: string | null;
}

export interface DisableSource {
  /** Underlying Sonar detector or disable source that flagged the vault. */
  source: string;
  /** Internal Sonar severity tier for this disable source. */
  tier: number;
  /** UTC timestamp when the disable source became active. */
  disabled_at: string;
}

export interface DisabledVaults {
  /** Total number of currently disabled vaults. */
  count: number;
  /** All currently disabled vault addresses. */
  addresses: string[];
  /** Disabled vault addresses grouped by Sonar source. */
  by_source: Record<string, string[]>;
}

export interface ExplainRequest {
  /** Market: 'usd' or 'eur'. */
  market?: string;
  portfolio_value_usd: number;
  max_positions?: number;
  /** Restrict to a single chain. */
  chain?: string | null;
}

export interface ExplainResponse {
  allocation: AllocationItem[];
  reasoning: VaultReasoning[];
  universe_size: number;
  filtered_count: number;
  expected_portfolio_apy: number;
  last_pipeline_run: string | null;
  checked_at: string;
}

export interface InstitutionalRequest {
  /** Current portfolio keyed by chain_id. Use '0x0000' as vault address for idle wallet cash. Values may be USD amounts (any > 2.0) or fractions (all ≤ 1.0). Example: {'1': {'0x0000': 50000, '0x9Fb7...': 30000}} */
  portfolio_input: Record<string, Record<string, number>>;
  /** Total portfolio value in USD. Required when portfolio_input values are fractions; auto-summed when values are USD amounts. */
  total_balance?: number | null;
  /** Market: 'usd' or 'eur'. */
  client_market?: string;
  /** Optional vault allowlist override. Accepts ['0x...'] addresses. */
  client_sources?: string[] | null;
  /** Executions per day. */
  daily_executions?: number;
  /** Max vault positions. */
  max_positions?: number;
  /** Allow same-chain token swaps. */
  allow_swaps?: boolean;
  /** Allow cross-chain bridges. */
  allow_bridges?: boolean;
  /** Lock current chain distribution. */
  lock_chain_allocations?: boolean;
  /** Required gain above break-even as a fraction, e.g. 0.05 = 5%. */
  min_profit_margin?: number;
  /** Max fraction of pool TVL per position, e.g. 0.01 = 1%. */
  tvl_concentration_max?: number;
}

export interface InstitutionalResponse {
  /** Recommended weights keyed by chain_id string, then vault address. */
  address_weights_by_chain: Record<string, Record<string, number>>;
  /** Requested client market segment. */
  market: string;
  /** Total USD portfolio value used for optimization. */
  total_value_usd: number;
  /** Expected blended APY for the optimized institutional portfolio. */
  expected_portfolio_apy: number;
  /** UTC timestamp of the latest Sonar pipeline run. */
  last_pipeline_run: string | null;
  /** UTC timestamp when the optimization response was produced. */
  checked_at: string;
}

export interface OpportunitiesResponse {
  /** Requested market segment, for example usd or eur. */
  market: string;
  /** Optional chain filter applied to the result set. */
  chain: string | null;
  /** Number of opportunities returned. */
  count: number;
  /** Ranked institutional yield opportunities. */
  opportunities: YieldOpportunity[];
  /** Whether Sonar filtering was applied to the result set. */
  sonar_enabled: boolean;
  /** UTC timestamp when the response was generated. */
  checked_at: string;
}

export interface PortfolioCheckResponse {
  summary: PortfolioSummary;
  safe: string[];
  affected: AffectedPosition[];
  checked_at: string;
}

export interface PortfolioSummary {
  total: number;
  safe: number;
  affected: number;
}

export interface PositionIssue {
  /** Issue type, for example vault_disabled or token_depegged. */
  type: string;
  /** Originating Sonar source or detector for this issue. */
  source: string;
  /** Internal Sonar severity tier for the issue. */
  tier: number;
  /** Human-readable severity label, for example CRITICAL or WARN. */
  severity: string;
  /** UTC timestamp when the issue became active. */
  disabled_at: string;
  /** Optional additional context for the issue. */
  detail?: string | null;
}

/** CompareResponse without risk-delta fields — used by Engine Raw tier. */
export interface RawCompareResponse {
  /** Estimated APY of the current portfolio. */
  current_portfolio_apy: number;
  /** Estimated APY of the proposed portfolio. */
  proposed_portfolio_apy: number;
  /** APY delta between proposed and current portfolios. */
  apy_change: number;
  /** Vault addresses exited by the proposed portfolio. */
  positions_exited: string[];
  /** Vault addresses entered by the proposed portfolio. */
  positions_entered: string[];
  /** Overall APY assessment: improvement, degradation, or neutral. */
  assessment: string;
  /** UTC timestamp of the latest pipeline run used for the comparison. */
  last_pipeline_run: string | null;
  /** UTC timestamp when the comparison was produced. */
  checked_at: string;
}

export interface RawOpportunitiesResponse {
  market: string;
  chain: string | null;
  count: number;
  opportunities: RawYieldOpportunity[];
  checked_at: string;
}

/** YieldOpportunity without risk_flagged — used by Engine Raw tier. */
export interface RawYieldOpportunity {
  /** Vault contract address. */
  vault_address: string;
  /** Chain where the opportunity is deployed. */
  chain: string;
  /** Primary deposit token symbol. */
  token: string;
  /** Underlying protocol or venue name when available. */
  protocol?: string | null;
  /** Current total APY used for ranking. */
  apy: number;
  /** Base APY component. */
  apy_base?: number | null;
  /** Reward-token APY component. */
  apy_reward?: number | null;
  /** Current total value locked in USD when available. */
  tvl_usd?: number | null;
  /** UTC timestamp of the latest APY refresh. */
  last_updated?: string | null;
}

export interface RebalanceMove {
  /** Vault contract address affected by the rebalance plan. */
  vault_address: string;
  /** Chain where the vault is deployed. */
  chain?: string | null;
  /** Primary deposit token symbol. */
  token?: string | null;
  /** Recommended action: exit, enter, or keep. */
  action: string;
  /** Primary reason for the rebalance action. */
  reason: string;
  /** Current APY of the position when applicable. */
  current_apy?: number | null;
  /** Target APY after the rebalance action when applicable. */
  target_apy?: number | null;
  /** USD notional associated with the move. */
  value_usd: number;
}

export interface RebalancePosition {
  /** Vault contract address in the current portfolio. */
  vault_address: string;
  /** Current USD notional held in the vault. */
  value_usd: number;
}

export interface RebalanceRequest {
  /** Current portfolio positions. */
  positions: RebalancePosition[];
  /** Market: 'usd' or 'eur'. */
  market?: string;
  max_positions?: number;
  /** Apply Sonar risk filtering. When False, pure yield logic — all market vaults included regardless of risk flags. */
  sonar_enabled?: boolean;
}

export interface RebalanceResponse {
  moves: RebalanceMove[];
  current_portfolio_apy: number;
  optimal_portfolio_apy: number;
  apy_improvement: number;
  last_pipeline_run: string | null;
  checked_at: string;
}

export interface RiskScore {
  /** Aggregated Sonar severity for the vault. */
  severity: string;
  /** List of Sonar detectors contributing to the score. */
  detectors: string[];
  /** UTC timestamp of the risk score snapshot. */
  ts: string;
}

export interface RisksSummaryResponse {
  disabled_vaults: DisabledVaults;
  depegged_tokens: DepeggedTokens;
  vault_risk_scores: Record<string, unknown>;
  last_pipeline_run: string | null;
  checked_at: string;
}

export interface SafeCheckResponse {
  safe: boolean;
  vault_address: string;
  chain?: string | null;
  token?: string | null;
  /** Non-empty when safe=False. Values: 'vault_disabled', 'token_depegged'. */
  reasons?: string[];
  checked_at: string;
}

export interface ScreenRequest {
  /** Vault contract addresses to screen. Max 200. */
  addresses: string[];
}

export interface ScreenResponse {
  results: VaultScreenResult[];
  summary: ScreenSummary;
  last_pipeline_run: string | null;
  checked_at: string;
}

export interface ScreenSummary {
  total: number;
  blocked: number;
  caution: number;
  clear: number;
}

export interface ValidateRequest {
  vault_address: string;
  /** Chain name (e.g. 'base'). */
  chain?: string | null;
  /** Deposit token symbol (e.g. 'usdc'). */
  token?: string | null;
  /** Intended position size in USD. Used to check TVL concentration. */
  value_usd?: number | null;
}

export interface ValidateResponse {
  /** Whether the proposed position passes Sonar validation. */
  valid: boolean;
  /** Vault contract address that was validated. */
  vault_address: string;
  /** Resolved chain for the validation result. */
  chain?: string | null;
  /** Resolved deposit token for the validation result. */
  token?: string | null;
  /** Operational Sonar recommendation: safe_to_enter, blocked, or caution. */
  recommendation: string;
  /** Hard risk flags that directly affect the recommendation. */
  risk_flags?: string[];
  /** Non-blocking warnings relevant to institutional review. */
  warnings?: string[];
  /** UTC timestamp when the validation decision was produced. */
  checked_at: string;
}

export interface VaultReasoning {
  /** Vault contract address evaluated during the explain run. */
  vault_address: string;
  /** Chain where the evaluated vault is deployed. */
  chain: string;
  /** Primary deposit token symbol for the evaluated vault. */
  token: string;
  /** APY observed for the vault during the explain run. */
  apy: number;
  /** Rank of the vault within the evaluated opportunity universe. */
  apy_rank: number;
  /** Assigned portfolio weight when selected, otherwise zero. */
  weight: number;
  /** Assigned USD notional when selected, otherwise zero. */
  value_usd: number;
  /** Whether Engine selected the vault in the proposed allocation. */
  selected: boolean;
  /** Whether Sonar flagged the vault during evaluation. */
  risk_flagged: boolean;
  /** Per-detector Sonar audit trail for the vault. */
  sonar_clearance: DetectorClearance[];
  /** Explicit reasons why the vault was selected or rejected. */
  selection_reasons: string[];
}

export interface VaultRiskResponse {
  /** Normalized vault contract address. */
  vault_address: string;
  /** Human-readable vault name when available. */
  name?: string | null;
  /** Chain where the vault is deployed. */
  chain?: string | null;
  /** Primary deposit token symbol for the vault. */
  token?: string | null;
  /** Whether Sonar currently blocks this vault for institutional use. */
  is_disabled: boolean;
  /** Detailed Sonar disable reasons for the vault. */
  disable_sources?: DisableSource[];
  /** Tokens on the vault's path currently affected by active risk events. */
  affected_tokens?: string[];
  /** Latest Sonar risk score context for the vault. */
  risk_score?: RiskScore | null;
  /** Collateral dependency structure used for risk interpretation. */
  collateral_tree?: CollateralTree | null;
  /** UTC timestamp of the latest Sonar pipeline run. */
  last_pipeline_run?: string | null;
}

export interface VaultScreenResult {
  /** Normalized vault contract address that was screened. */
  vault_address: string;
  /** Human-readable vault name when available. */
  name?: string | null;
  /** Chain where the screened vault is deployed. */
  chain?: string | null;
  /** Primary deposit token symbol for the vault. */
  token?: string | null;
  /** Institutional Sonar decision tier: blocked, caution, or clear. */
  risk_tier: string;
  /** Sonar detectors currently active for this vault. */
  active_detectors: string[];
  /** Detailed disable sources behind the decision. */
  disable_sources?: DisableSource[];
  /** Optional Sonar risk score context for the screened vault. */
  risk_score?: RiskScore | null;
}

export interface YieldOpportunity {
  /** Vault contract address. */
  vault_address: string;
  /** Chain where the opportunity is deployed. */
  chain: string;
  /** Primary deposit token symbol. */
  token: string;
  /** Underlying protocol or venue name when available. */
  protocol?: string | null;
  /** Current total APY used by Engine for ranking. */
  apy: number;
  /** Base APY component. */
  apy_base?: number | null;
  /** Reward-token APY component. */
  apy_reward?: number | null;
  /** Current total value locked in USD when available. */
  tvl_usd?: number | null;
  /** Whether Sonar currently flags the vault. */
  risk_flagged: boolean;
  /** UTC timestamp of the latest APY refresh. */
  last_updated?: string | null;
}

export interface YieldSourceItem {
  /** Yield source contract address. */
  vault_address: string;
  /** Chain where the yield source is deployed. */
  chain: string;
  /** Protocol and strategy name. */
  name: string;
  /** Primary deposit token symbol. */
  token: string;
}

export interface YieldSourcesResponse {
  /** Number of yield sources returned. */
  count: number;
  /** Chain filter applied, if any. */
  chain?: string | null;
  /** Token filter applied, if any. */
  token?: string | null;
  /** Available yield sources monitored by Sonar. */
  sources: YieldSourceItem[];
  /** UTC timestamp when the response was generated. */
  checked_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PortfolioCheckRequest {}

// ── Client ────────────────────────────────────────────────────────────────────

export interface SailIntelligenceOptions {
  /** API key — passed as `X-API-Key` header. */
  apiKey: string;
  /** Override the base URL (for testing / staging). */
  baseUrl?: string;
}

export class SailIntelligence {
  private readonly _base: string;
  private readonly _headers: Record<string, string>;

  constructor(opts: SailIntelligenceOptions) {
    this._base = opts.baseUrl ?? SAIL_INTELLIGENCE_BASE_URL;
    this._headers = { "Content-Type": "application/json", "X-API-Key": opts.apiKey };
  }

  private async _get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this._base}${path}`);
    if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { headers: this._headers });
    if (!res.ok) throw new Error(`Sail Intelligence GET ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  }

  private async _post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this._base}${path}`, {
      method: "POST",
      headers: this._headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Sail Intelligence POST ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  }

  /**
   * All available yield sources
   * Returns all yield sources monitored by Sail Intelligence Sonar. Filter by chain or token to narrow the result set.
   */
  vaultSources(query?: { chain?: string; token?: string }): Promise<YieldSourcesResponse> {
    const _p: Record<string, string> = {};
    if (query)
      Object.entries(query).forEach(([k, v]) => {
        if (v != null) _p[k] = v;
      });
    return this._get(`/v1/vault/sources`, _p);
  }

  /**
   * Single yield source risk intelligence
   * Returns Sail Intelligence Sonar risk intelligence for a single yield source. Includes active disable flags, affected tokens, risk score context, and the collateral dependency tree used for institutional review workflows.
   */
  vault(vaultAddress: string): Promise<VaultRiskResponse> {
    return this._get(`/v1/vault/${vaultAddress}`);
  }

  /**
   * Quick yield source safety decision
   * Returns a single operational answer for institutional workflows: is this yield source currently safe to interact with. Checks both the source-level kill switch and deposit-token depeg status. For full Sonar context use GET /v1/vault/{address}.
   */
  vaultSafe(
    vaultAddress: string,
    query?: { chain?: string; token?: string },
  ): Promise<SafeCheckResponse> {
    const _p: Record<string, string> = {};
    if (query)
      Object.entries(query).forEach(([k, v]) => {
        if (v != null) _p[k] = v;
      });
    return this._get(`/v1/vault/${vaultAddress}/safe`, _p);
  }

  /**
   * Portfolio risk check
   * Given a list of institutional positions (vault address plus optional chain/token), returns which are currently affected by active Sonar risk signals (vault disabled or deposit token depegged). Maximum 500 positions per request.
   */
  portfolioCheck(body: PortfolioCheckRequest): Promise<PortfolioCheckResponse> {
    return this._post(`/v1/portfolio/check`, body);
  }

  /**
   * Sonar global risk snapshot
   * Returns a full Sonar monitoring snapshot of all currently active risk flags: disabled vault addresses (with source breakdown and cooldown state), depegged tokens per chain, per-vault risk scores, and the timestamp of the last institutional monitoring pipeline run.
   */
  risksSummary(): Promise<RisksSummaryResponse> {
    return this._get(`/v1/risks/summary`);
  }

  /**
   * Institutional yield opportunities
   * Returns the top available institutional yield opportunities for a given market, pre-filtered by Sonar risk signals. Disabled yield sources and depegged tokens are excluded by default. Results are sorted by APY descending.
   */
  engineOpportunities(query?: {
    market?: string;
    chain?: string;
    limit?: string;
    include_disabled?: string;
  }): Promise<OpportunitiesResponse> {
    const _p: Record<string, string> = {};
    if (query)
      Object.entries(query).forEach(([k, v]) => {
        if (v != null) _p[k] = v;
      });
    return this._get(`/v1/engine/opportunities`, _p);
  }

  /**
   * Institutional market APY benchmark
   * Returns APY statistics for all Sonar-clean vaults in a given market. Useful for benchmarking institutional portfolios against the currently available Sonar-cleared yield universe.
   */
  engineBenchmark(query?: { market?: string; chain?: string }): Promise<BenchmarkResponse> {
    const _p: Record<string, string> = {};
    if (query)
      Object.entries(query).forEach(([k, v]) => {
        if (v != null) _p[k] = v;
      });
    return this._get(`/v1/engine/benchmark`, _p);
  }

  /**
   * Institutional allocation recommendation
   * Returns a recommended allocation across top-APY yield sources for a given portfolio value. Applies Sonar risk filters so disabled yield sources and depegged tokens are excluded. Uses equal-weight greedy allocation (top N by APY). For deeper execution-layer optimisation, use the institutional execution stack directly.
   */
  engineAllocate(body: AllocationRequest): Promise<AllocationResponse> {
    return this._post(`/v1/engine/allocate`, body);
  }

  /**
   * Institutional rebalancing recommendation
   * Given current institutional yield source positions, computes a rebalancing plan: which positions to exit (risk-flagged, depegged, or suboptimal APY), which to keep, and which new positions to enter. Returns current versus optimal APY and the improvement delta.
   */
  engineRebalance(body: RebalanceRequest): Promise<RebalanceResponse> {
    return this._post(`/v1/engine/rebalance`, body);
  }

  /**
   * Allocation audit trail
   * Returns the recommended allocation alongside a full audit trail: APY rank of each vault considered, per-detector Sonar clearance status, and explicit reasons why each vault was selected or rejected. Designed for compliance review and institutional due diligence.
   */
  engineExplain(body: ExplainRequest): Promise<ExplainResponse> {
    return this._post(`/v1/engine/explain`, body);
  }

  /**
   * Institutional portfolio comparison
   * Compares a current institutional portfolio against a proposed portfolio side by side. Returns APY delta, Sonar risk delta, which positions were exited or entered, and an overall assessment (improvement / degradation / neutral).
   */
  engineCompare(body: CompareRequest): Promise<CompareResponse> {
    return this._post(`/v1/engine/compare`, body);
  }

  /**
   * Institutional portfolio optimization
   * Accepts a current portfolio keyed by chain_id and returns an APY-optimized allocation across authorized vaults. Applies Sonar risk filters and the client's vault allowlist. Mirrors the contract of the fungi-core institutional_endpoint script.
   */
  engineInstitutional(body: InstitutionalRequest): Promise<InstitutionalResponse> {
    return this._post(`/v1/engine/institutional`, body);
  }

  /**
   * Yield opportunities (custom risk)
   * All available institutional yield sources for a given market sorted by APY. No Sonar risk filtering is applied, so all vaults are included regardless of risk status. Sonar signals are not exposed; clients apply their own risk logic.
   */
  engineRawOpportunities(query?: {
    market?: string;
    chain?: string;
    limit?: string;
  }): Promise<RawOpportunitiesResponse> {
    const _p: Record<string, string> = {};
    if (query)
      Object.entries(query).forEach(([k, v]) => {
        if (v != null) _p[k] = v;
      });
    return this._get(`/v1/engine/raw/opportunities`, _p);
  }

  /**
   * Market APY benchmark (custom risk)
   * APY statistics across all vaults in a market, including Sonar-flagged ones. Useful for institutional teams that want the full yield landscape without Sonar filtering.
   */
  engineRawBenchmark(query?: { market?: string; chain?: string }): Promise<BenchmarkResponse> {
    const _p: Record<string, string> = {};
    if (query)
      Object.entries(query).forEach(([k, v]) => {
        if (v != null) _p[k] = v;
      });
    return this._get(`/v1/engine/raw/benchmark`, _p);
  }

  /**
   * Allocation recommendation (custom risk)
   * Recommended allocation across top-APY vaults with no Sonar risk filtering. Allocates purely by APY. Clients apply their own institutional risk layer.
   */
  engineRawAllocate(body: AllocationRequest): Promise<AllocationResponse> {
    return this._post(`/v1/engine/raw/allocate`, body);
  }

  /**
   * Rebalancing recommendation (custom risk)
   * Rebalancing recommendation with no Sonar risk filtering. Exit reasons are APY-based only — no risk_flagged or token_depegged exits.
   */
  engineRawRebalance(body: RebalanceRequest): Promise<RebalanceResponse> {
    return this._post(`/v1/engine/raw/rebalance`, body);
  }

  /**
   * Portfolio comparison (custom risk)
   * Side-by-side institutional portfolio comparison with no Sonar risk filtering. Assessment is based purely on APY delta. Sonar risk delta fields are not returned.
   */
  engineRawCompare(body: CompareRequest): Promise<RawCompareResponse> {
    return this._post(`/v1/engine/raw/compare`, body);
  }

  /**
   * Institutional Sonar screening
   * Screen up to 200 vault addresses in a single call. Returns a per-vault risk tier (blocked / caution / clear), the active Sonar detectors that flagged each vault, and a full disable-source breakdown. Designed for due diligence workflows and compliance audit trails.
   */
  sonarScreen(body: ScreenRequest): Promise<ScreenResponse> {
    return this._post(`/v1/sonar/screen`, body);
  }

  /**
   * Institutional pre-trade validation
   * Validates a proposed institutional vault position before execution. Checks the vault kill-switch, deposit token depeg status, and optionally TVL concentration if a position size is provided. Returns an operational recommendation: safe_to_enter, caution, or blocked.
   */
  sonarValidate(body: ValidateRequest): Promise<ValidateResponse> {
    return this._post(`/v1/sonar/validate`, body);
  }
}
