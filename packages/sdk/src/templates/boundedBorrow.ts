import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/**
 * Params for SharedBoundedBorrowPermission.
 *
 * Matches the on-chain `_applyConfig` decode exactly:
 *   abi.decode(params, (address[], address[], uint256, uint256, address, address, uint256))
 *     → protocols, assets, maxAmountPerTx, maxLtvBps, collateralOracle, borrowOracle, maxPriceAgeSec
 */
export type BoundedBorrowParams = {
  /** Lending-protocol contract addresses the agent may call (Aave V3 / Morpho / Compound). */
  protocols: Address[];
  /** Allowed borrow asset addresses. */
  assets: Address[];
  /** Maximum borrow amount of a single tx, in the asset's base units. */
  maxAmountPerTx: bigint;
  /** Maximum resulting LTV in basis points (e.g. 7500 = 75%). */
  maxLtvBps: number;
  /** Oracle pricing the collateral asset; `address(0)` disables the LTV check. */
  collateralOracle: Address;
  /** Oracle pricing the borrow asset; `address(0)` disables the LTV check. */
  borrowOracle: Address;
  /** Maximum oracle price age in seconds. Must be > 0 when both oracles are set. */
  maxPriceAgeSec: number;
};

const ABI = [
  { name: "protocols", type: "address[]" },
  { name: "assets", type: "address[]" },
  { name: "maxAmountPerTx", type: "uint256" },
  { name: "maxLtvBps", type: "uint256" },
  { name: "collateralOracle", type: "address" },
  { name: "borrowOracle", type: "address" },
  { name: "maxPriceAgeSec", type: "uint256" },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const boundedBorrowTemplate: PermissionTemplate<BoundedBorrowParams> = {
  name: "SharedBoundedBorrowPermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: BoundedBorrowParams): Hex {
      return encodeAbiParameters(ABI, [
        params.protocols,
        params.assets,
        params.maxAmountPerTx,
        BigInt(params.maxLtvBps),
        params.collateralOracle,
        params.borrowOracle,
        BigInt(params.maxPriceAgeSec),
      ]);
    },
    decode(data: Hex): BoundedBorrowParams {
      const decoded = decodeAbiParameters(ABI, data);
      return {
        protocols: [...decoded[0]],
        assets: [...decoded[1]],
        maxAmountPerTx: decoded[2],
        maxLtvBps: Number(decoded[3]),
        collateralOracle: decoded[4],
        borrowOracle: decoded[5],
        maxPriceAgeSec: Number(decoded[6]),
      };
    },
  },

  explainer: {
    explain(params: BoundedBorrowParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.maxLtvBps > 8000) {
        warnings.push(`High LTV cap: ${params.maxLtvBps / 100}% — liquidation risk is elevated`);
      }
      if (params.collateralOracle === ZERO_ADDRESS || params.borrowOracle === ZERO_ADDRESS) {
        warnings.push("LTV not enforced — both collateral and borrow oracles must be set");
      }
      return {
        templateName: "SharedBoundedBorrowPermission",
        humanReadable: [
          `Maximum borrow per tx: ${params.maxAmountPerTx.toString()} (asset base units)`,
          `Maximum LTV: ${params.maxLtvBps / 100}%`,
          `Allowed protocols: ${params.protocols.join(", ")}`,
          `Allowed assets: ${params.assets.join(", ")}`,
          `Collateral oracle: ${params.collateralOracle}`,
          `Borrow oracle: ${params.borrowOracle}`,
          `Max oracle price age: ${params.maxPriceAgeSec}s`,
        ],
        warnings,
      };
    },
  },
};
