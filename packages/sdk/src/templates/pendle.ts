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

export const pendleTemplate: PermissionTemplate<PendleParams> = {
  name: "SharedPendlePermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(_params: PendleParams): Hex {
      throw new Error("not implemented");
    },
    decode(_data: Hex): PendleParams {
      throw new Error("not implemented");
    },
  },

  explainer: {
    explain(_params: PendleParams): MandateExplanation {
      throw new Error("not implemented");
    },
  },
};
