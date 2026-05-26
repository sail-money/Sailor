import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/** Params for SharedBoundedSwapPermission. */
export type BoundedSwapParams = {
  /** Maximum value of a single swap in USD-equivalent (18-decimal WAD). */
  maxSwapValueUsd: number;
  /** Maximum allowed slippage in basis points (e.g. 50 = 0.5%). */
  maxSlippageBps: number;
  /** Token addresses allowed as swap input. */
  allowedInputTokens: Address[];
  /** Token addresses allowed as swap output. */
  allowedOutputTokens: Address[];
  /** Protocol identifiers allowed (e.g. ["uniswapV3", "curve"]). */
  allowedProtocols: string[];
};

const ABI = [
  { name: "maxSwapValueUsd", type: "uint256" },
  { name: "maxSlippageBps", type: "uint256" },
  { name: "allowedInputTokens", type: "address[]" },
  { name: "allowedOutputTokens", type: "address[]" },
  { name: "allowedProtocols", type: "string[]" },
] as const;

export const boundedSwapTemplate: PermissionTemplate<BoundedSwapParams> = {
  name: "SharedBoundedSwapPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: BoundedSwapParams): Hex {
      return encodeAbiParameters(ABI, [
        BigInt(Math.round(params.maxSwapValueUsd)),
        BigInt(params.maxSlippageBps),
        params.allowedInputTokens,
        params.allowedOutputTokens,
        params.allowedProtocols,
      ]);
    },
    decode(data: Hex): BoundedSwapParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        maxSwapValueUsd: Number(decoded[0]),
        maxSlippageBps: Number(decoded[1]),
        allowedInputTokens: [...decoded[2]],
        allowedOutputTokens: [...decoded[3]],
        allowedProtocols: [...decoded[4]],
      };
    },
  },

  explainer: {
    explain(params: BoundedSwapParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.maxSwapValueUsd > 10_000) {
        warnings.push(`High per-swap limit: $${params.maxSwapValueUsd.toLocaleString()}`);
      }
      if (params.maxSlippageBps > 100) {
        warnings.push(`High slippage tolerance: ${params.maxSlippageBps / 100}%`);
      }
      return {
        templateName: "SharedBoundedSwapPermission",
        humanReadable: [
          `Maximum swap size: $${params.maxSwapValueUsd.toLocaleString()} USD per transaction`,
          `Maximum slippage: ${params.maxSlippageBps / 100}%`,
          `Allowed input tokens: ${params.allowedInputTokens.join(", ")}`,
          `Allowed output tokens: ${params.allowedOutputTokens.join(", ")}`,
          `Allowed protocols: ${params.allowedProtocols.join(", ")}`,
        ],
        warnings,
      };
    },
  },
};
