import { SailorClient } from "@sail/sdk";

/** Reads RPC_URL and CHAIN_ID from environment (set via .sail/.env.local or GitHub Secrets). */
export function getEnvConfig(): { rpcUrl: string; chainId: number } {
  const rpcUrl = process.env["RPC_URL"];
  if (!rpcUrl) {
    throw new Error(
      "RPC_URL is not set.\n" +
        "Run the Sailor wizard (open this folder in your LLM tool and say 'start') or\n" +
        "add RPC_URL to .sail/.env.local manually.",
    );
  }

  const chainId = Number(process.env["CHAIN_ID"] ?? "8453"); // Default: Base mainnet
  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid CHAIN_ID: ${process.env["CHAIN_ID"]}`);
  }

  return { rpcUrl, chainId };
}

/** Builds a SailorClient from environment config. */
export function createClient(): SailorClient {
  const { rpcUrl, chainId } = getEnvConfig();
  // SailorClient constructor is not implemented yet — this is illustrative.
  return new SailorClient({ rpcUrl, chainId });
}
