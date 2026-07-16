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
  startedAt?: string;
  ready: boolean;
  status?: "ready" | "spawning" | "failed";
  error?: string;
  requestedAt?: string;
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
