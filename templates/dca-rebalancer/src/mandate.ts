import type { Address } from "@sail/sdk";

// ── Token addresses (Base mainnet) ────────────────────────────────────────────

/**
 * Tokens in the DCA basket.
 * ALLOWED_TOKENS[0] = USDC (input — what the agent spends)
 * ALLOWED_TOKENS[1] = WETH (output — what the agent accumulates)
 */
export const ALLOWED_TOKENS: Address[] = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base  (6 decimals)
  "0x4200000000000000000000000000000000000006", // WETH on Base  (18 decimals)
];

// ── Swap parameters ───────────────────────────────────────────────────────────

/**
 * Amount of USDC to spend per swap (in USDC base units, 6 decimals).
 * Default: 5 USDC. Adjust before deploying to production.
 */
export const SWAP_AMOUNT_USDC = 5_000_000n; // 5 USDC

/**
 * Minimum USDC balance the SMA must hold before a swap is attempted.
 * Must be ≥ SWAP_AMOUNT_USDC. Adds a safety margin so a single swap
 * doesn't drain the account to zero.
 */
export const MIN_USDC_TO_SWAP = 6_000_000n; // 6 USDC

/**
 * Slippage tolerance in basis points (100 = 1%).
 * amountOutMinimum = quote × (1 − SLIPPAGE_BPS / 10 000).
 * If no quote is available, the agent skips the swap entirely (fail closed).
 *
 * Tighten for large trades or illiquid pairs; loosen if valid swaps are
 * frequently denied by price impact. Default 1% is conservative for
 * USDC/WETH on Base.
 */
export const SLIPPAGE_BPS = 100; // 1%

/**
 * Uniswap V3 pool fee tier for the USDC/WETH pool on Base.
 * 500 = 0.05% — the most liquid USDC/WETH pool on Base mainnet.
 */
export const SWAP_FEE_TIER = 500;

// ── Rebalancing ───────────────────────────────────────────────────────────────

/** Rebalance when allocation drift exceeds this fraction (0.05 = 5%). */
export const REBALANCE_THRESHOLD = 0.05;

// ── Contract addresses (Base mainnet) ─────────────────────────────────────────

/** Uniswap SwapRouter02 on Base. Target for exactInputSingle swaps. */
export const SWAP_ROUTER: Address = "0x2626664c2603336E57B271c5C0b26F421741e481";

/**
 * Uniswap V3 QuoterV2 on Base.
 * Called off-chain (via eth_call) to obtain the expected output amount
 * before computing amountOutMinimum. If this call fails, the agent skips
 * the swap — it never submits with amountOutMinimum = 0.
 *
 * Note: amountOutMinimum is set by the agent from the QuoterV2 result.
 * For defense-in-depth, add an on-chain minimum check in your permission
 * contract so the kernel also validates the minimum out requirement.
 */
export const QUOTER_V2: Address = "0x3d4e44Eb1374240CE5F1B136d42dD7A91Dc8b85a";
