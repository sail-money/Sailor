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

/** EIP-712 type definition for a single-permission registration. */
export const REGISTER_PERMISSION_TYPES = {
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
 */
export function buildRegisterPermissionTypedData(args: {
  chainId: number;
  kernel: Address;
  account: Address;
  permission: Address;
  nonce: bigint;
}): SerializedTypedData {
  return {
    domain: {
      name: "SailKernel",
      version: "1",
      chainId: args.chainId,
      verifyingContract: args.kernel,
    },
    types: REGISTER_PERMISSION_TYPES as unknown as SerializedTypedData["types"],
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
 */
export async function signRegisterPermission(args: {
  walletClient: WalletClient<Transport, Chain, Account>;
  chainId: number;
  kernel: Address;
  account: Address;
  permission: Address;
  nonce: bigint;
}): Promise<Hex> {
  return args.walletClient.signTypedData({
    domain: sailKernelDomain({ chainId: args.chainId, kernel: args.kernel }),
    types: REGISTER_PERMISSION_TYPES,
    primaryType: "RegisterPermission",
    message: {
      account: args.account,
      permission: args.permission,
      nonce: args.nonce,
    },
  });
}
