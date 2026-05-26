import { decodeAbiParameters, encodeAbiParameters } from "viem";
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

const ABI = [
  { name: "allowedSpenders", type: "address[]" },
  { name: "allowedTokens", type: "address[]" },
  { name: "maxApprovalValueUsd", type: "uint256" },
  { name: "allowInfiniteApprovals", type: "bool" },
] as const;

export const approveAndCallBatchTemplate: PermissionTemplate<ApproveAndCallBatchParams> = {
  name: "SharedApproveAndCallBatchPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: ApproveAndCallBatchParams): Hex {
      return encodeAbiParameters(ABI, [
        params.allowedSpenders,
        params.allowedTokens,
        BigInt(Math.round(params.maxApprovalValueUsd)),
        params.allowInfiniteApprovals,
      ]);
    },
    decode(data: Hex): ApproveAndCallBatchParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        allowedSpenders: [...decoded[0]],
        allowedTokens: [...decoded[1]],
        maxApprovalValueUsd: Number(decoded[2]),
        allowInfiniteApprovals: decoded[3],
      };
    },
  },

  explainer: {
    explain(params: ApproveAndCallBatchParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.allowInfiniteApprovals) {
        warnings.push(
          "Infinite approvals enabled — spenders may pull tokens beyond the per-batch cap",
        );
      }
      if (params.allowedSpenders.length === 0) {
        warnings.push("No spenders specified — all approvals will be blocked");
      }
      return {
        templateName: "SharedApproveAndCallBatchPermission",
        humanReadable: [
          `ERC-20 approvals restricted to ${params.allowedSpenders.length} approved spender(s)`,
          `Allowed tokens: ${params.allowedTokens.join(", ")}`,
          `Maximum approval value per batch: $${params.maxApprovalValueUsd.toLocaleString()} USD`,
          `Infinite approvals: ${params.allowInfiniteApprovals ? "allowed" : "not allowed"}`,
          `Approved spenders: ${params.allowedSpenders.join(", ")}`,
        ],
        warnings,
      };
    },
  },
};
