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
    kernel: "0xbEd6F78c6d89547Fb9B43d599621dd80ce57F154",
    mandateFactory: "0xc3FFb7128bc95B5e3a3268f6E168c331FF13fE07",
    governance: "0x255147f05C1CB0bA33d0bA6025Ea6E55598CF985",
    // PENDING post-Octane redeploy — do NOT activate until timelock allowlists are set
    // kernel 0x852553c5ceb0B2c4c429F355fFBB719ECeF6d0d4 | mandateFactory 0x0402b812cCD90608Ca91AdE265082aCa0b8780C8 | governance 0xe88668dEd183ef283A606b0D7f6Dbcc4D3f4639B
    dispatchModel: "conjunctive", // conjunctive: verified on-chain DISPATCH_TYPEHASH 0x7510c80e081cb7da97f59eadd13c9941a013c4a37d514f597bd209c0c746599a
    protocols: {},
  },
  // Arbitrum mainnet
  42161: {
    chainId: 42161,
    name: "Arbitrum",
    kernel: "0xD985029960a9B7C2E7E38e102C448b8b8539B156",
    mandateFactory: "0x8edDb62Aa49CeB837abf2653be2d93Ad9Fe6777D",
    governance: "0xAb5C90ECfF2763f6f20f8E553E3b8778dD9C349A",
    // PENDING post-Octane redeploy — do NOT activate until timelock allowlists are set
    // kernel 0x7542c3BCEd0014C14d79dA9A98Ec043F1ceC63E2 | mandateFactory 0x19BD2629790e602aF22840b37208e44e4F9B0aaE | governance 0xA3ee24e4fB7800c4f4c1481Bd920A4034Dfc34cf
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
