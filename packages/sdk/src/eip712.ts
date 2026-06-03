import type { Account, Address, Chain, Hex, Transport, TypedDataDomain, WalletClient } from "viem";
import type { SerializedTypedData } from "./signing.js";

/** EIP-712 domain for the SailKernel on a given chain. */
export function sailKernelDomain(args: { chainId: number; kernel: Address }): TypedDataDomain {
  return {
    name: "SailKernel",
    version: "1",
    chainId: args.chainId,
    verifyingContract: args.kernel,
  };
}

/**
 * EIP-712 types for RegisterPermission — selective kernel (withDeadline variant).
 * Used when detectKernelCapabilities reports registerPermissionHasDeadline = true.
 */
export const REGISTER_PERMISSION_TYPES = {
  RegisterPermission: [
    { name: "account", type: "address" },
    { name: "permission", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * EIP-712 types for RegisterPermission — conjunctive kernel (noDeadline variant).
 * Used when detectKernelCapabilities reports registerPermissionHasDeadline = false.
 */
export const REGISTER_PERMISSION_TYPES_NO_DEADLINE = {
  RegisterPermission: [
    { name: "account", type: "address" },
    { name: "permission", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/**
 * Build a JSON-serializable RegisterPermission typed-data payload for the
 * browser signing station. Bigints are stringified so it survives transport;
 * the UI re-parses decimal-string fields before signing.
 *
 * Pass `hasDeadline` from KernelCapabilities.registerPermissionHasDeadline.
 * The active Base (8453) and Base Sepolia (84532) kernels are conjunctive and
 * do NOT include deadline; Arbitrum (42161) is selective and DOES include it.
 * detectKernelCapabilities resolves this from the on-chain REGISTER_PERMISSION_TYPEHASH.
 */
export function buildRegisterPermissionTypedData(args: {
  chainId: number;
  kernel: Address;
  account: Address;
  permission: Address;
  nonce: bigint;
  /**
   * Whether the kernel's RegisterPermission type includes a deadline field.
   * Read from KernelCapabilities.registerPermissionHasDeadline.
   * Defaults to false (conjunctive, no deadline) — the safer choice when unknown,
   * since including an unexpected field causes an on-chain signature mismatch.
   */
  hasDeadline?: boolean;
  /** Signature deadline (unix seconds). Only used when hasDeadline = true. Defaults to 5 minutes from now. */
  deadline?: bigint;
}): SerializedTypedData {
  const hasDeadline = args.hasDeadline ?? false;
  const domain = {
    name: "SailKernel",
    version: "1",
    chainId: args.chainId,
    verifyingContract: args.kernel,
  };

  if (hasDeadline) {
    const deadline = args.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 300);
    return {
      domain,
      types: REGISTER_PERMISSION_TYPES as unknown as SerializedTypedData["types"],
      primaryType: "RegisterPermission",
      message: {
        account: args.account,
        permission: args.permission,
        nonce: args.nonce.toString(),
        deadline: deadline.toString(),
      },
    };
  }

  return {
    domain,
    types: REGISTER_PERMISSION_TYPES_NO_DEADLINE as unknown as SerializedTypedData["types"],
    primaryType: "RegisterPermission",
    message: {
      account: args.account,
      permission: args.permission,
      nonce: args.nonce.toString(),
    },
  };
}

/**
 * Sign a RegisterPermission message directly with a wallet client. Used by
 * headless flows (tests / scripts) where the owner's key is local rather than
 * in a browser. The browser path uses buildRegisterPermissionTypedData instead.
 *
 * Pass `hasDeadline` from KernelCapabilities.registerPermissionHasDeadline.
 */
export async function signRegisterPermission(args: {
  walletClient: WalletClient<Transport, Chain, Account>;
  chainId: number;
  kernel: Address;
  account: Address;
  permission: Address;
  nonce: bigint;
  /** Whether the kernel's RegisterPermission type includes a deadline field. Defaults to false. */
  hasDeadline?: boolean;
  /** Signature deadline (unix seconds). Only used when hasDeadline = true. Defaults to 5 minutes from now. */
  deadline?: bigint;
}): Promise<Hex> {
  const hasDeadline = args.hasDeadline ?? false;
  const domain = sailKernelDomain({ chainId: args.chainId, kernel: args.kernel });

  if (hasDeadline) {
    const deadline = args.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 300);
    return args.walletClient.signTypedData({
      domain,
      types: REGISTER_PERMISSION_TYPES,
      primaryType: "RegisterPermission",
      message: {
        account: args.account,
        permission: args.permission,
        nonce: args.nonce,
        deadline,
      },
    });
  }

  return args.walletClient.signTypedData({
    domain,
    types: REGISTER_PERMISSION_TYPES_NO_DEADLINE,
    primaryType: "RegisterPermission",
    message: {
      account: args.account,
      permission: args.permission,
      nonce: args.nonce,
    },
  });
}
