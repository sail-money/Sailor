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

export const defiBundleTemplate: PermissionTemplate<DefiBundleParams> = {
  name: "SharedDefiBundlePermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(_params: DefiBundleParams): Hex {
      throw new Error("not implemented");
    },
    decode(_data: Hex): DefiBundleParams {
      throw new Error("not implemented");
    },
  },

  explainer: {
    explain(_params: DefiBundleParams): MandateExplanation {
      throw new Error("not implemented");
    },
  },
};
