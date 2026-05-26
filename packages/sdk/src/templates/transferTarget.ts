import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/** Params for SharedTransferTargetPermission. */
export type TransferTargetParams = {
  /** Addresses that ERC-20 transfer() calls are allowed to send funds to. */
  allowedRecipients: Address[];
  /** Token addresses for which transfer restrictions apply. Empty = all tokens. */
  allowedTokens: Address[];
};

export const transferTargetTemplate: PermissionTemplate<TransferTargetParams> = {
  name: "SharedTransferTargetPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(_params: TransferTargetParams): Hex {
      throw new Error("not implemented");
    },
    decode(_data: Hex): TransferTargetParams {
      throw new Error("not implemented");
    },
  },

  explainer: {
    explain(_params: TransferTargetParams): MandateExplanation {
      throw new Error("not implemented");
    },
  },
};
