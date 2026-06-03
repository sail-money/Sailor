import type { ChainConfig } from "@sail/sdk";

export type { ChainConfig };

/**
 * Registry of live SailKernel deployments, keyed by EVM chainId.
 *
 * Addresses verified on-chain against each kernel's DISPATCH_TYPEHASH.
 * Add new chains here as SailKernel is deployed on additional networks.
 */
export const chains: Record<number, ChainConfig> = {
  // Base Sepolia (testnet)
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    // Post-Octane redeploy w/ genesis allowlist bootstrap + createAccount fix (deployed 2026-06-03).
    // Kernel computes the proxy CREATE2 address locally (Safe 1.4.1 has no view predictor).
    // allowlistBootstrapped=true; createAccount verified working on-chain — onboarding is live.
    kernel: "0xcC50009115DAaBCB40513e03a1a0Cc2Fdf6Be558",
    mandateFactory: "0x862224538a85E4D90835A7082C01f1ec0CdD10cC",
    governance: "0xE69D24766Be634f890F4fE5DF9DdDcdc0EE48112",
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    protocols: {},
  },
  // Base mainnet
  8453: {
    chainId: 8453,
    name: "Base",
    // Bootstrap redeploy (2026-06-03) — fixed kernel, allowlists bootstrapped at genesis, zero fees
    kernel: "0x20eff0DbE752e22655A6dAA5A94521FA06CDdE06",
    mandateFactory: "0x3992106495818E4037e698B8Eb09B452cEfE87F2",
    governance: "0x690e7Ab3CEB5e3E1c3aC05f79a025429B589F6Cc",
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    protocols: {},
  },
  // Arbitrum mainnet
  42161: {
    chainId: 42161,
    name: "Arbitrum",
    // Bootstrap redeploy (2026-06-03) — fixed kernel, allowlists bootstrapped at genesis, zero fees
    kernel: "0x9AF32E0C395fb31f5cA28994351F8fAE3003e125",
    mandateFactory: "0x0E8138dA9175B02Db15cb221497A663BA0807553",
    governance: "0xb37a203CfdF8CA5e904f3637ef6258aaDA291091",
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    protocols: {},
  },
};

/** Returns the ChainConfig for a given chainId, or throws if unsupported. */
export function getChain(chainId: number): ChainConfig {
  const config = chains[chainId];
  if (!config) {
    throw new Error(
      `Chain ${chainId} is not yet supported. Add it to @sail/chains once SailKernel is deployed.`,
    );
  }
  return config;
}
