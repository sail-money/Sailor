import { keccak256, type PublicClient, type TypedDataDomain } from "viem";
import type { Account, Address, Chain, Hex, Transport, WalletClient } from "viem";
import type { DispatchModel, KernelCapabilities } from "./capabilities.js";
import { detectKernelCapabilities } from "./capabilities.js";
import type { SerializedTypedData } from "./signing.js";
import type { ILocalKeyring } from "./types.js";

/** EIP-712 domain for the SailKernel on a given chain. */
export function sailKernelDomain(args: { chainId: number; kernel: Address }): TypedDataDomain {
  return {
    name: "SailKernel",
    version: "1",
    chainId: args.chainId,
    verifyingContract: args.kernel,
  };
}

// ── Dispatch signing ─────────────────────────────────────────────────────────

/**
 * EIP-712 Dispatch struct field lists, keyed by dispatch model.
 *
 * This is the canonical definition used by BOTH `buildDispatchSignature` (the
 * public helper) and `SailorClient.dispatch.single()` (the internal path) — a
 * single source of truth that makes it impossible for the two paths to diverge.
 * Selective kernels include the `permission` field; conjunctive kernels do not.
 */
export const DISPATCH_EIP712_FIELDS = {
  selective: [
    { name: "account",    type: "address" },
    { name: "permission", type: "address" },
    { name: "target",     type: "address" },
    { name: "value",      type: "uint256" },
    { name: "dataHash",   type: "bytes32" },
    { name: "nonce",      type: "uint256" },
    { name: "deadline",   type: "uint256" },
  ],
  conjunctive: [
    { name: "account",  type: "address" },
    { name: "target",   type: "address" },
    { name: "value",    type: "uint256" },
    { name: "dataHash", type: "bytes32" },
    { name: "nonce",    type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Default dispatch deadline: 10 minutes from now (unix seconds). */
const DEFAULT_DISPATCH_DEADLINE_SECS = 600;

/** Minimal ABI for reading the on-chain manager nonce. */
const MANAGER_NONCES_ABI = [
  {
    type: "function",
    name: "managerNonces",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Build a signed EIP-712 Dispatch payload for a SailKernel manager dispatch.
 *
 * ### Why there is no `model` / `dispatchModel` parameter
 *
 * The Phase 1 incident established that the single most dangerous mistake an
 * operator can make is using the wrong dispatch model. The conjunctive struct
 * (6 fields, no `permission`) and the selective struct (7 fields, with
 * `permission`) produce different EIP-712 digests; signing the wrong one
 * recovers a random address and reverts with `InvalidManagerSignature()`.
 *
 * This function reads the on-chain `DISPATCH_TYPEHASH` from the kernel before
 * signing — the correct struct is selected automatically regardless of what the
 * caller believes the model to be. Callers cannot supply a model override; if
 * the on-chain read fails (bad RPC, wrong kernel address), the function throws
 * a clear error rather than signing blindly against an assumed model.
 *
 * @example
 * ```ts
 * const { signature, nonce, deadline } = await buildDispatchSignature({
 *   publicClient,
 *   kernel: "0x6319d3df...",
 *   chainId: 8453,
 *   account: mySafe,
 *   permission: myPermission,
 *   call: { target: router, value: 0n, data: swapCalldata },
 *   manager: myKeyring,
 * });
 * // Then submit: kernel.dispatch(account, permission, target, value, data, signature, deadline)
 * ```
 */
export async function buildDispatchSignature(params: {
  /** viem public client bound to the kernel's chain. */
  publicClient: PublicClient;
  /** Deployed SailKernel address. */
  kernel: Address;
  /** EVM chain id — required for the EIP-712 domain separator. */
  chainId: number;
  /** The Safe (SMA) account executing the dispatch. */
  account: Address;
  /**
   * The registered permission that authorises this call.
   * Required by selective kernels — the `permission` field is part of the
   * signed struct and the kernel rejects dispatches that name an
   * unregistered permission.
   */
  permission: Address;
  /** The call to execute: target contract, ETH value (wei), and calldata. */
  call: { target: Address; value: bigint; data: Hex };
  /** Manager key (the agent's hot key) that will sign the dispatch. */
  manager: ILocalKeyring;
  /**
   * Signature deadline as a Unix timestamp (seconds).
   * Defaults to now + 600 s (10 minutes).
   */
  deadline?: bigint;
  /**
   * Manager nonce to sign with.
   * Defaults to the current on-chain `managerNonces[account]` value.
   * Pass an explicit value when submitting sequential dispatches whose
   * nonce ordering you control.
   */
  nonce?: bigint;
}): Promise<{
  /** Raw EIP-712 signature bytes — pass directly to `kernel.dispatch`. */
  signature: Hex;
  /** The nonce that was signed (on-chain value or explicit override). */
  nonce: bigint;
  /** The deadline that was signed (unix seconds). */
  deadline: bigint;
  /**
   * The dispatch model detected from the on-chain DISPATCH_TYPEHASH.
   * Informational — the correct struct was already selected for this signature.
   */
  dispatchModel: DispatchModel;
}> {
  const { publicClient, kernel, chainId, account, permission, call, manager } = params;

  // 1. Detect model — reads DISPATCH_TYPEHASH from the live kernel; cached
  //    per (chainId, kernel) so repeated calls within a session are cheap.
  const caps: KernelCapabilities = await detectKernelCapabilities(publicClient, kernel, {
    chainId,
  });

  // 2. Resolve nonce — use caller-supplied value or read from chain.
  const nonce: bigint =
    params.nonce ??
    ((await publicClient.readContract({
      address: kernel,
      abi: MANAGER_NONCES_ABI,
      functionName: "managerNonces",
      args: [account],
    })) as bigint);

  // 3. Set deadline.
  const deadline: bigint =
    params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DISPATCH_DEADLINE_SECS);

  // 4. Build EIP-712 typed-data message. Selective kernels include `permission`
  //    in the signed struct; conjunctive kernels do not.
  const dataHash = keccak256(call.data);
  const selective = caps.dispatchModel === "selective";
  const message: Record<string, unknown> = selective
    ? { account, permission, target: call.target, value: call.value, dataHash, nonce, deadline }
    : { account, target: call.target, value: call.value, dataHash, nonce, deadline };

  // 5. Sign.
  const signature = await manager.signTyped(
    sailKernelDomain({ chainId, kernel }),
    {
      primaryType: "Dispatch",
      types: {
        Dispatch: DISPATCH_EIP712_FIELDS[caps.dispatchModel] as unknown as {
          name: string;
          type: string;
        }[],
      },
    },
    message,
  );

  return { signature, nonce, deadline, dispatchModel: caps.dispatchModel };
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
 * All bundled kernels (Base, Base Sepolia, Arbitrum) are now selective and include
 * the deadline field. This flag exists for older or custom kernels that predate the
 * selective model. detectKernelCapabilities resolves this from the on-chain REGISTER_PERMISSION_TYPEHASH.
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
 * EIP-712 types for RegisterPermissions (batch) — selective kernel. Mirrors the
 * shape SailorClient.mandate.attachBatch signs and the on-chain
 * registerPermissions(account, permissions[], deadline, sig) entry point.
 */
export const REGISTER_PERMISSIONS_BATCH_TYPES = {
  RegisterPermissions: [
    { name: "account", type: "address" },
    { name: "permissions", type: "address[]" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Build a JSON-serializable RegisterPermissions (batch) typed-data payload for
 * the browser signing station — the re-approval step after a manager rotation,
 * which rebinds every previously-attached mandate to the new delegated signer in
 * a single owner signature + tx. Bigints are stringified for transport.
 */
export function buildRegisterPermissionsBatchTypedData(args: {
  chainId: number;
  kernel: Address;
  account: Address;
  permissions: Address[];
  nonce: bigint;
  /** Signature deadline (unix seconds). Defaults to 10 minutes from now. */
  deadline?: bigint;
}): SerializedTypedData {
  const deadline = args.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 600);
  return {
    domain: {
      name: "SailKernel",
      version: "1",
      chainId: args.chainId,
      verifyingContract: args.kernel,
    },
    types: REGISTER_PERMISSIONS_BATCH_TYPES as unknown as SerializedTypedData["types"],
    primaryType: "RegisterPermissions",
    message: {
      account: args.account,
      permissions: args.permissions,
      nonce: args.nonce.toString(),
      deadline: deadline.toString(),
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
