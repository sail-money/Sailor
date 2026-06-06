import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/**
 * Params for SharedTransferTargetPermission.
 *
 * Matches the on-chain `_applyConfig` decode exactly:
 *   abi.decode(params, (address[], address[], uint256))
 *     → recipients, tokens, maxAmountPerTx
 */
export type TransferTargetParams = {
  /** Addresses that ERC-20 transfer()/transferFrom() calls are allowed to send funds to. */
  allowedRecipients: Address[];
  /** Token addresses for which transfers are gated. The token is the call target. */
  allowedTokens: Address[];
  /** Maximum amount per transfer, in the token's base units. */
  maxAmountPerTx: bigint;
};

const ABI = [
  { name: "recipients", type: "address[]" },
  { name: "tokens", type: "address[]" },
  { name: "maxAmountPerTx", type: "uint256" },
] as const;

export const transferTargetTemplate: PermissionTemplate<TransferTargetParams> = {
  name: "SharedTransferTargetPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: TransferTargetParams): Hex {
      return encodeAbiParameters(ABI, [
        params.allowedRecipients,
        params.allowedTokens,
        params.maxAmountPerTx,
      ]);
    },
    decode(data: Hex): TransferTargetParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        allowedRecipients: [...decoded[0]],
        allowedTokens: [...decoded[1]],
        maxAmountPerTx: decoded[2],
      };
    },
  },

  explainer: {
    explain(params: TransferTargetParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.allowedRecipients.length === 0) {
        warnings.push("No recipients specified — all transfers will be blocked");
      }
      if (params.allowedTokens.length === 0) {
        warnings.push("No tokens specified — all transfers will be blocked");
      }
      return {
        templateName: "SharedTransferTargetPermission",
        humanReadable: [
          `ERC-20 transfers restricted to ${params.allowedRecipients.length} approved recipient(s)`,
          `Gated tokens: ${params.allowedTokens.join(", ")}`,
          `Maximum amount per transfer: ${params.maxAmountPerTx.toString()} (base units)`,
          `Approved recipients: ${params.allowedRecipients.join(", ")}`,
        ],
        warnings,
      };
    },
  },
};
