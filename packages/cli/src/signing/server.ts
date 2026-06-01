import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { extname, join, resolve } from "node:path";
import type {
  ClientMessage,
  ServerMessage,
  SigningRequest,
  SigningResponse,
  SigningTxRequest,
  SigningTypedDataRequest,
} from "@sail/sdk";
import type { Address, Hex } from "viem";
import { WebSocket, WebSocketServer } from "ws";
import { appendActivity, nowIso } from "../lib/io.js";
import { type StoredAccount, upsertAccountInList } from "../lib/state.js";

export const DEFAULT_SIGNING_PORT = 3141; // π — memorable, thematic
const RUNTIME_SUBDIR = join(".sail", "runtime");
const SERVER_STATE_FILE = "server.json";
const REQUEST_SECRET_HEADER = "x-sailor-secret";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Resolve the built signing UI directory. Tries multiple candidate locations so
 * it works both in the monorepo (tsx/dev) and as an installed npm package.
 */
function findUiDist(): string | null {
  const thisDir = new URL(".", import.meta.url).pathname;
  const candidates = [
    // Installed package: bundled UI sits next to dist as <package-root>/ui-dist
    join(thisDir, "..", "ui-dist"),
    // Monorepo dev: packages/cli/src/signing/ → ../../../ui/dist
    join(thisDir, "..", "..", "..", "ui", "dist"),
    // Monorepo dev via tsx run from the repo root
    join(process.cwd(), "packages", "ui", "dist"),
    join(process.cwd(), "..", "ui", "dist"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "index.html"))) return c;
  }
  return null;
}

type PendingEntry = {
  request: SigningRequest;
  timer: ReturnType<typeof setTimeout>;
};

/** How long the long-poll GET /requests/:id/result holds a connection open. */
const RESULT_LONGPOLL_MS = 25_000;

/**
 * Local HTTP + WebSocket server bridging the CLI agent and the browser signing UI.
 *
 *   const server = new SigningServer({ projectRoot: process.cwd() });
 *   await server.start();
 *   const response = await server.requestSignature({ kind: "deploy-mandate", ... });
 *   server.stop();
 *
 * Wire:
 *   HTTP GET  /config              → { url, wsUrl, port, pid, pendingCount }  (CORS *)
 *   HTTP GET  /pending             → SigningRequest[]
 *   HTTP GET  /wallet              → { address }
 *   HTTP POST /requests            → { id }
 *   HTTP GET  /requests/:id/result → 200 + SigningResponse | 204 re-poll
 *   WS   /                         → server pushes ServerMessage, client sends ClientMessage
 */
export class SigningServer {
  /** This channel owns the server in-process (see SigningChannel). */
  readonly remote = false;

  private readonly projectRoot: string;
  private readonly runtimeDir: string;
  private port: number;
  private _url = "";

  private pending = new Map<string, PendingEntry>();
  private results = new Map<string, SigningResponse>();
  private resultWaiters = new Map<string, Set<(r: SigningResponse) => void>>();
  private clients = new Set<WebSocket>();
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;

  private _connectedWallet: Address | undefined;
  private walletListeners: Array<(addr: Address) => void> = [];

  private readonly uiDist: string | null;
  /**
   * Whether to publish .sail/runtime/server.json (the daemon-discovery hint).
   * The persistent daemon (`sailor station start`) advertises; ephemeral
   * per-command servers do not, so they never clobber a running daemon's state
   * on a discovery race. The browser UI finds servers by port-probing anyway.
   */
  private readonly advertise: boolean;
  /** Random secret generated at startup. Required on POST /requests to prevent
   *  cross-origin pages from injecting signing requests. */
  private requestSecret = "";

  constructor(
    opts: { projectRoot?: string; port?: number; uiDist?: string; advertise?: boolean } = {},
  ) {
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.runtimeDir = join(this.projectRoot, RUNTIME_SUBDIR);
    this.port = opts.port ?? DEFAULT_SIGNING_PORT;
    this.uiDist = opts.uiDist ?? findUiDist();
    this.advertise = opts.advertise ?? true;
  }

  get url(): string {
    return this._url;
  }

  get wsUrl(): string {
    return this._url.replace("http://", "ws://");
  }

  get isRunning(): boolean {
    return this.httpServer?.listening ?? false;
  }

  async start(): Promise<void> {
    this.port = await findAvailablePort(this.port);
    this._url = `http://localhost:${this.port}`;
    this.requestSecret = randomBytes(16).toString("hex");

    const http = createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: http });
    this.wss.on("connection", (ws, req) => {
      // Authenticate WebSocket connections using the requestSecret passed as a
      // query parameter (?secret=...). Browsers freely open WebSocket connections
      // regardless of page origin, so this is the only gate for WS auth.
      const params = new URL(req.url ?? "/", this._url).searchParams;
      if (params.get("secret") !== this.requestSecret) {
        ws.close(1008, "Unauthorized");
        return;
      }
      this.handleConnection(ws);
    });

    await new Promise<void>((res, rej) => {
      http.listen(this.port, "127.0.0.1", res);
      http.once("error", rej);
    });

    this.httpServer = http;
    if (this.advertise) this.writeRuntimeState();

    process.once("SIGINT", () => this.stop());
    process.once("SIGTERM", () => this.stop());
  }

  stop(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.recordResult(
        { status: "rejected", requestId: id, reason: "Signing server stopped" },
        entry.request,
      );
    }
    this.pending.clear();

    for (const ws of this.clients) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();

    this.wss?.close();
    this.httpServer?.close();
    this.httpServer = null;
    if (this.advertise) this.removeRuntimeState();
  }

  get connectedWallet(): Address | undefined {
    return this._connectedWallet;
  }

  /**
   * Resolves as soon as a wallet connects (or immediately if one already is).
   * The CLI calls this before building calldata that needs the owner's address.
   */
  waitForWallet(timeoutMs = 5 * 60 * 1000): Promise<Address> {
    if (this._connectedWallet) return Promise.resolve(this._connectedWallet);
    return new Promise<Address>((res, rej) => {
      const timer = setTimeout(
        () => rej(new Error("Timed out waiting for wallet connection in the signing UI")),
        timeoutMs,
      );
      this.walletListeners.push((addr) => {
        clearTimeout(timer);
        res(addr);
      });
    });
  }

  /**
   * Enqueue a signing request and broadcast it to the UI. Returns the full
   * request (with generated id). Used by both the in-process path and the HTTP
   * control plane (POST /requests).
   */
  enqueue(
    req:
      | Omit<SigningTxRequest, "id" | "createdAt">
      | Omit<SigningTypedDataRequest, "id" | "createdAt">,
    timeoutMs = 10 * 60 * 1000,
  ): SigningRequest {
    const id = `req_${Date.now()}_${randomBytes(6).toString("hex")}`;
    const request = { ...req, id, createdAt: Date.now() } as SigningRequest;

    const timer = setTimeout(() => {
      if (this.pending.has(id)) {
        this.pending.delete(id);
        this.recordResult(
          {
            status: "rejected",
            requestId: id,
            reason: `timed out after ${timeoutMs / 1000}s`,
          },
          request,
        );
      }
    }, timeoutMs);

    this.pending.set(id, { request, timer });
    this.broadcast({ type: "request", request });
    return request;
  }

  /**
   * Resolve once a result for `id` is available (immediately if already
   * resolved). Resolves to `null` if `timeoutMs` elapses first.
   */
  waitForResult(id: string, timeoutMs: number): Promise<SigningResponse | null> {
    const existing = this.results.get(id);
    if (existing) return Promise.resolve(existing);

    return new Promise<SigningResponse | null>((res) => {
      const timer = setTimeout(() => {
        this.resultWaiters.get(id)?.delete(waiter);
        res(null);
      }, timeoutMs);
      const waiter = (r: SigningResponse) => {
        clearTimeout(timer);
        res(r);
      };
      if (!this.resultWaiters.has(id)) this.resultWaiters.set(id, new Set());
      this.resultWaiters.get(id)?.add(waiter);
    });
  }

  /** Push a signing request to the UI and await the user's response (in-process). */
  async requestSignature(
    req:
      | Omit<SigningTxRequest, "id" | "createdAt">
      | Omit<SigningTypedDataRequest, "id" | "createdAt">,
    timeoutMs = 10 * 60 * 1000,
  ): Promise<SigningResponse> {
    const request = this.enqueue(req, timeoutMs);
    const result = await this.waitForResult(request.id, timeoutMs + 2_000);
    if (!result) {
      throw new Error(`Signing request "${request.title}" timed out after ${timeoutMs / 1000}s`);
    }
    return result;
  }

  private recordResult(response: SigningResponse, request?: SigningRequest): void {
    const id = response.requestId;
    // Guard against double-resolution: a concurrent WS message and a timeout
    // firing in the same event loop tick could both try to resolve the same request.
    if (this.results.has(id)) return;
    this.results.set(id, response);
    const waiters = this.resultWaiters.get(id);
    if (waiters) {
      for (const w of waiters) w(response);
      this.resultWaiters.delete(id);
    }
    this.broadcast({ type: "request-resolved", requestId: id });
    setTimeout(() => this.results.delete(id), 10 * 60 * 1000).unref?.();
    this.logOwnerActivity(response, request);
  }

  /**
   * Append the owner's signing decision to the unified activity log. This is
   * the single place every owner action lands — whether the request was
   * approved (a signed tx or an off-chain EIP-712 signature) or rejected — so
   * the dashboard's Recent Activity can show what the owner did, alongside the
   * agent's dispatches. We only log when the originating request is known
   * (its `kind`/`title` give the event meaning); a bare result with no request
   * carries nothing worth showing.
   */
  private logOwnerActivity(response: SigningResponse, request?: SigningRequest): void {
    if (!request) return;
    const base = {
      ts: nowIso(),
      actor: "owner" as const,
      kind: request.kind,
      title: request.title,
      chainId: request.chainId,
    };
    let event: Record<string, unknown>;
    if (response.status === "signed") {
      event = { ...base, type: "owner_signed", txHash: response.txHash };
    } else if (response.status === "signature") {
      // Off-chain authorization (e.g. register-permission): no tx of its own;
      // the agent submits the on-chain tx and logs that separately.
      event = { ...base, type: "owner_signed", offchain: true };
    } else {
      event = { ...base, type: "owner_rejected", reason: response.reason };
    }
    try {
      appendActivity(event, join(this.projectRoot, ".sail"));
    } catch {
      // Activity logging is best-effort — never let it break the signing flow.
    }
  }

  /** Path to `<projectRoot>/.sail/<...segments>`. */
  private sailFile(...segments: string[]): string {
    return join(this.projectRoot, ".sail", ...segments);
  }

  /** Stream a JSON file back, or a fallback body when it is missing/invalid. */
  private sendJsonFile(
    res: ServerResponse,
    filePath: string,
    fallback: { status: number; body: unknown },
  ): void {
    try {
      const raw = readFileSync(filePath, "utf-8");
      JSON.parse(raw); // validate before sending
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(raw);
    } catch {
      res.writeHead(fallback.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(fallback.body));
    }
  }

  /**
   * Persist a Safe deployed/imported from the dashboard. Mirrors the UI data
   * server's `POST /api/account` (packages/ui/server.js): upsert the SMA into
   * `state/accounts.json` (so the account switcher and the agent see it) BEFORE
   * overwriting `account.json` with the new active SMA — the upsert backfills
   * from the previously-active account.json, so writing it first would drop the
   * prior SMA.
   */
  private handleSaveAccount(req: IncomingMessage, res: ServerResponse): void {
    this.readBody(req)
      .then((body) => {
        const parsed = (body ? JSON.parse(body) : {}) as Partial<StoredAccount>;
        const { safe, owner, permissionSigner, manager, chainId, createdAtBlock } = parsed;
        if (!safe || !owner || !chainId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "safe, owner, and chainId are required" }));
          return;
        }
        const record: StoredAccount = {
          safe,
          owner,
          permissionSigner: permissionSigner ?? owner,
          manager: manager ?? owner,
          chainId,
          createdAtBlock: createdAtBlock ?? "0",
        };
        const baseSailDir = this.sailFile();
        upsertAccountInList(record, undefined, baseSailDir);
        mkdirSync(baseSailDir, { recursive: true });
        writeFileSync(this.sailFile("account.json"), `${JSON.stringify(record, null, 2)}\n`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      });
  }

  /** All known SMAs, annotating the currently-active one (mirrors the UI server). */
  private handleListAccounts(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    let active: string | null = null;
    try {
      active = (JSON.parse(readFileSync(this.sailFile("account.json"), "utf-8")) as StoredAccount)
        .safe;
    } catch {
      /* no active account */
    }
    try {
      const accounts = JSON.parse(
        readFileSync(this.sailFile("state", "accounts.json"), "utf-8"),
      ) as Array<StoredAccount & { name?: string }>;
      res.end(
        JSON.stringify(
          accounts.map((a) => ({
            ...a,
            active: a.safe.toLowerCase() === active?.toLowerCase(),
          })),
        ),
      );
    } catch {
      // Fall back to the active account.json as a single-item list.
      try {
        const a = JSON.parse(
          readFileSync(this.sailFile("account.json"), "utf-8"),
        ) as StoredAccount;
        res.end(JSON.stringify([{ ...a, name: "My SMA", active: true, addedAt: null }]));
      } catch {
        res.end("[]");
      }
    }
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    // CORS strategy:
    //   - /config (discovery): allow any localhost origin so the dashboard and other
    //     local tools can discover the station. The secret is NOT in the response body.
    //   - All other endpoints: restrict to the exact station origin (same port).
    //     This prevents any other localhost page from reading state or injecting requests.
    const url0 = (req.url ?? "/").split("?")[0];
    const isDiscoveryEndpoint = url0 === "/config";
    const allowedOrigin =
      isDiscoveryEndpoint && origin?.startsWith("http://localhost:")
        ? origin
        : origin === this._url
          ? origin
          : this._url;
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", `Content-Type, ${REQUEST_SECRET_HEADER}`);
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = (req.url ?? "/").split("?")[0];

    if (url === "/config") {
      // The requestSecret is NOT included in the response body when the request
      // carries an Origin header (i.e. it is a cross-origin browser request).
      // Same-origin requests (Origin absent — the signed UI served at this port)
      // and exact-origin requests receive the secret embedded in wsUrl as a query
      // parameter so the WebSocket connection can be authenticated.
      // This ensures cross-origin pages that can discover the station cannot
      // obtain the secret needed to inject signing requests or read pending state.
      const isTrustedOrigin = !origin || origin === this._url;
      const wsUrlForClient = isTrustedOrigin
        ? `${this.wsUrl}?secret=${encodeURIComponent(this.requestSecret)}`
        : this.wsUrl;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          url: this._url,
          wsUrl: wsUrlForClient,
          port: this.port,
          pid: process.pid,
          pendingCount: this.pending.size,
        }),
      );
      return;
    }

    // All state-bearing GET endpoints require the requestSecret header.
    // This prevents any localhost page from reading the pending queue, the
    // connected wallet address, or resolved signatures.
    const secretHeader = req.headers[REQUEST_SECRET_HEADER];
    const isAuthenticated = secretHeader === this.requestSecret;

    if (url === "/pending") {
      if (!isAuthenticated) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Array.from(this.pending.values()).map((e) => e.request)));
      return;
    }

    if (url === "/wallet") {
      if (!isAuthenticated) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ address: this._connectedWallet ?? null }));
      return;
    }

    if (url === "/requests" && req.method === "POST") {
      // Require the per-startup secret so only the CLI and daemon-served UI
      // can inject signing requests — cross-origin pages cannot read this secret.
      const supplied = req.headers[REQUEST_SECRET_HEADER];
      if (supplied !== this.requestSecret) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      this.readBody(req)
        .then((body) => {
          const parsed = JSON.parse(body) as
            | Omit<SigningTxRequest, "id" | "createdAt">
            | Omit<SigningTypedDataRequest, "id" | "createdAt">;
          if (!parsed.kind || !["create-sma","deploy-mandate","register-permission","attach-mandate","revoke-permissions","set-delegate","arbitrary-tx"].includes(parsed.kind)) {
            throw new Error(`Unknown signing request kind: ${String(parsed.kind)}`);
          }
          const request = this.enqueue(parsed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: request.id }));
        })
        .catch((err) => {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        });
      return;
    }

    // ── SMA persistence ────────────────────────────────────────────────────
    // The station daemon serves the dashboard, but unlike `sailor ui`'s data
    // server it has no Express /api. So a Safe deployed from the dashboard's
    // Create/Import flow (CreateSMAModal → POST /api/account) had nowhere to
    // land: the request 404'd and the SMA lived only in browser localStorage,
    // invisible to the agent reading account.json / state/accounts.json. These
    // endpoints persist it to disk so the agent perceives the active SMA.
    if (url === "/api/account" && req.method === "POST") {
      this.handleSaveAccount(req, res);
      return;
    }
    if (url === "/api/account" && (req.method === "GET" || req.method == null)) {
      this.sendJsonFile(res, join(this.projectRoot, ".sail", "account.json"), {
        status: 404,
        body: { error: "account not found" },
      });
      return;
    }
    if (url === "/api/accounts" && (req.method === "GET" || req.method == null)) {
      this.handleListAccounts(res);
      return;
    }

    const resultMatch = url.match(/^\/requests\/([^/]+)\/result$/);
    if (resultMatch && (req.method === "GET" || req.method == null)) {
      if (!isAuthenticated) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      const id = decodeURIComponent(resultMatch[1]);
      this.waitForResult(id, RESULT_LONGPOLL_MS).then((result) => {
        if (result) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } else {
          res.writeHead(204);
          res.end();
        }
      });
      return;
    }

    // Static UI — serve the built signing UI if available.
    if (this.uiDist) {
      const rawPath = (req.url ?? "/").split("?")[0];
      const filePath = resolve(join(this.uiDist, rawPath === "/" ? "index.html" : rawPath));
      if (!filePath.startsWith(resolve(this.uiDist))) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (existsSync(filePath)) {
        const mime = MIME[extname(filePath)] ?? "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        res.end(readFileSync(filePath));
        return;
      }
      const indexHtml = join(this.uiDist, "index.html");
      if (existsSync(indexHtml)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(indexHtml));
        return;
      }
    }

    res.writeHead(404);
    res.end();
  }

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);

    const msg: ServerMessage = {
      type: "pending",
      requests: Array.from(this.pending.values()).map((e) => e.request),
    };
    ws.send(JSON.stringify(msg));

    ws.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as ClientMessage;
        this.handleClientMessage(ws, parsed);
      } catch {
        /* ignore malformed frames */
      }
    });

    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", () => this.clients.delete(ws));
  }

  private handleClientMessage(_ws: WebSocket, msg: ClientMessage): void {
    if (msg.type === "wallet-connected") {
      // Only accept a wallet-connected message if the address is a plausible
      // EVM address. We can't fully verify it server-side (no challenge/response),
      // but we reject obviously malformed values and require the UI to be served
      // by this same server (CORS + secret on POST /requests cover the rest).
      if (typeof msg.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(msg.address)) return;
      this._connectedWallet = msg.address as Address;
      for (const listener of this.walletListeners) listener(msg.address as Address);
      this.walletListeners = [];
      return;
    }
    if (msg.type === "wallet-disconnected") {
      this._connectedWallet = undefined;
      return;
    }

    const entry = this.pending.get(msg.requestId);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(msg.requestId);
    const { request } = entry;

    if (msg.type === "signed") {
      this.recordResult(
        { status: "signed", requestId: msg.requestId, txHash: msg.txHash as Hex },
        request,
      );
    } else if (msg.type === "signature") {
      this.recordResult(
        { status: "signature", requestId: msg.requestId, signature: msg.signature as Hex },
        request,
      );
    } else {
      this.recordResult(
        {
          status: "rejected",
          requestId: msg.requestId,
          reason: (msg as { reason?: string }).reason,
        },
        request,
      );
    }
  }

  private readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
    return new Promise((res, rej) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          rej(new Error("Request body too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
      req.on("error", rej);
    });
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  private writeRuntimeState(): void {
    if (!existsSync(this.runtimeDir)) mkdirSync(this.runtimeDir, { recursive: true });
    writeFileSync(
      join(this.runtimeDir, SERVER_STATE_FILE),
      JSON.stringify(
        {
          url: this._url,
          wsUrl: this.wsUrl,
          port: this.port,
          startedAt: new Date().toISOString(),
          pid: process.pid,
          requestSecret: this.requestSecret,
        },
        null,
        2,
      ),
    );
  }

  private removeRuntimeState(): void {
    const path = join(this.runtimeDir, SERVER_STATE_FILE);
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((res) => {
    const probe = createNetServer();
    probe.listen(startPort, "127.0.0.1", () => {
      const addr = probe.address() as { port: number };
      probe.close(() => res(addr.port));
    });
    probe.on("error", () => res(findAvailablePort(startPort + 1)));
  });
}
