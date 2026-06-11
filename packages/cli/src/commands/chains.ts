import { chains } from "@sail/sdk";
import { http, createPublicClient } from "viem";
import { getChainById } from "../lib/chain.js";
import { parseEnvFile, readJsonFile, sailPath } from "../lib/io.js";
import { emit } from "../lib/output.js";

/**
 * Resolve an RPC for a specific chain in the context of multi-chain verification.
 * Generic RPC_URL is only used for the active chain (matching CHAIN_ID) — using it
 * for other chains would give false positives when all kernels share the same
 * CREATE2 address and only one RPC endpoint is configured.
 */
function resolveVerifyRpc(
  chainId: number,
  activeChainId: number | null,
  env: Record<string, string>,
): string | undefined {
  const varName = chains[chainId]?.rpcEnvVar;

  // Chain-specific var from .env.local
  if (varName && env[varName]?.trim()) return env[varName]!.trim();

  // Generic RPC_URL — only valid for the active chain
  if (chainId === activeChainId && env.RPC_URL?.trim()) return env.RPC_URL.trim();

  // Chain-specific var from shell
  if (varName && process.env[varName]?.trim()) return process.env[varName]!.trim();

  // Generic shell RPC_URL — only valid for the active chain
  if (chainId === activeChainId && process.env.RPC_URL?.trim()) return process.env.RPC_URL.trim();

  return undefined;
}

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

  // Read active chain once — generic RPC_URL is only valid for this chain.
  const env = parseEnvFile(sailPath(".env.local"));
  const configChainId = readJsonFile<{ chainId?: number }>(sailPath("config.json"))?.chainId;
  const activeChainIdRaw = env.CHAIN_ID ?? process.env.CHAIN_ID ?? (configChainId != null ? String(configChainId) : undefined);
  const activeChainId = activeChainIdRaw != null ? Number(activeChainIdRaw) : null;

  const results = await Promise.all(
    entries.map(async (cfg) => {
      if (!options.verify) return { ...cfg, verified: undefined, rpcUrl: undefined, error: undefined };

      const rpcUrl = resolveVerifyRpc(cfg.chainId, activeChainId, env);
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
