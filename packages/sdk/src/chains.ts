import type { ChainConfig } from "./types.js";

/**
 * Registry of live SailKernel deployments, keyed by EVM chainId.
 *
 * All entries were updated to the CREATE2-deterministic deployment (gitCommit
 * 1199b33) in which every core contract lands at the same address on every chain.
 * Add new chains here as SailKernel is deployed on additional networks.
 */
export const chains: Record<number, ChainConfig> = {
  // Ethereum mainnet
  1: {
    chainId: 1,
    name: "Ethereum",
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33).
    kernel: "0x02ABC18B65A328de2e749F56ba79ACF2718a6659",
    mandateFactory: "0x14EDd6c2a56EfC0d71E215ab13094B9AF90543d2",
    governance: "0x7A478118715791728BDE3bc7A4D7ECfdEB89C6EC",
    dispatchModel: "selective",
    protocols: {},
  },
  // Base mainnet
  8453: {
    chainId: 8453,
    name: "Base",
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33).
    // Supersedes 0x6319d3dfDDe3804ba93D65752b00c52bFb05a1ab (SAIL-405).
    kernel: "0x02ABC18B65A328de2e749F56ba79ACF2718a6659",
    mandateFactory: "0x14EDd6c2a56EfC0d71E215ab13094B9AF90543d2",
    governance: "0x7A478118715791728BDE3bc7A4D7ECfdEB89C6EC",
    dispatchModel: "selective",
    protocols: {},
  },
  // Arbitrum mainnet
  42161: {
    chainId: 42161,
    name: "Arbitrum",
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33).
    // Supersedes 0x2716B12832DED0EF5688519c5Fe069EFc0374E02 (SAIL-405).
    kernel: "0x02ABC18B65A328de2e749F56ba79ACF2718a6659",
    mandateFactory: "0x14EDd6c2a56EfC0d71E215ab13094B9AF90543d2",
    governance: "0x7A478118715791728BDE3bc7A4D7ECfdEB89C6EC",
    dispatchModel: "selective",
    protocols: {},
  },
  // Unichain mainnet
  130: {
    chainId: 130,
    name: "Unichain",
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33).
    // Supersedes 0xD985029960a9B7C2E7E38e102C448b8b8539B156 (SAIL-406).
    kernel: "0x02ABC18B65A328de2e749F56ba79ACF2718a6659",
    mandateFactory: "0x14EDd6c2a56EfC0d71E215ab13094B9AF90543d2",
    governance: "0x7A478118715791728BDE3bc7A4D7ECfdEB89C6EC",
    dispatchModel: "selective",
    protocols: {},
  },
  // Base Sepolia (testnet)
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33).
    // Supersedes 0xf1D0F4C9893612627409948BAa9d82a01a373799 (SAIL-405).
    kernel: "0x02ABC18B65A328de2e749F56ba79ACF2718a6659",
    mandateFactory: "0x14EDd6c2a56EfC0d71E215ab13094B9AF90543d2",
    governance: "0x7A478118715791728BDE3bc7A4D7ECfdEB89C6EC",
    dispatchModel: "selective",
    protocols: {},
  },
  // Eth Sepolia (testnet)
  11155111: {
    chainId: 11155111,
    name: "Eth Sepolia",
    // CREATE2 deterministic deploy (2026-06-09, gitCommit 1199b33).
    kernel: "0x02ABC18B65A328de2e749F56ba79ACF2718a6659",
    mandateFactory: "0x14EDd6c2a56EfC0d71E215ab13094B9AF90543d2",
    governance: "0x7A478118715791728BDE3bc7A4D7ECfdEB89C6EC",
    dispatchModel: "selective",
    protocols: {},
  },
};

/** Returns the ChainConfig for a given chainId, or throws if unsupported. */
export function getChain(chainId: number): ChainConfig {
  const config = chains[chainId];
  if (!config) {
    throw new Error(
      `Chain ${chainId} is not supported. Supported chains: 1 (Ethereum), 8453 (Base), 42161 (Arbitrum), 130 (Unichain), 84532 (Base Sepolia), 11155111 (Eth Sepolia).`,
    );
  }
  return config;
}
