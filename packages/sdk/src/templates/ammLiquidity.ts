import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/**
 * Params for SharedAMMLiquidityPermission.
 *
 * Matches the on-chain `_applyConfig` decode exactly:
 *   abi.decode(params, (address[], address[], uint128, bool, bool, bool, bool, bool))
 *     → allowedTargets, allowedTokens, maxAmountPerTokenPerTx,
 *       allowMint, allowIncrease, allowDecrease, allowCollect, allowBurn
 */
export type AmmLiquidityParams = {
  /** Position-manager / router addresses the agent may call (UniV3 NPM, Aerodrome, …). */
  allowedTargets: Address[];
  /** Token addresses the agent may provide as liquidity. */
  allowedTokens: Address[];
  /** Maximum amount of any single token per tx, in that token's base units (uint128). */
  maxAmountPerTokenPerTx: bigint;
  /** Allow mint / open-position (and Aerodrome add-liquidity). */
  allowMint: boolean;
  /** Allow increaseLiquidity. */
  allowIncrease: boolean;
  /** Allow decreaseLiquidity (and Aerodrome remove-liquidity). */
  allowDecrease: boolean;
  /** Allow collect (fee withdrawal). */
  allowCollect: boolean;
  /** Allow burn (close position NFT). */
  allowBurn: boolean;
};

const ABI = [
  { name: "allowedTargets", type: "address[]" },
  { name: "allowedTokens", type: "address[]" },
  { name: "maxAmountPerTokenPerTx", type: "uint128" },
  { name: "allowMint", type: "bool" },
  { name: "allowIncrease", type: "bool" },
  { name: "allowDecrease", type: "bool" },
  { name: "allowCollect", type: "bool" },
  { name: "allowBurn", type: "bool" },
] as const;

export const ammLiquidityTemplate: PermissionTemplate<AmmLiquidityParams> = {
  name: "SharedAMMLiquidityPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: AmmLiquidityParams): Hex {
      return encodeAbiParameters(ABI, [
        params.allowedTargets,
        params.allowedTokens,
        params.maxAmountPerTokenPerTx,
        params.allowMint,
        params.allowIncrease,
        params.allowDecrease,
        params.allowCollect,
        params.allowBurn,
      ]);
    },
    decode(data: Hex): AmmLiquidityParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        allowedTargets: [...decoded[0]],
        allowedTokens: [...decoded[1]],
        maxAmountPerTokenPerTx: decoded[2],
        allowMint: decoded[3],
        allowIncrease: decoded[4],
        allowDecrease: decoded[5],
        allowCollect: decoded[6],
        allowBurn: decoded[7],
      };
    },
  },

  explainer: {
    explain(params: AmmLiquidityParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.allowedTargets.length === 0) {
        warnings.push("No targets specified — all liquidity operations will be blocked");
      }
      const ops = [
        params.allowMint && "mint",
        params.allowIncrease && "increase",
        params.allowDecrease && "decrease",
        params.allowCollect && "collect",
        params.allowBurn && "burn",
      ].filter(Boolean);
      return {
        templateName: "SharedAMMLiquidityPermission",
        humanReadable: [
          `Maximum amount per token per tx: ${params.maxAmountPerTokenPerTx.toString()} (base units)`,
          `Allowed targets (${params.allowedTargets.length}): ${params.allowedTargets.join(", ")}`,
          `Allowed tokens: ${params.allowedTokens.join(", ")}`,
          `Enabled operations: ${ops.length ? ops.join(", ") : "none"}`,
        ],
        warnings,
      };
    },
  },
};
