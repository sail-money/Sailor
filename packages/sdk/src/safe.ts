import {
  type Address,
  type Hex,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getCreate2Address,
  keccak256,
  pad,
  zeroAddress,
} from "viem";

/** Minimal SailKernel ABI fragment for the manager-rotation call. */
const setManagerAbi = [
  {
    type: "function",
    name: "setManager",
    stateMutability: "nonpayable",
    inputs: [{ name: "newManager", type: "address" }],
    outputs: [],
  },
] as const;

/**
 * Safe v1.4.1 `execTransaction` — the entry point through which the Safe calls
 * another contract *as itself* (msg.sender == Safe). Full ABI:
 * https://github.com/safe-global/safe-deployments/tree/main/src/assets/v1.4.1
 */
export const gnosisSafeExecAbi = [
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

/**
 * Minimal Safe contract ABI — only what's needed to encode the setup
 * initializer. Full ABI: https://github.com/safe-global/safe-deployments
 */
export const gnosisSafeAbi = [
  {
    type: "function",
    name: "setup",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_owners", type: "address[]" },
      { name: "_threshold", type: "uint256" },
      { name: "to", type: "address" },
      { name: "data", type: "bytes" },
      { name: "fallbackHandler", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "payment", type: "uint256" },
      { name: "paymentReceiver", type: "address" },
    ],
    outputs: [],
  },
] as const;

/**
 * SafeModuleEnabler — `enable(module)` is delegatecalled via Safe.setup's
 * `to`/`data` hook to enable a module on a freshly deployed Safe in the same
 * transaction. Deployed once per chain (SailDeployment.safeModuleEnabler).
 */
export const safeModuleEnablerAbi = [
  {
    type: "function",
    name: "enable",
    stateMutability: "nonpayable",
    inputs: [{ name: "module", type: "address" }],
    outputs: [],
  },
] as const;

/**
 * Canonical Safe v1.4.1 deployment addresses (CREATE2 — same on all EVM chains).
 * https://github.com/safe-global/safe-deployments/tree/main/src/assets/v1.4.1
 */
export const SAFE_V141 = {
  proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  singletonL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
} as const;

/**
 * Build the `Safe.setup()` initializer for a Safe that will be registered with
 * SailKernel via `kernel.createAccount()`.
 *
 * Wires the `to`/`data` delegatecall hook to the SafeModuleEnabler so the
 * kernel is enabled as a Safe module *during* setup. Without this, the kernel's
 * `createAccount` reverts with `ModuleNotEnabled()` after deploying the Safe.
 */
export function buildSafeSetupInitializer(params: {
  owners: Address[];
  threshold: bigint;
  kernel: Address;
  safeModuleEnabler: Address;
  fallbackHandler?: Address;
}): Hex {
  const enableModuleData = encodeFunctionData({
    abi: safeModuleEnablerAbi,
    functionName: "enable",
    args: [params.kernel],
  });

  return encodeFunctionData({
    abi: gnosisSafeAbi,
    functionName: "setup",
    args: [
      params.owners,
      params.threshold,
      params.safeModuleEnabler, // to: delegatecall target
      enableModuleData, // data: enable(kernel)
      (params.fallbackHandler ?? SAFE_V141.fallbackHandler) as Address,
      zeroAddress, // paymentToken
      0n, // payment
      zeroAddress, // paymentReceiver
    ],
  });
}

/**
 * Build a Safe "pre-validated" (approved-hash) signature for `owner`.
 *
 * Safe's `checkNSignatures` treats a signature with `v == 1` as pre-validated:
 * it passes when the recovered owner address (`r`, left-padded to 32 bytes) is
 * either the `msg.sender` or has previously called `approveHash`. So when the
 * sole owner of a 1-of-1 Safe submits `execTransaction` themselves, this 65-byte
 * blob authorises the call with NO off-chain Safe-tx EIP-712 signature and no
 * dependency on the Safe nonce. Layout: r = owner(32) ‖ s = 0(32) ‖ v = 1(1).
 */
export function buildApprovedHashSignature(owner: Address): Hex {
  return encodePacked(
    ["bytes32", "bytes32", "uint8"],
    [pad(owner, { size: 32 }), pad("0x", { size: 32 }), 1],
  );
}

/** ABI for SafeProxyFactory.proxyCreationCode() — pure view returning SafeProxy creation bytecode. */
export const safeProxyFactoryAbi = [
  {
    type: "function",
    name: "proxyCreationCode",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

/**
 * Compute the CREATE2 address SafeProxyFactory.createProxyWithNonce() assigns.
 *
 * Factory formula (from SafeProxyFactory source):
 *   initCode     = proxyCreationCode ++ abi.encode(singleton)
 *   salt         = keccak256(keccak256(initializer) ++ uint256(saltNonce))
 *   deployedAddr = CREATE2(factory, salt, keccak256(initCode))
 *
 * `proxyCreationCode` must be read once from the factory via `safeProxyFactoryAbi`;
 * it is identical on every chain since SAFE_V141.proxyFactory is the same address everywhere.
 *
 * NOTE: the `initializer` encodes chain-specific addresses (kernel, safeModuleEnabler)
 * via `buildSafeSetupInitializer`. Different initializers per chain → different CREATE2 salts
 * → different deployed addresses, even with the same `saltNonce`. Cross-chain same-address
 * requires the Sail Protocol to deploy kernel + safeModuleEnabler at identical addresses on
 * every chain (deterministic CREATE2 deployment), or a registerExisting() flow that
 * accepts a plain Safe deployed with a chain-agnostic initializer.
 */
export function computeSafeProxyAddress(params: {
  initializer: Hex;
  saltNonce: bigint;
  proxyCreationCode: Hex;
}): Address {
  const { initializer, saltNonce, proxyCreationCode } = params;
  const initCodeHash = keccak256(
    concat([
      proxyCreationCode,
      encodeAbiParameters([{ type: "address" }], [SAFE_V141.singletonL2 as Address]),
    ]),
  );
  const salt = keccak256(
    encodePacked(["bytes32", "uint256"], [keccak256(initializer), saltNonce]),
  );
  return getCreate2Address({
    from: SAFE_V141.proxyFactory as Address,
    salt,
    bytecodeHash: initCodeHash,
  });
}

/** ABI-encode the kernel's `setManager(newManager)` call. */
export function encodeSetManager(newManager: Address): Hex {
  return encodeFunctionData({
    abi: setManagerAbi,
    functionName: "setManager",
    args: [newManager],
  });
}

/**
 * Build the `Safe.execTransaction` calldata that rotates an SMA's delegated
 * signer by calling `kernel.setManager(newManager)` *as the Safe*.
 *
 * `setManager` is gated by `msg.sender == account`, so it cannot be sent
 * straight from the owner's EOA (as createAccount/dispatch are) — it must be
 * wrapped in a Safe transaction. For the 1-of-1 Safes Sailor creates, the owner
 * submits this tx from their own wallet and authorises it with a pre-validated
 * signature (see `buildApprovedHashSignature`); no separate Safe-tx signing
 * round-trip is needed. Returns the tx the owner sends: `{ to: safe, data }`.
 */
export function buildSetManagerExecTransaction(params: {
  /** The SMA (Safe) whose manager is being rotated; also the tx `to`. */
  safe: Address;
  /** The SailKernel the Safe will call. */
  kernel: Address;
  /** The new delegated signer (manager) address. */
  newManager: Address;
  /** The sole Safe owner who will submit this tx. */
  owner: Address;
}): { to: Address; data: Hex } {
  const innerData = encodeSetManager(params.newManager);
  const data = encodeFunctionData({
    abi: gnosisSafeExecAbi,
    functionName: "execTransaction",
    args: [
      params.kernel, // to
      0n, // value
      innerData, // data: setManager(newManager)
      0, // operation: Call
      0n, // safeTxGas
      0n, // baseGas
      0n, // gasPrice
      zeroAddress, // gasToken
      zeroAddress, // refundReceiver
      buildApprovedHashSignature(params.owner),
    ],
  });
  return { to: params.safe, data };
}
