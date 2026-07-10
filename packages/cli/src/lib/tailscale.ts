import { spawnSync } from "node:child_process";

/**
 * Thin wrappers around the `tailscale` CLI for the opt-in HTTPS exposure of the
 * dashboard (F9). The dashboard/signer is local-only by default; passing
 * `sailor ui start --expose tailscale` proxies it onto the tailnet over HTTPS so
 * a remote operator (e.g. a hermes box) can reach the signing page.
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
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) {
    throw new Error(out.trim() || `exit ${r.status ?? "?"}`);
  }
  // `tailscale serve` exits 0 even when Serve is disabled on the tailnet — it
  // applies nothing and just prints an "enable" link. Treat that as a failure so
  // the caller surfaces the link instead of falsely reporting the dashboard as
  // exposed (F21).
  if (/serve is not enabled/i.test(out)) {
    throw new Error(out.trim());
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
