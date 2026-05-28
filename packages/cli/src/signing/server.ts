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
    this.wss.on("connection", (ws) => this.handleConnection(ws));

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
      this.recordResult({ status: "rejected", requestId: id, reason: "Signing server stopped" });
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
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const request = { ...req, id, createdAt: Date.now() } as SigningRequest;

    const timer = setTimeout(() => {
      if (this.pending.has(id)) {
        this.pending.delete(id);
        this.recordResult({
          status: "rejected",
          requestId: id,
          reason: `timed out after ${timeoutMs / 1000}s`,
        });
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

  private recordResult(response: SigningResponse): void {
    const id = response.requestId;
    this.results.set(id, response);
    const waiters = this.resultWaiters.get(id);
    if (waiters) {
      for (const w of waiters) w(response);
      this.resultWaiters.delete(id);
    }
    this.broadcast({ type: "request-resolved", requestId: id });
    setTimeout(() => this.results.delete(id), 10 * 60 * 1000).unref?.();
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    // Restrict CORS to same-origin localhost requests only. Cross-origin pages
    // must not be able to POST signing requests or read pending queue state.
    const origin = req.headers.origin;
    const allowedOrigin = origin?.startsWith("http://localhost:") ? origin : this._url;
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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          url: this._url,
          wsUrl: this.wsUrl,
          port: this.port,
          pid: process.pid,
          pendingCount: this.pending.size,
          requestSecret: this.requestSecret,
        }),
      );
      return;
    }

    if (url === "/pending") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Array.from(this.pending.values()).map((e) => e.request)));
      return;
    }

    if (url === "/wallet") {
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
          if (!parsed.kind || !["create-sma","deploy-mandate","register-permission","attach-mandate","set-delegate"].includes(parsed.kind)) {
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

    const resultMatch = url.match(/^\/requests\/([^/]+)\/result$/);
    if (resultMatch && (req.method === "GET" || req.method == null)) {
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

    if (msg.type === "signed") {
      this.recordResult({ status: "signed", requestId: msg.requestId, txHash: msg.txHash as Hex });
    } else if (msg.type === "signature") {
      this.recordResult({
        status: "signature",
        requestId: msg.requestId,
        signature: msg.signature as Hex,
      });
    } else {
      this.recordResult({
        status: "rejected",
        requestId: msg.requestId,
        reason: (msg as { reason?: string }).reason,
      });
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
