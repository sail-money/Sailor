import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/**
 * Params for SharedBoundedSwapPermission.
 *
 * Matches the on-chain `_applyConfig` decode exactly:
 *   abi.decode(params, (address[], address[], uint256, uint256, address, uint256))
 *     → routers, tokensIn, tokensOut, maxAmountPerTx, maxSlippageBps, priceOracle, maxPriceAgeSec
 */
export type BoundedSwapParams = {
  /** Router/aggregator addresses the agent may call (e.g. Uniswap V3 SwapRouter). */
  routers: Address[];
  /** Token addresses allowed as swap input. */
  tokensIn: Address[];
  /** Token addresses allowed as swap output. */
  tokensOut: Address[];
  /** Maximum input amount of a single swap, in the input token's base units. */
  maxAmountPerTx: bigint;
  /** Maximum allowed slippage in basis points (e.g. 50 = 0.5%). */
  maxSlippageBps: number;
  /**
   * Price oracle used for the slippage check. Mandatory on-chain: `_applyConfig`
   * reverts `OracleRequired()` if this is `address(0)` — it cannot be used to
   * disable the check. For tokens with no oracle, use `SwapPermissionNoOracle` instead.
   */
  priceOracle: Address;
  /** Maximum oracle price age in seconds. Mandatory: reverts `MissingPriceAge()` if `0`. */
  maxPriceAgeSec: number;
};

const ABI = [
  { name: "routers", type: "address[]" },
  { name: "tokensIn", type: "address[]" },
  { name: "tokensOut", type: "address[]" },
  { name: "maxAmountPerTx", type: "uint256" },
  { name: "maxSlippageBps", type: "uint256" },
  { name: "priceOracle", type: "address" },
  { name: "maxPriceAgeSec", type: "uint256" },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const boundedSwapTemplate: PermissionTemplate<BoundedSwapParams> = {
  name: "SharedBoundedSwapPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: BoundedSwapParams): Hex {
      return encodeAbiParameters(ABI, [
        params.routers,
        params.tokensIn,
        params.tokensOut,
        params.maxAmountPerTx,
        BigInt(params.maxSlippageBps),
        params.priceOracle,
        BigInt(params.maxPriceAgeSec),
      ]);
    },
    decode(data: Hex): BoundedSwapParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        routers: [...decoded[0]],
        tokensIn: [...decoded[1]],
        tokensOut: [...decoded[2]],
        maxAmountPerTx: decoded[3],
        maxSlippageBps: Number(decoded[4]),
        priceOracle: decoded[5],
        maxPriceAgeSec: Number(decoded[6]),
      };
    },
  },

  explainer: {
    explain(params: BoundedSwapParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.maxSlippageBps > 100) {
        warnings.push(`High slippage tolerance: ${params.maxSlippageBps / 100}%`);
      }
      if (params.priceOracle === ZERO_ADDRESS) {
        warnings.push("No price oracle configured — swaps are not checked against a reference price");
      }
      return {
        templateName: "SharedBoundedSwapPermission",
        humanReadable: [
          `Maximum input per swap: ${params.maxAmountPerTx.toString()} (input-token base units)`,
          `Maximum slippage: ${params.maxSlippageBps / 100}%`,
          `Allowed routers: ${params.routers.join(", ")}`,
          `Allowed input tokens: ${params.tokensIn.join(", ")}`,
          `Allowed output tokens: ${params.tokensOut.join(", ")}`,
          params.priceOracle === ZERO_ADDRESS
            ? "Price oracle: none"
            : `Price oracle: ${params.priceOracle} (max age ${params.maxPriceAgeSec}s)`,
        ],
        warnings,
      };
    },
  },
};
