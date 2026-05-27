import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SigningResponse, SigningTxRequest, SigningTypedDataRequest } from "@sail/sdk";
import type { Address } from "viem";
import { SigningServer } from "./server.js";

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

  constructor(private readonly baseUrl: string) {}

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!enqueueRes.ok) {
      throw new Error(`Failed to enqueue signing request (HTTP ${enqueueRes.status})`);
    }
    const { id } = (await enqueueRes.json()) as { id: string };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // The server long-polls (~25s) and returns 204 to ask us to re-poll.
      const res = await fetch(`${this.baseUrl}/requests/${encodeURIComponent(id)}/result`);
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
        const r = await fetch(`${this.baseUrl}/wallet`, { signal: AbortSignal.timeout(2_000) });
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

type RuntimeServerState = { url?: string; port?: number; pid?: number };

function readRuntimeServerState(projectRoot: string): RuntimeServerState | null {
  const file = join(projectRoot, RUNTIME_SERVER_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as RuntimeServerState;
  } catch {
    return null;
  }
}

/** Return a {@link SigningClient} for a reachable daemon, or null if none runs. */
export async function discoverDaemon(
  projectRoot: string = process.cwd(),
): Promise<SigningClient | null> {
  const state = readRuntimeServerState(projectRoot);
  if (!state?.url) return null;
  const client = new SigningClient(state.url);
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
  const daemon = await discoverDaemon(projectRoot);
  if (daemon) return daemon;
  // Ephemeral fallback: do not advertise, so it can't clobber a daemon's
  // runtime state on a discovery race.
  return new SigningServer({ projectRoot, advertise: false });
}
