import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SigningResponse, SigningTxRequest, SigningTypedDataRequest } from "@sail/sdk";
import type { Address } from "viem";
import { SigningServer, reapStaleRuntimeState } from "./server.js";

const RUNTIME_SERVER_FILE = join(".sail", "runtime", "server.json");

export type SigningRequestInput =
  | Omit<SigningTxRequest, "id" | "createdAt">
  | Omit<SigningTypedDataRequest, "id" | "createdAt">;

/**
 * Common surface shared by the in-process {@link SigningServer} and the remote
 * {@link SigningClient}, so a command can talk to either an ephemeral server it
 * owns or a persistent daemon (`sailor station start`) in another process.
 */
export interface SigningChannel {
  readonly url: string;
  /** True when this channel talks to a separate, already-running daemon. */
  readonly remote: boolean;
  start(): Promise<void>;
  stop(): void;
  requestSignature(req: SigningRequestInput, timeoutMs?: number): Promise<SigningResponse>;
  waitForWallet(timeoutMs?: number): Promise<Address>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Talks to a running signing daemon over its HTTP control plane. Used when a
 * command finds a `sailor station` daemon for this project, so signing routes
 * through the already-open browser UI instead of spawning a second server.
 */
export class SigningClient implements SigningChannel {
  readonly remote = true;

  constructor(
    private readonly baseUrl: string,
    private readonly requestSecret: string = "",
  ) {}

  get url(): string {
    return this.baseUrl;
  }

  async start(): Promise<void> {
    if (!(await this.ping())) {
      throw new Error(`Signing station not reachable at ${this.baseUrl}`);
    }
  }

  /** No-op: never tear down a daemon the user is running in another process. */
  stop(): void {}

  async ping(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/config`, { signal: AbortSignal.timeout(1_500) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async requestSignature(
    req: SigningRequestInput,
    timeoutMs = 10 * 60 * 1000,
  ): Promise<SigningResponse> {
    const enqueueRes = await fetch(`${this.baseUrl}/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sailor-secret": this.requestSecret },
      body: JSON.stringify(req),
    });
    if (!enqueueRes.ok) {
      throw new Error(`Failed to enqueue signing request (HTTP ${enqueueRes.status})`);
    }
    const { id } = (await enqueueRes.json()) as { id: string };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // The server long-polls (~25s) and returns 204 to ask us to re-poll.
      // Secret header required since /requests/:id/result is now auth-gated.
      const res = await fetch(`${this.baseUrl}/requests/${encodeURIComponent(id)}/result`, {
        headers: { "x-sailor-secret": this.requestSecret },
      });
      if (res.status === 200) return (await res.json()) as SigningResponse;
      if (res.status !== 204) {
        throw new Error(`Unexpected result status ${res.status} from signing station`);
      }
    }
    throw new Error(`Signing request "${req.title}" timed out after ${timeoutMs / 1000}s`);
  }

  async waitForWallet(timeoutMs = 5 * 60 * 1000): Promise<Address> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        // Secret header required since /wallet is now auth-gated.
        const r = await fetch(`${this.baseUrl}/wallet`, {
          headers: { "x-sailor-secret": this.requestSecret },
          signal: AbortSignal.timeout(2_000),
        });
        if (r.ok) {
          const { address } = (await r.json()) as { address: Address | null };
          if (address) return address;
        }
      } catch {
        // station may be momentarily unreachable; keep polling
      }
      await sleep(1_000);
    }
    throw new Error("Timed out waiting for wallet connection in the signing UI");
  }
}

type RuntimeServerState = { url?: string; port?: number; pid?: number; requestSecret?: string };

/**
 * Rewrite `localhost` to `127.0.0.1` for CLI-side network calls. The station
 * binds 127.0.0.1 only, but Node's fetch (undici) may resolve `localhost` to
 * ::1 first and fail with ECONNREFUSED (observed on Node 18), which made every
 * command miss a healthy daemon and silently spawn a hidden ephemeral server.
 * Browser-facing URLs keep `localhost` — browsers fall back across families,
 * and the daemon's origin-trust checks compare against its localhost identity.
 */
function toLoopbackIPv4(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function readRuntimeServerState(projectRoot: string): RuntimeServerState | null {
  const file = join(projectRoot, RUNTIME_SERVER_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as RuntimeServerState;
  } catch {
    return null;
  }
}

/**
 * The URL a user should open to approve this channel's signing requests.
 * Always uses the project dashboard port — the hash route distinguishes
 * the station view from the main dashboard.
 */
export function signingPageUrl(dashboardPort: number): string {
  return `http://localhost:${dashboardPort}/#/station`;
}

/** Return a {@link SigningClient} for a reachable daemon, or null if none runs. */
export async function discoverDaemon(
  projectRoot: string = process.cwd(),
): Promise<SigningClient | null> {
  const state = readRuntimeServerState(projectRoot);
  if (!state?.url) return null;
  const client = new SigningClient(toLoopbackIPv4(state.url), state.requestSecret ?? "");
  return (await client.ping()) ? client : null;
}

/**
 * Resolve the signing channel a command should use:
 *  - a running `sailor station` daemon if one is reachable (preferred), or
 *  - a fresh ephemeral in-process {@link SigningServer} otherwise.
 *
 * Either way the caller does `await channel.start()` up front and
 * `channel.stop()` in a finally — both are no-ops for the remote daemon.
 */
export async function createSigningChannel(
  projectRoot: string = process.cwd(),
): Promise<SigningChannel> {
  // Clear any orphaned descriptor (crashed predecessor) before discovery so we
  // neither route to a dead server nor refuse to advertise because of stale state.
  reapStaleRuntimeState(projectRoot);
  const daemon = await discoverDaemon(projectRoot);
  if (daemon) return daemon;
  // Ephemeral fallback: advertise a discoverable runtime descriptor so the
  // dashboard's /#/station page can find this server and display the pending
  // request — otherwise the operator sees nothing to approve. Reaching this
  // branch means no daemon was discoverable, so there is no daemon state to
  // clobber; SigningServer.stop() removes the descriptor only if it still points
  // at this process (pid-guarded), so a daemon that starts later is never evicted.
  return new SigningServer({ projectRoot, advertise: true });
}
