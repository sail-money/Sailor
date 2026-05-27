import { type Address, type Hex, encodeFunctionData, zeroAddress } from "viem";

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
