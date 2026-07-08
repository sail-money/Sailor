// Reference example — not the user's strategy. Consult for patterns; author the user's own in src/.
// Shows: token addresses, swap parameters, and contract addresses for a USDC→WETH DCA on Base mainnet.

import type { Address } from "@sail.money/sailor/sdk";

// ── Token addresses (Base mainnet) ────────────────────────────────────────────

/**
 * Tokens in the DCA basket.
 * ALLOWED_TOKENS[0] = USDC (input — what the agent spends)
 * ALLOWED_TOKENS[1] = WETH (output — what the agent accumulates)
 *
 * PLACEHOLDERS — replace with the operator's tokens for their chain. These are not
 * "the supported tokens"; any valid ERC-20 on a supported chain works. Resolve and
 * verify a token's address on-chain (symbol/decimals) before using it — see Gate 1 of
 * the sailor-mandates skill.
 */
export const ALLOWED_TOKENS: Address[] = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base  (6 decimals)  — placeholder
  "0x4200000000000000000000000000000000000006", // WETH on Base  (18 decimals) — placeholder
];

// ── Swap parameters ───────────────────────────────────────────────────────────
// PLACEHOLDER VALUES — these encode this reference strategy, not the operator's.
// Replace amounts, slippage, and fee tier with the operator's stated bounds.

/** Amount of USDC to spend per swap (in USDC base units, 6 decimals). Default: 5 USDC. */
export const SWAP_AMOUNT_USDC = 5_000_000n; // 5 USDC

/** Minimum USDC balance the SMA must hold before a swap is attempted. */
export const MIN_USDC_TO_SWAP = 6_000_000n; // 6 USDC

/** Slippage tolerance in basis points (100 = 1%). */
export const SLIPPAGE_BPS = 100; // 1%

/** Uniswap V3 pool fee tier for the USDC/WETH pool on Base (500 = 0.05%). */
export const SWAP_FEE_TIER = 500;

/** Rebalance when allocation drift exceeds this fraction (0.05 = 5%). */
export const REBALANCE_THRESHOLD = 0.05;

// ── Contract addresses (Base mainnet) ─────────────────────────────────────────

/** Uniswap SwapRouter02 on Base. Target for exactInputSingle swaps. */
export const SWAP_ROUTER: Address = "0x2626664c2603336E57B271c5C0b26F421741e481";

/**
 * Uniswap V3 QuoterV2 on Base.
 * Called off-chain (via eth_call) to obtain the expected output amount
 * before computing amountOutMinimum.
 */
export const QUOTER_V2: Address = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
