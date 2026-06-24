import { spawnSync } from "node:child_process";

/**
 * Thin wrappers around the `tailscale` CLI for the opt-in HTTPS station exposure
 * (F9). The dashboard/station is local-only by default; passing
 * `sailor ui start --expose tailscale` proxies it onto the tailnet over HTTPS so
 * a remote operator (e.g. a hermes box) can reach the signing station.
 *
 * Everything here shells out to a user-installed `tailscale` binary and is
 * best-effort: callers surface actionable errors and otherwise keep the local
 * server running. We use `tailscale serve` (tailnet-private), never `funnel`
 * (which would publish a signing surface to the public internet).
 */

/** True if the `tailscale` CLI is on PATH and runnable. */
export function tailscaleAvailable(): boolean {
  try {
    return spawnSync("tailscale", ["version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/**
 * The node's MagicDNS name (e.g. "hermes.tailnet-1234.ts.net"), or null if
 * tailscale isn't running/logged-in or the name can't be resolved.
 */
export function tailnetDnsName(): string | null {
  const r = spawnSync("tailscale", ["status", "--json"], { encoding: "utf-8" });
  if (r.status !== 0 || !r.stdout) return null;
  try {
    const j = JSON.parse(r.stdout) as { BackendState?: string; Self?: { DNSName?: string } };
    if (j.BackendState && j.BackendState !== "Running") return null;
    const dns = j.Self?.DNSName;
    if (typeof dns !== "string" || dns.length === 0) return null;
    return dns.replace(/\.$/, ""); // strip the trailing dot MagicDNS includes
  } catch {
    return null;
  }
}

/**
 * Proxy `https://<node>.<tailnet>.ts.net/` → `http://127.0.0.1:<port>` on the
 * tailnet (HTTPS :443), running in the background so it outlives this CLI
 * invocation. Throws with the tailscale stderr on failure.
 */
export function tailscaleServeUp(port: number): void {
  const r = spawnSync(
    "tailscale",
    ["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || "").trim() || `exit ${r.status ?? "?"}`;
    throw new Error(detail);
  }
}

/** Remove the HTTPS :443 serve handler. Best-effort; ignores errors. */
export function tailscaleServeDown(): void {
  try {
    spawnSync("tailscale", ["serve", "--https=443", "off"], { stdio: "ignore" });
  } catch {
    /* best-effort teardown */
  }
}
