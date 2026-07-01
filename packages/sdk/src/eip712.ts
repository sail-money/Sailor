import { type PublicClient, type TypedDataDomain, keccak256 } from "viem";
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
    { name: "account", type: "address" },
    { name: "permission", type: "address" },
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "dataHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  conjunctive: [
    { name: "account", type: "address" },
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "dataHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
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
 * EIP-712 types for RegisterAccount (post-#53 two-step onboarding). Mirrors the on-chain
 * REGISTER_ACCOUNT_TYPEHASH:
 *   RegisterAccount(address account,address permissionSigner,address manager,
 *                   address feePolicy,address feeAsset,uint256 deadline)
 * The owner signs this digest; the resulting signature is passed as `ownerSig` to
 * registerAccount, which the Safe submits via execTransaction (so msg.sender == the Safe).
 */
export const REGISTER_ACCOUNT_TYPES = {
  RegisterAccount: [
    { name: "account", type: "address" },
    { name: "permissionSigner", type: "address" },
    { name: "manager", type: "address" },
    { name: "feePolicy", type: "address" },
    { name: "feeAsset", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Build a JSON-serializable RegisterAccount typed-data payload for the browser signing
 * station. The Safe owner signs it; the signature becomes the `ownerSig` arg to
 * registerAccount (submitted via the Safe's execTransaction). Bigints are stringified for
 * transport; the UI re-parses the decimal-string `deadline` before signing.
 *
 * Note (#69): the kernel rejects the Safe v==1 approved-hash shortcut for this ownerSig —
 * build it as a real EOA ECDSA signature over the digest, or the Safe v==0 contract-signature
 * path for contract/nested-Safe owners. Do NOT use buildApprovedHashSignature here.
 */
export function buildRegisterAccountTypedData(args: {
  chainId: number;
  kernel: Address;
  /** The Safe account being registered. */
  account: Address;
  permissionSigner: Address;
  manager: Address;
  feePolicy: Address;
  /** Fee asset (address(0) for the native token). */
  feeAsset?: Address;
  /** Signature deadline (unix seconds). Defaults to 10 minutes from now. */
  deadline?: bigint;
}): SerializedTypedData {
  const deadline = args.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 600);
  const feeAsset = args.feeAsset ?? ("0x0000000000000000000000000000000000000000" as Address);
  return {
    domain: {
      name: "SailKernel",
      version: "1",
      chainId: args.chainId,
      verifyingContract: args.kernel,
    },
    types: REGISTER_ACCOUNT_TYPES as unknown as SerializedTypedData["types"],
    primaryType: "RegisterAccount",
    message: {
      account: args.account,
      permissionSigner: args.permissionSigner,
      manager: args.manager,
      feePolicy: args.feePolicy,
      feeAsset,
      deadline: deadline.toString(),
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

// ── Template configure() signing (version-adaptive: Protocol Octane #2/#8) ────

/**
 * ERC-5267 `eip712Domain()` — read a ConfigurablePermission template's live EIP-712
 * domain so we sign against whatever schema is actually deployed.
 */
const TEMPLATE_EIP712_DOMAIN_ABI = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;

/** SailKernel `registrationEpoch(account, permission)` — the v2 epoch a config binds to. */
const REGISTRATION_EPOCH_ABI = [
  {
    type: "function",
    name: "registrationEpoch",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "permission", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const CONFIGURE_FIELDS_V1 = [
  { name: "account", type: "address" },
  { name: "paramsHash", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;
const CONFIGURE_FIELDS_V2 = [...CONFIGURE_FIELDS_V1, { name: "epoch", type: "uint256" }] as const;

/**
 * Build the EIP-712 typed data for a ConfigurablePermission template's `configure()`,
 * **adapting to whatever schema the deployed template reports** via ERC-5267
 * `eip712Domain()`:
 *   - domain version "1" (pre-epoch-binding templates): the legacy
 *     `Configure(account, paramsHash, nonce, deadline)` struct, domain version "1".
 *   - domain version "2" (Protocol PR #59, Octane #2/#8): adds `epoch`, read from
 *     the kernel's `registrationEpoch(account, template)`, domain version "2".
 *
 * No flag day: the same call signs whichever is on-chain, so it works with the
 * currently-deployed templates today and automatically with the epoch-binding
 * templates once they redeploy.
 *
 * TODO(configure-flow): Sailor does not yet have a flow that *submits* a template
 * `configure()` (the SDK `reconfigure`/`attach`/`replace` are notImplemented, and
 * the launch attach path signs only RegisterPermission). This builder is the
 * version-adaptive seam that flow will use — finish wiring it (CLI/UI →
 * MandateFactory.attach configureSig, or configureDirect) once the epoch-binding
 * templates are deployed, and add an end-to-end test against a live v2 template.
 */
export async function buildConfigureTypedData(args: {
  publicClient: PublicClient;
  /** SailKernel address (source of registrationEpoch for the v2 schema). */
  kernel: Address;
  /** The ConfigurablePermission template instance being configured. */
  template: Address;
  /** The SMA the config applies to. */
  account: Address;
  /** ABI-encoded config blob (from `sdk/src/templates/*` encoders). */
  params: Hex;
  /** Current `template.configNonces(account)`. */
  nonce: bigint;
  /** Signature deadline (unix seconds). */
  deadline: bigint;
}): Promise<SerializedTypedData> {
  const [, name, version, chainId] = (await args.publicClient.readContract({
    address: args.template,
    abi: TEMPLATE_EIP712_DOMAIN_ABI,
    functionName: "eip712Domain",
  })) as [string, string, string, bigint, string, string, readonly bigint[]];

  const isV2 = version === "2";
  const message: Record<string, string | number | boolean | string[]> = {
    account: args.account,
    paramsHash: keccak256(args.params),
    nonce: args.nonce.toString(),
    deadline: args.deadline.toString(),
  };

  if (isV2) {
    const epoch = (await args.publicClient.readContract({
      address: args.kernel,
      abi: REGISTRATION_EPOCH_ABI,
      functionName: "registrationEpoch",
      args: [args.account, args.template],
    })) as bigint;
    message.epoch = epoch.toString();
  }

  return {
    domain: {
      name,
      version,
      chainId: Number(chainId),
      verifyingContract: args.template,
    },
    types: {
      Configure: (isV2 ? CONFIGURE_FIELDS_V2 : CONFIGURE_FIELDS_V1) as unknown as Array<{
        name: string;
        type: string;
      }>,
    },
    primaryType: "Configure",
    message,
  };
}
