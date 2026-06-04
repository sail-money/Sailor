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
    // SAIL-405 redeploy (2026-06-04, gitCommit 6d872e6) — adds owner-gated
    // setManager(newManager) to rotate the delegated signer. Genesis allowlist
    // bootstrap + createAccount fix carried over; allowlistBootstrapped=true,
    // zero fees. Supersedes 0xcC50009115DAaBCB40513e03a1a0Cc2Fdf6Be558.
    kernel: "0xf1D0F4C9893612627409948BAa9d82a01a373799",
    mandateFactory: "0xdfF6a2272F667cDf78Af4681b9c88A219998db95",
    governance: "0xEaD44bC6999E7b00b9b2E11c1660248DC2a30993",
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    protocols: {},
  },
  // Base mainnet
  8453: {
    chainId: 8453,
    name: "Base",
    // SAIL-405 redeploy (2026-06-04, gitCommit 0ed0561) — adds owner-gated
    // setManager(newManager) to rotate the delegated signer. Genesis allowlist
    // bootstrap carried over; allowlistBootstrapped=true, zero fees.
    // Supersedes 0x20eff0DbE752e22655A6dAA5A94521FA06CDdE06.
    kernel: "0x6319d3dfDDe3804ba93D65752b00c52bFb05a1ab",
    mandateFactory: "0x7724EACd97C8601d5AC244Aadbf76ad87353Ff31",
    governance: "0x7E897D919872b1587577617ffFC42113679d0C50",
    dispatchModel: "selective", // selective: verified on-chain DISPATCH_TYPEHASH 0xbe50c5391dcf9e08d11d2c30dbee822c14ad07af2ceb503c778d265801fb0e5c
    protocols: {},
  },
  // Arbitrum mainnet
  42161: {
    chainId: 42161,
    name: "Arbitrum",
    // SAIL-405 redeploy (2026-06-04, gitCommit 0ed0561) — adds owner-gated
    // setManager(newManager) to rotate the delegated signer. Genesis allowlist
    // bootstrap carried over (bootstrap sent as a standalone tx post-core-deploy);
    // allowlistBootstrapped=true, zero fees.
    // Supersedes 0x9AF32E0C395fb31f5cA28994351F8fAE3003e125.
    kernel: "0x2716B12832DED0EF5688519c5Fe069EFc0374E02",
    mandateFactory: "0x23681A8A4C9819D8EaB37E46B858da6F3c85E683",
    governance: "0xd6AbB7A1036ADc7958Abffec9Da03450c5a2Ec8e",
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
