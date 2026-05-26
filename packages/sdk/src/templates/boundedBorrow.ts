import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/** Params for SharedBoundedBorrowPermission. */
export type BoundedBorrowParams = {
  /** Maximum borrow amount in USD-equivalent (18-decimal WAD). */
  maxBorrowValueUsd: number;
  /** Maximum resulting LTV in basis points (e.g. 7500 = 75%). */
  maxLtvBps: number;
  /** Allowed collateral token addresses. */
  allowedCollateralTokens: Address[];
  /** Allowed debt token addresses. */
  allowedDebtTokens: Address[];
  /** Protocol identifiers allowed (e.g. ["aaveV3", "morpho"]). */
  allowedProtocols: string[];
};

const ABI = [
  { name: "maxBorrowValueUsd", type: "uint256" },
  { name: "maxLtvBps", type: "uint256" },
  { name: "allowedCollateralTokens", type: "address[]" },
  { name: "allowedDebtTokens", type: "address[]" },
  { name: "allowedProtocols", type: "string[]" },
] as const;

export const boundedBorrowTemplate: PermissionTemplate<BoundedBorrowParams> = {
  name: "SharedBoundedBorrowPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: BoundedBorrowParams): Hex {
      return encodeAbiParameters(ABI, [
        BigInt(Math.round(params.maxBorrowValueUsd)),
        BigInt(params.maxLtvBps),
        params.allowedCollateralTokens,
        params.allowedDebtTokens,
        params.allowedProtocols,
      ]);
    },
    decode(data: Hex): BoundedBorrowParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        maxBorrowValueUsd: Number(decoded[0]),
        maxLtvBps: Number(decoded[1]),
        allowedCollateralTokens: [...decoded[2]],
        allowedDebtTokens: [...decoded[3]],
        allowedProtocols: [...decoded[4]],
      };
    },
  },

  explainer: {
    explain(params: BoundedBorrowParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.maxLtvBps > 8000) {
        warnings.push(`High LTV cap: ${params.maxLtvBps / 100}% — liquidation risk is elevated`);
      }
      if (params.maxBorrowValueUsd > 50_000) {
        warnings.push(`High borrow limit: $${params.maxBorrowValueUsd.toLocaleString()}`);
      }
      return {
        templateName: "SharedBoundedBorrowPermission",
        humanReadable: [
          `Maximum borrow size: $${params.maxBorrowValueUsd.toLocaleString()} USD`,
          `Maximum LTV: ${params.maxLtvBps / 100}%`,
          `Allowed collateral tokens: ${params.allowedCollateralTokens.join(", ")}`,
          `Allowed debt tokens: ${params.allowedDebtTokens.join(", ")}`,
          `Allowed protocols: ${params.allowedProtocols.join(", ")}`,
        ],
        warnings,
      };
    },
  },
};
