/**
 * Strategy parameters and contract addresses for your agent.
 *
 * Put your token addresses, protocol contracts, amounts, and other
 * constants here. Import them into agent.ts.
 *
 * For a worked example (DCA / USDC→WETH / Uniswap V3 / Base):
 *   see examples/dca/mandate.ts
 *
 * For protocol-specific permission examples (Uniswap, Aave, GMX, …):
 *   see examples/permissions/
 */

// TODO: replace with your strategy's parameters.
// Example structure:
//
// import type { Address } from "@sail.money/sailor/sdk";
//
// export const INPUT_TOKEN: Address = "0x...";   // token you're spending
// export const OUTPUT_TOKEN: Address = "0x...";  // token you're acquiring
// export const MAX_AMOUNT_PER_TICK = 0n;         // in input token base units
// export const PROTOCOL_CONTRACT: Address = "0x..."; // target contract
