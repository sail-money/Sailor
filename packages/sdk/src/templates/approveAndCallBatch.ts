import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/**
 * Params for SharedApproveAndCallBatchPermission.
 *
 * Matches the on-chain `_applyConfig` decode exactly:
 *   abi.decode(params, (Config))
 * where Config is the tuple
 *   (address[] tokens, address[] spenders, address[] consumingTargets,
 *    bytes4[] consumingSelectors, uint256[] maxApprovalAmounts, bool requireAmountMatch)
 *
 * Note: the contract encodes a SINGLE struct, so the blob is one top-level tuple.
 */
export type ApproveAndCallBatchParams = {
  /** Allowlisted ERC-20 tokens that may be approved. Index-parallel with `maxApprovalAmounts`. */
  tokens: Address[];
  /** Allowlisted spenders that may receive the allowance. */
  spenders: Address[];
  /** Allowlisted consuming-call targets (often the same as spenders). */
  consumingTargets: Address[];
  /** Allowlisted selectors for the consuming call (4-byte hex, e.g. "0x095ea7b3"). */
  consumingSelectors: Hex[];
  /** Max approve amount per token, index-parallel with `tokens`. */
  maxApprovalAmounts: bigint[];
  /** When true, the consuming call's leading uint256 arg must equal the approved amount. */
  requireAmountMatch: boolean;
};

const CONFIG_COMPONENTS = [
  { name: "tokens", type: "address[]" },
  { name: "spenders", type: "address[]" },
  { name: "consumingTargets", type: "address[]" },
  { name: "consumingSelectors", type: "bytes4[]" },
  { name: "maxApprovalAmounts", type: "uint256[]" },
  { name: "requireAmountMatch", type: "bool" },
] as const;

const ABI = [{ name: "config", type: "tuple", components: CONFIG_COMPONENTS }] as const;

export const approveAndCallBatchTemplate: PermissionTemplate<ApproveAndCallBatchParams> = {
  name: "SharedApproveAndCallBatchPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: ApproveAndCallBatchParams): Hex {
      return encodeAbiParameters(ABI, [
        {
          tokens: params.tokens,
          spenders: params.spenders,
          consumingTargets: params.consumingTargets,
          consumingSelectors: params.consumingSelectors,
          maxApprovalAmounts: params.maxApprovalAmounts,
          requireAmountMatch: params.requireAmountMatch,
        },
      ]);
    },
    decode(data: Hex): ApproveAndCallBatchParams {
      const [config] = decodeAbiParameters(ABI, data);
      return {
        tokens: [...config.tokens],
        spenders: [...config.spenders],
        consumingTargets: [...config.consumingTargets],
        consumingSelectors: [...config.consumingSelectors],
        maxApprovalAmounts: [...config.maxApprovalAmounts],
        requireAmountMatch: config.requireAmountMatch,
      };
    },
  },

  explainer: {
    explain(params: ApproveAndCallBatchParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.tokens.length !== params.maxApprovalAmounts.length) {
        warnings.push(
          "tokens and maxApprovalAmounts length mismatch — configuration will revert on-chain",
        );
      }
      if (params.spenders.length === 0 || params.tokens.length === 0) {
        warnings.push("Empty token or spender allowlist — configuration will revert on-chain");
      }
      if (!params.requireAmountMatch) {
        warnings.push(
          "Amount-match disabled — the consuming call may move less than the approved amount",
        );
      }
      return {
        templateName: "SharedApproveAndCallBatchPermission",
        humanReadable: [
          `Approvable tokens (${params.tokens.length}): ${params.tokens.join(", ")}`,
          `Approved spenders: ${params.spenders.join(", ")}`,
          `Consuming targets: ${params.consumingTargets.join(", ")}`,
          `Consuming selectors: ${params.consumingSelectors.join(", ")}`,
          `Per-token approval caps: ${params.maxApprovalAmounts.map((a) => a.toString()).join(", ")}`,
          `Require amount match: ${params.requireAmountMatch ? "yes" : "no"}`,
        ],
        warnings,
      };
    },
  },
};
