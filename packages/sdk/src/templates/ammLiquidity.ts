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

export const ammLiquidityTemplate: PermissionTemplate<AmmLiquidityParams> = {
  name: "SharedAmmLiquidityPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(_params: AmmLiquidityParams): Hex {
      throw new Error("not implemented");
    },
    decode(_data: Hex): AmmLiquidityParams {
      throw new Error("not implemented");
    },
  },

  explainer: {
    explain(_params: AmmLiquidityParams): MandateExplanation {
      throw new Error("not implemented");
    },
  },
};
