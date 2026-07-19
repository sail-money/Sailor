/**
 * `<sandboxDir>/forks.json` — the sandbox fork manifest.
 *
 * ChainId-keyed record of every fork belonging to one project's sandbox
 * environment. Written by the sandbox fork engine, read by the onboarding
 * wizard (to poll readiness) and the sandbox server's `/api/sandbox/forks`
 * route.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ManifestEntry = {
  chainId: number;
  chain: string;
  rpcUrl?: string;
  port?: number;
  pid?: number;
  stateFile?: string;
  startedAt?: string;
  ready: boolean;
  status?: "ready" | "spawning" | "failed" | "stopped";
  error?: string;
  requestedAt?: string;
  /** True when this fork's port was already live at startup — adopted, not
   *  spawned; there's no pid we own, so `resetSandbox` won't try to kill it. */
  adopted?: boolean;
  /** True for the chain that owns the sandbox's generic RPC_URL/CHAIN_ID pair
   *  (as opposed to its RPC_URL_<chainId> entry, which every chain gets) —
   *  restart uses this to decide whether to keep repointing it. */
  primary?: boolean;
  /** Saved-state file that couldn't be loaded yet because the fork was still
   *  booting — settled (loaded + cleared) by refreshSandboxForks when the
   *  fork turns ready. See ForkState.pendingStateLoad. */
  pendingStateLoad?: string;
};

export const manifestPath = (sandboxDir: string) => join(sandboxDir, "forks.json");

export function readManifest(sandboxDir: string): Record<string, ManifestEntry> {
  try {
    return JSON.parse(readFileSync(manifestPath(sandboxDir), "utf8"));
  } catch {
    return {};
  }
}

export function writeManifest(sandboxDir: string, manifest: Record<string, ManifestEntry>): void {
  mkdirSync(sandboxDir, { recursive: true });
  writeFileSync(manifestPath(sandboxDir), JSON.stringify(manifest, null, 2) + "\n");
}
