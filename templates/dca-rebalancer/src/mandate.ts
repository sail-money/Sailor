import type { Address, MandateItem } from "@sail/sdk";
import {
  boundedSwapTemplate,
  transferTargetTemplate,
  type BoundedSwapParams,
  type TransferTargetParams,
} from "@sail/sdk/templates";

// ── Strategy constants ─────────────────────────────────────────────────────────

/** Maximum USD value for a single swap. */
export const MAX_SWAP_USD = 50;

/** Slippage tolerance in basis points (50 = 0.5%). */
export const MAX_SLIPPAGE_BPS = 50;

/** Rebalance when drift from target allocation exceeds this fraction (0.05 = 5%). */
export const REBALANCE_THRESHOLD = 0.05;

/**
 * Allowed tokens for the DCA basket.
 * Placeholder addresses — replace with real token addresses for your chain.
 *
 * Base mainnet defaults:
 *   - USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   - WETH: 0x4200000000000000000000000000000000000006
 */
export const ALLOWED_TOKENS: Address[] = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
  "0x4200000000000000000000000000000000000006", // WETH on Base
];

// ── Mandate items ──────────────────────────────────────────────────────────────

/**
 * SharedBoundedSwapPermission — allow swaps on Uniswap V3 only,
 * between USDC and WETH only, max $50 per swap, max 0.5% slippage.
 */
const boundedSwapItem: MandateItem<BoundedSwapParams> = {
  template: boundedSwapTemplate,
  params: {
    maxSwapValueUsd: MAX_SWAP_USD,
    maxSlippageBps: MAX_SLIPPAGE_BPS,
    allowedInputTokens: ALLOWED_TOKENS,
    allowedOutputTokens: ALLOWED_TOKENS,
    allowedProtocols: ["uniswapV3"],
  },
};

/**
 * SharedTransferTargetPermission — ERC-20 transfers may only go to
 * the known token contract addresses (no arbitrary recipients).
 */
const transferTargetItem: MandateItem<TransferTargetParams> = {
  template: transferTargetTemplate,
  params: {
    allowedRecipients: ALLOWED_TOKENS,
    allowedTokens: ALLOWED_TOKENS,
  },
};

/** Full mandate for this agent: attach all items via client.mandate.attachBatch(). */
export const mandateItems: MandateItem[] = [boundedSwapItem, transferTargetItem];
