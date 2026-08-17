import { readManifest } from "@sail/sandbox";
import { sailDir } from "./io.js";

/** Canonical host for comparison — `localhost` and `127.0.0.1` are the same loopback. */
function canonicalHost(hostname: string): string {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" ? "127.0.0.1" : host;
}

function rpcKey(rpcUrl: string): string | null {
  try {
    const parsed = new URL(rpcUrl);
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    return `${parsed.protocol}//${canonicalHost(parsed.hostname)}:${port}`;
  } catch {
    return null;
  }
}

/**
 * True when `rpcUrl` is a fork this sandbox already recorded in `forks.json`.
 * Live `.sail/` has no manifest (or an empty one), so this is a no-op there.
 */
export function isRecordedSandboxForkRpc(rpcUrl: string, dir: string = sailDir()): boolean {
  const want = rpcKey(rpcUrl);
  if (!want) return false;
  const manifest = readManifest(dir);
  return Object.values(manifest).some((entry) => {
    if (!entry.rpcUrl) return false;
    return rpcKey(entry.rpcUrl) === want;
  });
}

/**
 * Validate an RPC URL to prevent SSRF against internal endpoints (e.g. AWS IMDS
 * at 169.254.169.254) via a crafted .env.local.
 *
 * Loopback / private hosts are blocked unless:
 *   - `SAILOR_ALLOW_LOCAL_RPC` is set, or
 *   - the URL is a fork recorded in the current SAIL_DIR's `forks.json`
 *     (Shipyard). That second path is how `sailor run` talks to anvil without
 *     asking the operator to set the override.
 */
export function assertSafeRpcUrl(rpcUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error(`RPC_URL is not a valid URL: ${rpcUrl}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`RPC_URL must use http or https — got: ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const blockedName = host === "localhost" || host.endsWith(".localhost");
  const blockedV4 =
    /^(169\.254\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|127\.\d+\.\d+\.\d+|0\.0\.0\.0)$/.test(
      host,
    );
  const blockedV6 = /^(::1?|::ffff:127\.|f[cd][0-9a-f]{2}:|fe80:)/.test(host);
  if (!(blockedName || blockedV4 || blockedV6)) return;
  if (process.env.SAILOR_ALLOW_LOCAL_RPC) return;
  if (isRecordedSandboxForkRpc(rpcUrl)) return;
  throw new Error(
    `RPC_URL hostname "${parsed.hostname}" is a private or link-local address. ` +
      "Set SAILOR_ALLOW_LOCAL_RPC=1 to allow local RPC endpoints (dev only).",
  );
}
