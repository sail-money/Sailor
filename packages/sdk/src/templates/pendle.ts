import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/**
 * Params for SharedPendlePermission.
 *
 * Matches the on-chain `_applyConfig` decode exactly:
 *   abi.decode(params, (address, address[], uint128, bool, bool, bool, bool, bool))
 *     → pendleRouter, allowedMarkets, maxAmountPerTx,
 *       allowLiquidityOps, allowPtSwaps, allowYtSwaps, allowMintRedeem, allowClaimYield
 */
export type PendleParams = {
  /** Pendle Router V4 address the agent may call. Must be non-zero. */
  pendleRouter: Address;
  /** Pendle market (and YT, for mint/redeem) addresses the agent may interact with. */
  allowedMarkets: Address[];
  /** Maximum amount of a single tx, in base units (uint128). */
  maxAmountPerTx: bigint;
  /** Allow add/remove liquidity operations. */
  allowLiquidityOps: boolean;
  /** Allow PT swaps. */
  allowPtSwaps: boolean;
  /** Allow YT swaps. */
  allowYtSwaps: boolean;
  /** Allow mint / redeem of PY. */
  allowMintRedeem: boolean;
  /** Allow claiming yield (redeemDueInterestAndRewards). */
  allowClaimYield: boolean;
};

const ABI = [
  { name: "pendleRouter", type: "address" },
  { name: "allowedMarkets", type: "address[]" },
  { name: "maxAmountPerTx", type: "uint128" },
  { name: "allowLiquidityOps", type: "bool" },
  { name: "allowPtSwaps", type: "bool" },
  { name: "allowYtSwaps", type: "bool" },
  { name: "allowMintRedeem", type: "bool" },
  { name: "allowClaimYield", type: "bool" },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const pendleTemplate: PermissionTemplate<PendleParams> = {
  name: "SharedPendlePermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: PendleParams): Hex {
      return encodeAbiParameters(ABI, [
        params.pendleRouter,
        params.allowedMarkets,
        params.maxAmountPerTx,
        params.allowLiquidityOps,
        params.allowPtSwaps,
        params.allowYtSwaps,
        params.allowMintRedeem,
        params.allowClaimYield,
      ]);
    },
    decode(data: Hex): PendleParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        pendleRouter: decoded[0],
        allowedMarkets: [...decoded[1]],
        maxAmountPerTx: decoded[2],
        allowLiquidityOps: decoded[3],
        allowPtSwaps: decoded[4],
        allowYtSwaps: decoded[5],
        allowMintRedeem: decoded[6],
        allowClaimYield: decoded[7],
      };
    },
  },

  explainer: {
    explain(params: PendleParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.pendleRouter === ZERO_ADDRESS) {
        warnings.push("Pendle router is zero — configuration will revert on-chain");
      }
      if (params.allowedMarkets.length === 0) {
        warnings.push("No markets specified — all Pendle market interactions will be blocked");
      }
      const ops = [
        params.allowLiquidityOps && "liquidity",
        params.allowPtSwaps && "PT swaps",
        params.allowYtSwaps && "YT swaps",
        params.allowMintRedeem && "mint/redeem",
        params.allowClaimYield && "claim yield",
      ].filter(Boolean);
      return {
        templateName: "SharedPendlePermission",
        humanReadable: [
          `Pendle router: ${params.pendleRouter}`,
          `Maximum amount per tx: ${params.maxAmountPerTx.toString()} (base units)`,
          `Enabled operations: ${ops.length ? ops.join(", ") : "none"}`,
          `Allowed markets (${params.allowedMarkets.length}): ${params.allowedMarkets.join(", ")}`,
        ],
        warnings,
      };
    },
  },
};
