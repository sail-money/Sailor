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

export const boundedBorrowTemplate: PermissionTemplate<BoundedBorrowParams> = {
  name: "SharedBoundedBorrowPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(_params: BoundedBorrowParams): Hex {
      throw new Error("not implemented");
    },
    decode(_data: Hex): BoundedBorrowParams {
      throw new Error("not implemented");
    },
  },

  explainer: {
    explain(_params: BoundedBorrowParams): MandateExplanation {
      throw new Error("not implemented");
    },
  },
};
