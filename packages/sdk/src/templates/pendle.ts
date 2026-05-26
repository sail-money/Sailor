import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/** Params for SharedPendlePermission. */
export type PendleParams = {
  /** Maximum position size in USD-equivalent (18-decimal WAD). */
  maxPositionValueUsd: number;
  /** Pendle market addresses the agent may interact with. */
  allowedMarkets: Address[];
  /** Allowed action types (e.g. ["addLiquidity", "swapPT", "swapYT", "redeem"]). */
  allowedActions: string[];
  /** Minimum implied APY gate in basis points (e.g. 500 = 5%). */
  minImpliedApyBps: number;
};

const ABI = [
  { name: "maxPositionValueUsd", type: "uint256" },
  { name: "allowedMarkets", type: "address[]" },
  { name: "allowedActions", type: "string[]" },
  { name: "minImpliedApyBps", type: "uint256" },
] as const;

export const pendleTemplate: PermissionTemplate<PendleParams> = {
  name: "SharedPendlePermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: PendleParams): Hex {
      return encodeAbiParameters(ABI, [
        BigInt(Math.round(params.maxPositionValueUsd)),
        params.allowedMarkets,
        params.allowedActions,
        BigInt(params.minImpliedApyBps),
      ]);
    },
    decode(data: Hex): PendleParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        maxPositionValueUsd: Number(decoded[0]),
        allowedMarkets: [...decoded[1]],
        allowedActions: [...decoded[2]],
        minImpliedApyBps: Number(decoded[3]),
      };
    },
  },

  explainer: {
    explain(params: PendleParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.minImpliedApyBps === 0) {
        warnings.push("No minimum APY gate — agent may enter low-yield positions");
      }
      if (params.allowedMarkets.length === 0) {
        warnings.push("No markets specified — all Pendle market interactions will be blocked");
      }
      return {
        templateName: "SharedPendlePermission",
        humanReadable: [
          `Maximum position size: $${params.maxPositionValueUsd.toLocaleString()} USD`,
          `Minimum implied APY: ${params.minImpliedApyBps / 100}%`,
          `Allowed actions: ${params.allowedActions.join(", ")}`,
          `Allowed markets (${params.allowedMarkets.length}): ${params.allowedMarkets.join(", ")}`,
        ],
        warnings,
      };
    },
  },
};
