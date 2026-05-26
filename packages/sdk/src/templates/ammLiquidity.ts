import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/** Params for SharedAmmLiquidityPermission. */
export type AmmLiquidityParams = {
  /** Maximum total liquidity value in USD-equivalent (18-decimal WAD). */
  maxLiquidityValueUsd: number;
  /** Pool addresses the agent may LP into. */
  allowedPools: Address[];
  /** Protocol identifiers allowed (e.g. ["uniswapV3", "curveV2", "balancer"]). */
  allowedProtocols: string[];
  /** Whether single-sided deposits are permitted. */
  allowSingleSided: boolean;
  /** Maximum price range width in basis points (Uni V3 only). */
  maxRangeBps?: number;
};

const ABI = [
  { name: "maxLiquidityValueUsd", type: "uint256" },
  { name: "allowedPools", type: "address[]" },
  { name: "allowedProtocols", type: "string[]" },
  { name: "allowSingleSided", type: "bool" },
  { name: "maxRangeBps", type: "uint256" },
] as const;

export const ammLiquidityTemplate: PermissionTemplate<AmmLiquidityParams> = {
  name: "SharedAmmLiquidityPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: AmmLiquidityParams): Hex {
      return encodeAbiParameters(ABI, [
        BigInt(Math.round(params.maxLiquidityValueUsd)),
        params.allowedPools,
        params.allowedProtocols,
        params.allowSingleSided,
        BigInt(params.maxRangeBps ?? 0),
      ]);
    },
    decode(data: Hex): AmmLiquidityParams {
      const decoded = decodeAbiParameters(ABI, data);
      const maxRangeBps = Number(decoded[4]);
      return {
        maxLiquidityValueUsd: Number(decoded[0]),
        allowedPools: [...decoded[1]],
        allowedProtocols: [...decoded[2]],
        allowSingleSided: decoded[3],
        ...(maxRangeBps > 0 ? { maxRangeBps } : {}),
      };
    },
  },

  explainer: {
    explain(params: AmmLiquidityParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.allowSingleSided) {
        warnings.push(
          "Single-sided deposits permitted — may result in immediate impermanent loss",
        );
      }
      if (params.maxRangeBps !== undefined && params.maxRangeBps > 5000) {
        warnings.push(`Wide price range allowed: ±${params.maxRangeBps / 100}%`);
      }
      const rangeNote =
        params.maxRangeBps !== undefined
          ? `Maximum price range (Uni V3): ±${params.maxRangeBps / 100}%`
          : null;
      return {
        templateName: "SharedAmmLiquidityPermission",
        humanReadable: [
          `Maximum liquidity value: $${params.maxLiquidityValueUsd.toLocaleString()} USD`,
          `Allowed protocols: ${params.allowedProtocols.join(", ")}`,
          `Allowed pools (${params.allowedPools.length}): ${params.allowedPools.join(", ")}`,
          `Single-sided deposits: ${params.allowSingleSided ? "allowed" : "not allowed"}`,
          ...(rangeNote ? [rangeNote] : []),
        ],
        warnings,
      };
    },
  },
};
