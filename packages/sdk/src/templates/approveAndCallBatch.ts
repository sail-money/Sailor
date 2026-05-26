import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/** Params for SharedApproveAndCallBatchPermission. */
export type ApproveAndCallBatchParams = {
  /** Spender addresses that may receive ERC-20 approvals. */
  allowedSpenders: Address[];
  /** Token addresses for which approvals may be granted. */
  allowedTokens: Address[];
  /** Maximum total approval value per batch in USD-equivalent (18-decimal WAD). */
  maxApprovalValueUsd: number;
  /** Whether infinite (max-uint) approvals are permitted. */
  allowInfiniteApprovals: boolean;
};

export const approveAndCallBatchTemplate: PermissionTemplate<ApproveAndCallBatchParams> = {
  name: "SharedApproveAndCallBatchPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(_params: ApproveAndCallBatchParams): Hex {
      throw new Error("not implemented");
    },
    decode(_data: Hex): ApproveAndCallBatchParams {
      throw new Error("not implemented");
    },
  },

  explainer: {
    explain(_params: ApproveAndCallBatchParams): MandateExplanation {
      throw new Error("not implemented");
    },
  },
};
