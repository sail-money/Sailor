import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/** Params for SharedDefiBundlePermission. */
export type DefiBundleParams = {
  /** Maximum total value of the bundle in USD-equivalent (18-decimal WAD). */
  maxBundleValueUsd: number;
  /** Allowed protocol identifiers that may appear in the bundle. */
  allowedProtocols: string[];
  /** Allowed action types within the bundle (e.g. ["swap", "deposit", "borrow"]). */
  allowedActions: string[];
  /** Allowed token addresses that the bundle may interact with. */
  allowedTokens: Address[];
};

const ABI = [
  { name: "maxBundleValueUsd", type: "uint256" },
  { name: "allowedProtocols", type: "string[]" },
  { name: "allowedActions", type: "string[]" },
  { name: "allowedTokens", type: "address[]" },
] as const;

export const defiBundleTemplate: PermissionTemplate<DefiBundleParams> = {
  name: "SharedDefiBundlePermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: DefiBundleParams): Hex {
      return encodeAbiParameters(ABI, [
        BigInt(Math.round(params.maxBundleValueUsd)),
        params.allowedProtocols,
        params.allowedActions,
        params.allowedTokens,
      ]);
    },
    decode(data: Hex): DefiBundleParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        maxBundleValueUsd: Number(decoded[0]),
        allowedProtocols: [...decoded[1]],
        allowedActions: [...decoded[2]],
        allowedTokens: [...decoded[3]],
      };
    },
  },

  explainer: {
    explain(params: DefiBundleParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.maxBundleValueUsd > 100_000) {
        warnings.push(`Large bundle value cap: $${params.maxBundleValueUsd.toLocaleString()}`);
      }
      if (params.allowedActions.includes("borrow") && params.allowedActions.includes("swap")) {
        warnings.push("Bundle permits both borrowing and swapping — review leverage exposure");
      }
      return {
        templateName: "SharedDefiBundlePermission",
        humanReadable: [
          `Maximum bundle value: $${params.maxBundleValueUsd.toLocaleString()} USD`,
          `Allowed protocols: ${params.allowedProtocols.join(", ")}`,
          `Allowed actions: ${params.allowedActions.join(", ")}`,
          `Allowed tokens: ${params.allowedTokens.join(", ")}`,
        ],
        warnings,
      };
    },
  },
};
