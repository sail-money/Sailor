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

export const boundedSwapTemplate: PermissionTemplate<BoundedSwapParams> = {
  name: "SharedBoundedSwapPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(_params: BoundedSwapParams): Hex {
      throw new Error("not implemented");
    },
    decode(_data: Hex): BoundedSwapParams {
      throw new Error("not implemented");
    },
  },

  explainer: {
    explain(_params: BoundedSwapParams): MandateExplanation {
      throw new Error("not implemented");
    },
  },
};
