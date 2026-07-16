/** Reads RPC_URL and CHAIN_ID from environment (set via .sail/.env.local or GitHub Secrets). */
export function getEnvConfig(): { rpcUrl: string; chainId: number } {
  const rpcUrl = process.env["RPC_URL"];
  if (!rpcUrl) {
    throw new Error(
      "RPC_URL is not set.\n" +
        "Add RPC_URL to .sail/.env.local or set it as an environment variable.",
    );
  }

  if (!process.env["CHAIN_ID"]) {
    throw new Error(
      "CHAIN_ID is not set.\n" +
        "Open this folder in your AI coding assistant and say 'start' — Stage 1 will ask\n" +
        "which chain you want and set CHAIN_ID in .sail/.env.local.",
    );
  }
  const chainId = Number(process.env["CHAIN_ID"]);
  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid CHAIN_ID: ${process.env["CHAIN_ID"]}`);
  }

  return { rpcUrl, chainId };
}
