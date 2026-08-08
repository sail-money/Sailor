/**
 * LEGACY helper for standalone scripts that need a single RPC + chain from the environment.
 * `sailor run` does NOT use this — it gets its chain(s) from the active strategy
 * (see the sailor-strategy skill). Kept only for one-off scripts; not on the runner path.
 */
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
        "This legacy helper needs CHAIN_ID only for standalone scripts — set it in .sail/.env.local.\n" +
        "`sailor run` does not use it; the chain(s) come from your active strategy.",
    );
  }
  const chainId = Number(process.env["CHAIN_ID"]);
  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid CHAIN_ID: ${process.env["CHAIN_ID"]}`);
  }

  return { rpcUrl, chainId };
}
