import { decodeAbiParameters, encodeAbiParameters } from "viem";
import type { Address, Hex, MandateExplanation, PermissionTemplate } from "../types.js";

/** Swap sub-domain config — mirrors the contract's `SwapConfig` struct. */
export type DefiBundleSwapConfig = {
  routers: Address[];
  tokensIn: Address[];
  tokensOut: Address[];
  maxAmountPerTx: bigint;
  maxSlippageBps: number;
  priceOracle: Address;
  maxPriceAgeSec: number;
};

/** Borrow sub-domain config — mirrors the contract's `BorrowConfig` struct. */
export type DefiBundleBorrowConfig = {
  protocols: Address[];
  assets: Address[];
  maxAmountPerTx: bigint;
  maxLtvBps: number;
  collateralOracle: Address;
  borrowOracle: Address;
  maxPriceAgeSec: number;
};

/** Transfer sub-domain config — mirrors the contract's `TransferConfig` struct. */
export type DefiBundleTransferConfig = {
  recipients: Address[];
  tokens: Address[];
  maxAmountPerTx: bigint;
};

/**
 * Params for SharedDeFiBundlePermission.
 *
 * Matches the on-chain `_applyConfig` decode exactly:
 *   abi.decode(params, (SwapConfig, BorrowConfig, TransferConfig))
 */
export type DefiBundleParams = {
  swap: DefiBundleSwapConfig;
  borrow: DefiBundleBorrowConfig;
  transfer: DefiBundleTransferConfig;
};

const SWAP_COMPONENTS = [
  { name: "routers", type: "address[]" },
  { name: "tokensIn", type: "address[]" },
  { name: "tokensOut", type: "address[]" },
  { name: "maxAmountPerTx", type: "uint256" },
  { name: "maxSlippageBps", type: "uint256" },
  { name: "priceOracle", type: "address" },
  { name: "maxPriceAgeSec", type: "uint256" },
] as const;

const BORROW_COMPONENTS = [
  { name: "protocols", type: "address[]" },
  { name: "assets", type: "address[]" },
  { name: "maxAmountPerTx", type: "uint256" },
  { name: "maxLtvBps", type: "uint256" },
  { name: "collateralOracle", type: "address" },
  { name: "borrowOracle", type: "address" },
  { name: "maxPriceAgeSec", type: "uint256" },
] as const;

const TRANSFER_COMPONENTS = [
  { name: "recipients", type: "address[]" },
  { name: "tokens", type: "address[]" },
  { name: "maxAmountPerTx", type: "uint256" },
] as const;

const ABI = [
  { name: "swap", type: "tuple", components: SWAP_COMPONENTS },
  { name: "borrow", type: "tuple", components: BORROW_COMPONENTS },
  { name: "transfer", type: "tuple", components: TRANSFER_COMPONENTS },
] as const;

export const defiBundleTemplate: PermissionTemplate<DefiBundleParams> = {
  name: "SharedDeFiBundlePermission",
  address: "0x0000000000000000000000000000000000000000",

  encoder: {
    encode(params: DefiBundleParams): Hex {
      return encodeAbiParameters(ABI, [
        {
          routers: params.swap.routers,
          tokensIn: params.swap.tokensIn,
          tokensOut: params.swap.tokensOut,
          maxAmountPerTx: params.swap.maxAmountPerTx,
          maxSlippageBps: BigInt(params.swap.maxSlippageBps),
          priceOracle: params.swap.priceOracle,
          maxPriceAgeSec: BigInt(params.swap.maxPriceAgeSec),
        },
        {
          protocols: params.borrow.protocols,
          assets: params.borrow.assets,
          maxAmountPerTx: params.borrow.maxAmountPerTx,
          maxLtvBps: BigInt(params.borrow.maxLtvBps),
          collateralOracle: params.borrow.collateralOracle,
          borrowOracle: params.borrow.borrowOracle,
          maxPriceAgeSec: BigInt(params.borrow.maxPriceAgeSec),
        },
        {
          recipients: params.transfer.recipients,
          tokens: params.transfer.tokens,
          maxAmountPerTx: params.transfer.maxAmountPerTx,
        },
      ]);
    },
    decode(data: Hex): DefiBundleParams {
      const [swap, borrow, transfer] = decodeAbiParameters(ABI, data);
      return {
        swap: {
          routers: [...swap.routers],
          tokensIn: [...swap.tokensIn],
          tokensOut: [...swap.tokensOut],
          maxAmountPerTx: swap.maxAmountPerTx,
          maxSlippageBps: Number(swap.maxSlippageBps),
          priceOracle: swap.priceOracle,
          maxPriceAgeSec: Number(swap.maxPriceAgeSec),
        },
        borrow: {
          protocols: [...borrow.protocols],
          assets: [...borrow.assets],
          maxAmountPerTx: borrow.maxAmountPerTx,
          maxLtvBps: Number(borrow.maxLtvBps),
          collateralOracle: borrow.collateralOracle,
          borrowOracle: borrow.borrowOracle,
          maxPriceAgeSec: Number(borrow.maxPriceAgeSec),
        },
        transfer: {
          recipients: [...transfer.recipients],
          tokens: [...transfer.tokens],
          maxAmountPerTx: transfer.maxAmountPerTx,
        },
      };
    },
  },

  explainer: {
    explain(params: DefiBundleParams): MandateExplanation {
      const warnings: string[] = [];
      if (params.swap.maxSlippageBps > 100) {
        warnings.push(`High swap slippage tolerance: ${params.swap.maxSlippageBps / 100}%`);
      }
      if (params.borrow.maxLtvBps > 8000) {
        warnings.push(`High borrow LTV cap: ${params.borrow.maxLtvBps / 100}%`);
      }
      if (params.borrow.protocols.length > 0 && params.swap.routers.length > 0) {
        warnings.push("Bundle permits both borrowing and swapping — review leverage exposure");
      }
      return {
        templateName: "SharedDeFiBundlePermission",
        humanReadable: [
          `Swap — routers: ${params.swap.routers.join(", ") || "none"}; max/tx: ${params.swap.maxAmountPerTx.toString()}; slippage: ${params.swap.maxSlippageBps / 100}%`,
          `Borrow — protocols: ${params.borrow.protocols.join(", ") || "none"}; max/tx: ${params.borrow.maxAmountPerTx.toString()}; LTV: ${params.borrow.maxLtvBps / 100}%`,
          `Transfer — recipients: ${params.transfer.recipients.join(", ") || "none"}; max/tx: ${params.transfer.maxAmountPerTx.toString()}`,
        ],
        warnings,
      };
    },
  },
};
