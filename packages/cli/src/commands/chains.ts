import { chains } from "@sail/sdk";
import { http, createPublicClient } from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { emit } from "../lib/output.js";

export interface ChainsOptions {
  verify?: boolean;
  json?: boolean;
}

/**
 * `sailor chains [--verify] [--json]` — list all chains supported by this
 * Sailor build with their SailKernel deployment addresses.
 *
 * With `--verify`, checks each chain that has an RPC URL configured (via
 * RPC_URL, BASE_RPC_URL, ARBITRUM_RPC_URL, etc. in .sail/.env.local or the
 * shell). Chains without a configured RPC are listed as "no RPC" — each chain
 * requires its own endpoint.
 */
export async function chainsCommand(options: ChainsOptions = {}): Promise<void> {
  const entries = Object.values(chains);

  const results = await Promise.all(
    entries.map(async (cfg) => {
      if (!options.verify) return { ...cfg, verified: undefined, rpcUrl: undefined, error: undefined };

      const rpcUrl = getRpcUrl(cfg.chainId);
      if (!rpcUrl) {
        return { ...cfg, verified: null, rpcUrl: null, error: "no RPC configured" };
      }

      try {
        const client = createPublicClient({
          chain: getChainById(cfg.chainId),
          transport: http(rpcUrl),
        });
        const code = await client.getCode({ address: cfg.kernel as `0x${string}` });
        return { ...cfg, verified: !!code && code !== "0x", rpcUrl, error: null };
      } catch (err) {
        const message = (err as Error).message.split("\n")[0];
        console.error(`[chain ${cfg.chainId}] RPC unreachable (${rpcUrl}): ${message}`);
        return { ...cfg, verified: null, rpcUrl, error: message };
      }
    }),
  );

  emit(
    options.json,
    () => {
      console.log("Supported chains");
      console.log("────────────────────────────────────────────────────────────────");
      for (const r of results) {
        let status = "";
        if (options.verify) {
          status =
            r.verified === true
              ? "  ✓ deployed"
              : r.verified === false
                ? "  ✗ not found"
                : r.error === "no RPC configured"
                  ? "  – no RPC configured"
                  : "  ? unreachable";
        }
        console.log(`  ${r.name.padEnd(16)} (${String(r.chainId).padEnd(8)}) ${r.dispatchModel}${status}`);
        console.log(`    kernel:          ${r.kernel}`);
        console.log(`    mandateFactory:  ${r.mandateFactory}`);
        console.log(`    governance:      ${r.governance}`);
      }
      console.log("────────────────────────────────────────────────────────────────");
      if (options.verify) {
        console.log("✓ deployed  ✗ not found  ? RPC unreachable  – no RPC configured");
        console.log("Set RPC_URL or per-chain vars (BASE_RPC_URL, ARBITRUM_RPC_URL, …) in .sail/.env.local to verify more chains.");
      }
    },
    results,
  );
}
