/**
 * Strategy parameters and contract addresses for your agent.
 *
 * Put your token addresses, protocol contracts, amounts, and other
 * constants here. Import them into agent.ts.
 *
 * For the strategy-constants pattern (constants read from .sail/strategy.md, fed
 * into the tick loop), see the skeleton in the sailor-agent-build skill.
 *
 * For authoring a bespoke on-chain permission for this strategy's venue:
 *   see contracts/ (the scaffold) and the sailor-mandates skill.
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
