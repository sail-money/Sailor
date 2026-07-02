import fs from "node:fs";
import path from "node:path";
import { chains } from "@sail/sdk";
import { writeIfMissing } from "./template.js";

/**
 * Scaffolds the secret-bearing parts of a Sailor project workspace — the
 * `.sail/` dirs, `config.json`, and the `.env.example` / `.sail/.env.local`
 * templates. Shared by `sailor init` (fresh scaffold) and `sailor clone`
 * (rebuild the local workspace a published template deliberately omits), so the
 * two can never drift.
 */

export interface WorkspaceScaffoldOptions {
  chain?: string;
  rpcUrl?: string;
}

export const SAIL_WORKSPACE_README = `# Sailor Project Workspace

This folder is the local workspace for one Sailor agent deployment.

## Layout

- \`config.json\` is the project manifest: name, chain, and state location.
- \`keys/\` stores encrypted local signing keys. Never commit these files.
- \`runtime/\` is for local UI and signing handoff state.
- \`state/\` is for persistent agent state, audit logs, and tx history.

AI coding agents should read the project's \`AGENTS.md\` and this folder's \`config.json\`
before changing strategy code or running commands that touch funds.
`;

/**
 * Create `.sail/{keys,runtime,state}`, write `config.json`, `.env.example`, and
 * `.sail/.env.local`. `preserveConfig` keeps an existing `.sail/config.json`
 * (clone ships a sanitized one already) instead of overwriting it.
 */
export function scaffoldProjectWorkspace(
  dest: string,
  name: string,
  options: WorkspaceScaffoldOptions = {},
  preserveConfig = false,
): void {
  const chainId: number | null = options.chain
    ? (() => {
        const n = Number(options.chain);
        if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid chain id: "${options.chain}"`);
        return n;
      })()
    : null;

  const sailDir = path.join(dest, ".sail");
  fs.mkdirSync(path.join(sailDir, "keys"), { recursive: true });
  fs.mkdirSync(path.join(sailDir, "runtime"), { recursive: true });
  fs.mkdirSync(path.join(sailDir, "state"), { recursive: true });

  const configPath = path.join(sailDir, "config.json");
  if (!(preserveConfig && fs.existsSync(configPath))) {
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          name,
          chainId, // null = chain not yet chosen; Stage 1 will set this
          stateDir: ".sail/state",
          createdAt: new Date().toISOString(),
          contracts: {
            kernel: "",
            mandateFactory: "",
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
  }

  writeIfMissing(path.join(sailDir, "README.md"), SAIL_WORKSPACE_README);

  // Build per-chain var lines from the SDK registry — stays in sync when chains are added.
  const chainEntries = Object.values(chains);
  const perChainVarLines = chainEntries
    .map(
      (c) => `# ${c.rpcEnvVar}=https://your-${c.name.toLowerCase().replace(/\s+/g, "-")}-endpoint`,
    )
    .join("\n");

  const chainIdExample =
    chainId != null
      ? `CHAIN_ID=${chainId}`
      : "# CHAIN_ID=8453   # set after choosing your chain in Stage 1";
  fs.writeFileSync(
    path.join(dest, ".env.example"),
    `# Sailor agent environment
#
# RPC configuration — two patterns, pick one:
#
# Option A: single active chain (simplest)
RPC_URL=https://your-rpc-endpoint
${chainIdExample}
#
# Option B: per-chain endpoints (multi-chain projects, or if you prefer explicit names)
# Set CHAIN_ID to the chain sailor run uses; omit RPC_URL if all chains have a specific var.
${perChainVarLines}

# Optional: non-interactive passphrase (CI, GitHub Actions, launchd, systemd)
# SAIL_PASSPHRASE=change-me-to-a-strong-passphrase
`,
    "utf-8",
  );

  const rpcUrlLine = options.rpcUrl
    ? `RPC_URL=${options.rpcUrl}`
    : "# RPC_URL=https://your-rpc-endpoint";
  const chainIdLine =
    chainId != null ? `CHAIN_ID=${chainId}` : "# CHAIN_ID=8453   # set after choosing your chain";
  const allChainVarLines = chainEntries
    .map((c) => {
      const isActive = c.chainId === chainId;
      const val =
        isActive && options.rpcUrl
          ? options.rpcUrl
          : `https://your-${c.name.toLowerCase().replace(/\s+/g, "-")}-endpoint`;
      return isActive && options.rpcUrl ? `${c.rpcEnvVar}=${val}` : `# ${c.rpcEnvVar}=${val}`;
    })
    .join("\n");
  fs.writeFileSync(
    path.join(sailDir, ".env.local"),
    `# Real values — never commit this file.
#
# Option A: single active chain (simplest)
${rpcUrlLine}
${chainIdLine}
#
# Option B: per-chain endpoints (multi-chain or explicit names; omit RPC_URL if every chain has its own var)
${allChainVarLines}

# Optional: non-interactive passphrase (CI, GitHub Actions, launchd, systemd)
# SAIL_PASSPHRASE=change-me-to-a-strong-passphrase
`,
    "utf-8",
  );
}
