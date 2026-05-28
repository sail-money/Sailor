/**
 * Kernel capability detection.
 *
 * The Sail Protocol kernel has shipped in two incompatible dispatch models, and
 * a given chain may run either one:
 *
 *  - "conjunctive" (older): dispatch(account, target, value, data, sig, deadline)
 *      with NO permission argument; the kernel checks EVERY registered permission
 *      and ALL must approve. The signed EIP-712 Dispatch struct has no `permission`
 *      field. RegisterPermission has no `deadline` field.
 *
 *  - "selective" (newer): dispatch(account, permission, target, value, data, sig, deadline)
 *      naming ONE permission per call. The signed Dispatch struct includes `permission`.
 *
 * The SDK's typed-data and calldata must match whatever is actually deployed, or
 * every dispatch reverts with InvalidManagerSignature. Rather than guess from a
 * version string, we read the kernel's public EIP-712 typehash constants on-chain
 * and match them against the canonical hashes for each model. Results are cached
 * per kernel address.
 */

import { type Address, keccak256, type PublicClient, toBytes } from "viem";

/** Which dispatch model a deployed kernel implements. */
export type DispatchModel = "conjunctive" | "selective";

/** Canonical EIP-712 type strings for each known kernel version. */
export const DISPATCH_TYPE_STRINGS = {
  conjunctive:
    "Dispatch(address account,address target,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)",
  selective:
    "Dispatch(address account,address permission,address target,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)",
} as const;

export const REGISTER_PERMISSION_TYPE_STRINGS = {
  noDeadline: "RegisterPermission(address account,address permission,uint256 nonce)",
  withDeadline:
    "RegisterPermission(address account,address permission,uint256 nonce,uint256 deadline)",
} as const;

/** Precomputed typehashes (keccak256 of the canonical type strings). */
export const DISPATCH_TYPEHASHES = {
  conjunctive: keccak256(toBytes(DISPATCH_TYPE_STRINGS.conjunctive)),
  selective: keccak256(toBytes(DISPATCH_TYPE_STRINGS.selective)),
} as const;

export const REGISTER_PERMISSION_TYPEHASHES = {
  noDeadline: keccak256(toBytes(REGISTER_PERMISSION_TYPE_STRINGS.noDeadline)),
  withDeadline: keccak256(toBytes(REGISTER_PERMISSION_TYPE_STRINGS.withDeadline)),
} as const;

/** Detected capabilities of a deployed kernel. */
export type KernelCapabilities = {
  /** Kernel address these capabilities were detected for. */
  kernel: Address;
  /** Dispatch model the kernel implements. */
  dispatchModel: DispatchModel;
  /** Whether kernel.dispatch takes a `permission` argument (true for selective). */
  dispatchHasPermissionParam: boolean;
  /** Whether the signed Dispatch EIP-712 struct includes a `permission` field. */
  dispatchSignsPermission: boolean;
  /** Whether RegisterPermission's EIP-712 struct includes a `deadline` field. */
  registerPermissionHasDeadline: boolean;
  /** The on-chain DISPATCH_TYPEHASH that was read (or computed) for reference. */
  dispatchTypehash: `0x${string}`;
  /** The on-chain REGISTER_PERMISSION_TYPEHASH, when readable. */
  registerPermissionTypehash?: `0x${string}`;
  /** How the model was determined. */
  source: "onchain-typehash" | "static-hint";
};

/** Minimal ABI for the kernel's public typehash constant getters. */
const TYPEHASH_GETTER_ABI = [
  {
    type: "function",
    name: "DISPATCH_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "REGISTER_PERMISSION_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const cache = new Map<string, KernelCapabilities>();

function cacheKey(chainId: number, kernel: Address): string {
  return `${chainId}:${kernel.toLowerCase()}`;
}

/**
 * Build capabilities from a known DISPATCH_TYPEHASH. Throws if the typehash does
 * not match any known kernel version (a loud failure beats silently signing the
 * wrong struct).
 */
function fromDispatchTypehash(
  kernel: Address,
  dispatchTypehash: `0x${string}`,
  registerPermissionTypehash: `0x${string}` | undefined,
  source: KernelCapabilities["source"],
): KernelCapabilities {
  let dispatchModel: DispatchModel;
  if (dispatchTypehash === DISPATCH_TYPEHASHES.conjunctive) {
    dispatchModel = "conjunctive";
  } else if (dispatchTypehash === DISPATCH_TYPEHASHES.selective) {
    dispatchModel = "selective";
  } else {
    throw new Error(
      `Unrecognized kernel DISPATCH_TYPEHASH ${dispatchTypehash} for ${kernel}. ` +
        "The SDK cannot safely sign dispatches for this kernel version. " +
        `Known: conjunctive=${DISPATCH_TYPEHASHES.conjunctive}, selective=${DISPATCH_TYPEHASHES.selective}.`,
    );
  }

  // Infer RegisterPermission deadline support from its typehash when available,
  // else fall back to the per-model default (conjunctive shipped without it).
  let registerPermissionHasDeadline = dispatchModel === "selective";
  if (registerPermissionTypehash === REGISTER_PERMISSION_TYPEHASHES.withDeadline) {
    registerPermissionHasDeadline = true;
  } else if (registerPermissionTypehash === REGISTER_PERMISSION_TYPEHASHES.noDeadline) {
    registerPermissionHasDeadline = false;
  }

  const selective = dispatchModel === "selective";
  return {
    kernel,
    dispatchModel,
    dispatchHasPermissionParam: selective,
    dispatchSignsPermission: selective,
    registerPermissionHasDeadline,
    dispatchTypehash,
    registerPermissionTypehash,
    source,
  };
}

/**
 * Detect a kernel's dispatch model by reading its on-chain typehash constants.
 *
 * @param publicClient viem public client bound to the kernel's chain
 * @param kernel       deployed SailKernel address
 * @param opts.chainId chain id for cache keying (defaults to publicClient.chain.id)
 * @param opts.staticModel optional hint used only if the on-chain read fails
 * @param opts.force   bypass the per-kernel cache
 */
export async function detectKernelCapabilities(
  publicClient: PublicClient,
  kernel: Address,
  opts?: { chainId?: number; staticModel?: DispatchModel; force?: boolean },
): Promise<KernelCapabilities> {
  const chainId = opts?.chainId ?? publicClient.chain?.id ?? 0;
  const key = cacheKey(chainId, kernel);
  if (!opts?.force) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  let dispatchTypehash: `0x${string}` | undefined;
  let registerPermissionTypehash: `0x${string}` | undefined;

  try {
    dispatchTypehash = (await publicClient.readContract({
      address: kernel,
      abi: TYPEHASH_GETTER_ABI,
      functionName: "DISPATCH_TYPEHASH",
    })) as `0x${string}`;
  } catch {
    // getter absent / not a typehash-exposing kernel — handled below
  }

  try {
    registerPermissionTypehash = (await publicClient.readContract({
      address: kernel,
      abi: TYPEHASH_GETTER_ABI,
      functionName: "REGISTER_PERMISSION_TYPEHASH",
    })) as `0x${string}`;
  } catch {
    // optional — model is determined by DISPATCH_TYPEHASH alone
  }

  let caps: KernelCapabilities;
  if (dispatchTypehash) {
    caps = fromDispatchTypehash(
      kernel,
      dispatchTypehash,
      registerPermissionTypehash,
      "onchain-typehash",
    );
  } else if (opts?.staticModel) {
    // Could not read the typehash; fall back to the caller-supplied hint.
    caps = fromDispatchTypehash(
      kernel,
      DISPATCH_TYPEHASHES[opts.staticModel],
      undefined,
      "static-hint",
    );
  } else {
    throw new Error(
      `Could not read DISPATCH_TYPEHASH from kernel ${kernel}, and no staticModel hint was given. ` +
        "Pass opts.staticModel ('conjunctive' | 'selective') to proceed without on-chain detection.",
    );
  }

  cache.set(key, caps);
  return caps;
}

/** Clear the capability cache (mainly for tests / forced re-detection). */
export function clearCapabilityCache(): void {
  cache.clear();
}
