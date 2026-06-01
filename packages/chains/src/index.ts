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
    kernel: "0x7d3BDAAB150af93f057C38e9baef88061B17dE1D",
    mandateFactory: "0x14D35766C6d8f8F21e86d122d788d0218026f93f",
    governance: "0xd289CcbA0302fB819F68056526e2B495b033895d",
    protocols: {},
  },
  // Base mainnet
  8453: {
    chainId: 8453,
    name: "Base",
    kernel: "0xbEd6F78c6d89547Fb9B43d599621dd80ce57F154",
    mandateFactory: "0xc3FFb7128bc95B5e3a3268f6E168c331FF13fE07",
    governance: "0x255147f05C1CB0bA33d0bA6025Ea6E55598CF985",
    protocols: {},
  },
  // Arbitrum mainnet
  42161: {
    chainId: 42161,
    name: "Arbitrum",
    kernel: "0xD985029960a9B7C2E7E38e102C448b8b8539B156",
    mandateFactory: "0x8edDb62Aa49CeB837abf2653be2d93Ad9Fe6777D",
    governance: "0xAb5C90ECfF2763f6f20f8E553E3b8778dD9C349A",
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
