import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/** Params for SharedTransferTargetPermission. */
export type TransferTargetParams = {
  /** Addresses that ERC-20 transfer() calls are allowed to send funds to. */
  allowedRecipients: Address[];
  /** Token addresses for which transfer restrictions apply. Empty = all tokens. */
  allowedTokens: Address[];
};

const ABI = [
  { name: "allowedRecipients", type: "address[]" },
  { name: "allowedTokens", type: "address[]" },
] as const;

export const transferTargetTemplate: PermissionTemplate<TransferTargetParams> = {
  name: "SharedTransferTargetPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: TransferTargetParams): Hex {
      return encodeAbiParameters(ABI, [params.allowedRecipients, params.allowedTokens]);
    },
    decode(data: Hex): TransferTargetParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        allowedRecipients: [...decoded[0]],
        allowedTokens: [...decoded[1]],
      };
    },
  },

  explainer: {
    explain(params: TransferTargetParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.allowedRecipients.length === 0) {
        warnings.push("No recipients specified — all transfers will be blocked");
      }
      const tokenScope =
        params.allowedTokens.length === 0
          ? "all tokens"
          : params.allowedTokens.join(", ");
      return {
        templateName: "SharedTransferTargetPermission",
        humanReadable: [
          `ERC-20 transfers restricted to ${params.allowedRecipients.length} approved recipient(s)`,
          `Applies to: ${tokenScope}`,
          `Approved recipients: ${params.allowedRecipients.join(", ")}`,
        ],
        warnings,
      };
    },
  },
};
