import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Address, Hex } from "viem";
import { WebSocket } from "ws";
import { pollIsConfigured } from "../commands/mandate-configure.js";
import { type ReceiptChecker, SigningServer } from "./server.js";

// Run with: pnpm --filter sailor test  (requires `pnpm --filter @sail/sdk build` first).
//
// Durable coverage for the signing-confirmation protocol, the isConfigured
// retry (F14), and the arbitrary-tx contract — the behaviours that shipped with
// only a throwaway harness (audit DEFECT-3). No real chain, no funds: the
// daemon's receipt observation is injected (ReceiptChecker) and the isConfigured
// poll takes a stubbed publicClient with a zero backoff.

const ADDR = "0x1111111111111111111111111111111111111111" as Address;
const TO = "0x2222222222222222222222222222222222222222" as Address;
const TX = ("0x" + "11".repeat(32)) as Hex;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A1 — the DEFECT-1 guard: every caller-reported request kind must report
// an outcome. Enumerated FROM SOURCE so a future kind is auto-covered, or fails
// loudly if it is added without confirmOutcome (exactly the revoke hang we shipped).
// ─────────────────────────────────────────────────────────────────────────────

const COMMANDS_DIR = join(import.meta.dirname, "..", "commands");

/** Split a module into its function declarations (async or not) with their bodies. */
function functionsOf(src: string): { name: string; body: string }[] {
  const re = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
  const starts: { name: string; idx: number }[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1], idx: m.index });
  return starts.map((s, i) => ({
    name: s.name,
    body: src.slice(s.idx, i + 1 < starts.length ? starts[i + 1].idx : src.length),
  }));
}

/** Every `channel.requestSignature({...})` in a function body, with its type/kind. */
function signatureRequestsIn(body: string): { type?: string; kind?: string }[] {
  const out: { type?: string; kind?: string }[] = [];
  const re = /requestSignature\(\{/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const seg = body.slice(m.index, m.index + 800); // type/kind are the first fields
    out.push({
      type: seg.match(/type:\s*["'](transaction|typed-data)["']/)?.[1],
      kind: seg.match(/kind:\s*["']([a-z-]+)["']/)?.[1],
    });
  }
  return out;
}

// A request whose on-chain outcome the COMMAND observes (so the command must
// report it back via confirmOutcome, else the station hangs on
// "awaiting-confirmation"): every typed-data signature the agent submits, plus
// arbitrary-tx (owner-submitted but the command verifies it). Plain
// owner-submitted transactions (create-sma/deploy-mandate/set-delegate) are
// confirmed by the daemon and are intentionally exempt.
const callerReports = (r: { type?: string; kind?: string }) =>
  r.type === "typed-data" || r.kind === "arbitrary-tx";

describe("A1 — every caller-reported request kind reports an outcome (DEFECT-1 guard)", () => {
  const files = readdirSync(COMMANDS_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
  const coveredKinds = new Set<string>();
  const gaps: string[] = [];

  for (const file of files) {
    const src = readFileSync(join(COMMANDS_DIR, file), "utf8");
    for (const fn of functionsOf(src)) {
      if (!fn.body.includes("requestSignature(")) continue;
      for (const req of signatureRequestsIn(fn.body)) {
        if (!callerReports(req)) continue;
        const kind = req.kind ?? "(unknown)";
        if (/\bconfirmOutcome\(/.test(fn.body)) coveredKinds.add(kind);
        else gaps.push(`${file} → ${fn.name}() submits '${kind}' but never calls confirmOutcome`);
      }
    }
  }

  test("no caller-reported submit path is missing confirmOutcome", () => {
    assert.deepEqual(
      gaps,
      [],
      `A request whose outcome the command owns must call confirmOutcome on every exit, ` +
        `or the signing station hangs on 'awaiting-confirmation' (DEFECT-1). Gaps:\n${gaps.join("\n")}`,
    );
  });

  test("the scan actually found the known caller-reported kinds (not vacuous)", () => {
    // If a kind disappears here, the enumeration broke — the guard above would
    // silently pass on nothing.
    for (const kind of ["register-permission", "revoke-permissions", "arbitrary-tx"]) {
      assert.ok(coveredKinds.has(kind), `expected to find a caller-reported '${kind}' path`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server-driven tests: a scripted browser (WS) approves requests; the daemon's
// receipt observation is injected. One shared server (started once) avoids the
// findFreePort TOCTOU race that a fresh server per test would hit; the receipt
// outcome is swapped per test via a mutable slot. /config with no Origin returns
// the wsUrl with the secret embedded.
// ─────────────────────────────────────────────────────────────────────────────

// Use 127.0.0.1, not the server's `localhost` URL: undici may resolve localhost
// to ::1 first and fail with ECONNREFUSED against a 127.0.0.1-bound server (the
// same reason client.ts rewrites the loopback host).
const loopback = (url: string) => url.replace("//localhost", "//127.0.0.1");

// The receipt outcome the daemon will observe for the NEXT signed tx, swapped
// per test. Default success; a test sets it before driving a request.
let receiptImpl: ReceiptChecker = async () => "success";

let server: SigningServer;
let ws: WebSocket;
const msgs: any[] = [];

before(async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "sailor-signing-test-"));
  server = new SigningServer({
    projectRoot,
    advertise: false,
    checkReceipt: (chainId, txHash) => receiptImpl(chainId, txHash),
  });
  await server.start();
  const base = loopback(server.url);
  const cfg = (await (await fetch(`${base}/config`)).json()) as { wsUrl: string };
  ws = new WebSocket(loopback(cfg.wsUrl));
  await new Promise<void>((res, rej) => {
    ws.on("open", () => res());
    ws.on("error", rej);
  });
  ws.on("message", (d) => msgs.push(JSON.parse(d.toString())));
});

after(() => {
  ws?.close();
  server?.stop();
});

/** Wait for a message at or after `from` in the accumulating stream. */
async function waitFrom<T = any>(from: number, pred: (m: any) => boolean, ms = 3000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = msgs.slice(from).find(pred);
    if (m) return m as T;
    await sleep(20);
  }
  return undefined;
}

/** Enqueue a request, wait for its broadcast id, then simulate the browser signing it. */
async function enqueueAndSign(req: Record<string, unknown>): Promise<{ id: string; resolved: Promise<any> }> {
  const from = msgs.length;
  const resolved = server.requestSignature(req as any);
  const reqMsg = await waitFrom(from, (m) => m.type === "request");
  const id = reqMsg.request.id as string;
  ws.send(JSON.stringify({ type: "signed", requestId: id, txHash: TX }));
  return { id, resolved };
}

describe("A2 — arbitrary-tx contract: no daemon receipt wait, no daemon confirmation", () => {
  test("requestSignature resolves promptly after signing and the daemon does not confirm", async () => {
    // A receipt checker that hangs forever: if the daemon confirmed arbitrary-tx
    // it would call this and the request could never resolve. It must not.
    receiptImpl = () => new Promise(() => {});
    const from = msgs.length;
    const { id, resolved } = await enqueueAndSign({
      type: "transaction",
      kind: "arbitrary-tx",
      title: "Configure",
      chainId: 8453,
      to: TO,
      data: "0xdeadbeef",
    });

    const res = await Promise.race([resolved, sleep(1500).then(() => "TIMEOUT")]);
    assert.notEqual(res, "TIMEOUT", "arbitrary-tx must not block on a daemon receipt wait");
    assert.equal(res.status, "signed");
    assert.equal(res.txHash, TX);

    assert.ok(
      await waitFrom(from, (m) => m.type === "request-resolved" && m.requestId === id),
      "UI should get request-resolved (awaiting confirmation), not success",
    );
    await sleep(300);
    assert.equal(
      msgs.some((m) => m.type === "request-confirmed" && m.requestId === id),
      false,
      "daemon must NOT confirm arbitrary-tx — the configure command owns that outcome",
    );
  });
});

describe("A3 — outcome doctrine for daemon-confirmed kinds (create-sma)", () => {
  const cases: { name: string; checker: ReceiptChecker; expect: string }[] = [
    { name: "successful receipt → confirmed", checker: async () => "success", expect: "confirmed" },
    { name: "reverted receipt → reverted", checker: async () => "reverted", expect: "reverted" },
    {
      name: "receipt unobservable (no RPC / timeout) → unverified, NOT failed/reverted",
      checker: async () => {
        throw new Error("No RPC URL configured for chain 8453");
      },
      expect: "unverified",
    },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      receiptImpl = c.checker;
      const from = msgs.length;
      const { id, resolved } = await enqueueAndSign({
        type: "transaction",
        kind: "create-sma",
        title: "Create SMA",
        chainId: 8453,
        to: TO,
        data: "0xbeef",
      });
      const res = await Promise.race([resolved, sleep(1500).then(() => "TIMEOUT")]);
      assert.notEqual(res, "TIMEOUT", "the caller must not block on the daemon's receipt wait");
      const confirmed = await waitFrom(from, (m) => m.type === "request-confirmed" && m.requestId === id);
      assert.ok(confirmed, "daemon should confirm a create-sma for the UI");
      assert.equal(confirmed.confirmation.outcome, c.expect);
    });
  }

  test("missing chainId → unverified (never failed)", async () => {
    // A hanging checker proves the no-chainId branch short-circuits before ever
    // consulting a receipt.
    receiptImpl = () => new Promise(() => {});
    const from = msgs.length;
    const resolved = server.requestSignature({
      type: "transaction",
      kind: "create-sma",
      title: "Create SMA (no chain)",
      // chainId intentionally omitted
      to: TO,
      data: "0xbeef",
    } as any);
    const reqMsg = await waitFrom(from, (m) => m.type === "request");
    const id = reqMsg.request.id as string;
    ws.send(JSON.stringify({ type: "signed", requestId: id, txHash: TX }));
    await resolved;
    const confirmed = await waitFrom(from, (m) => m.type === "request-confirmed" && m.requestId === id);
    assert.ok(confirmed);
    assert.equal(confirmed.confirmation.outcome, "unverified");
  });
});

describe("A3b — confirmOutcome pass-through (caller-reported paths: configure/revoke/deploy-clone)", () => {
  const outcomes: { outcome: string; extra: Record<string, unknown> }[] = [
    { outcome: "confirmed", extra: { txHash: TX } },
    { outcome: "confirmed", extra: { txHash: TX, note: "indexing may lag; verify with sailor mandate list" } },
    { outcome: "reverted", extra: { txHash: TX, error: "reverted on-chain" } },
    { outcome: "failed", extra: { error: "sendTransaction threw" } },
    { outcome: "unverified", extra: { txHash: TX, error: "mined but isConfigured still false" } },
  ];
  for (const o of outcomes) {
    test(`broadcasts '${o.outcome}'${"note" in o.extra ? " (with note)" : ""} verbatim to the UI`, async () => {
      const from = msgs.length;
      const rid = `req-${o.outcome}-${"note" in o.extra ? "note" : "plain"}`;
      await server.confirmOutcome(rid, { outcome: o.outcome, ...o.extra } as any);
      const m = await waitFrom(from, (x) => x.type === "request-confirmed" && x.requestId === rid);
      assert.ok(m, "confirmOutcome must reach the UI as request-confirmed");
      assert.equal(m.confirmation.outcome, o.outcome);
      if ("note" in o.extra) assert.equal(m.confirmation.note, o.extra.note);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A4 — pollIsConfigured (F14): read-after-write lag must resolve as
// success, not a false failure; persistent false resolves false (→ unverified).
// Deterministic: stubbed publicClient, zero backoff.
// ─────────────────────────────────────────────────────────────────────────────

describe("A4 — pollIsConfigured retry (F14)", () => {
  test("false-then-true across retries resolves as success (the race the fix targets)", async () => {
    let calls = 0;
    const publicClient = { readContract: async () => ++calls >= 3 }; // false, false, true
    const ok = await pollIsConfigured(publicClient as any, ADDR, ADDR, 6, 0);
    assert.equal(ok, true);
    assert.equal(calls, 3, "should stop polling as soon as it reads true");
  });

  test("false through all retries resolves false (caller maps this to 'unverified')", async () => {
    let calls = 0;
    const publicClient = {
      readContract: async () => {
        calls++;
        return false;
      },
    };
    const ok = await pollIsConfigured(publicClient as any, ADDR, ADDR, 4, 0);
    assert.equal(ok, false);
    assert.equal(calls, 4, "should try exactly `attempts` times before giving up");
  });
});
