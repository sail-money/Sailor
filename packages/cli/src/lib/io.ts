import fs from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { SailorClient } from "@sail/sdk";
import { readActiveAccount } from "@sail/sdk/accounts";
// Re-exported so CLI commands read the active SMA through the single owning module
// (accounts.ts in the SDK) rather than touching account.json directly.
export { readActiveAccount, readActiveSafe } from "@sail/sdk/accounts";
import { type Address, getAddress, isAddress } from "viem";

// ── .sail/ filesystem helpers ───────────────────────────────────────────────

/**
 * Resolve the state directory for a project root, honoring `SAIL_DIR`.
 *
 * `SAIL_DIR` (absolute, or relative to `projectRoot`) points the whole CLI —
 * activity log, accounts, mandate tracking, keys, `.env.local`, the signing
 * daemon's runtime descriptor — at an alternate root. The UI server
 * (packages/ui/server.js) already resolves its state this way; the sandbox
 * (`.shipyard/sandbox/`) relies on both halves agreeing, so signing/dispatch
 * driven from the sandbox UI lands in the sandbox's own state, never `.sail/`.
 */
export function resolveSailDir(projectRoot: string = process.cwd()): string {
  const override = process.env["SAIL_DIR"];
  return override ? path.resolve(projectRoot, override) : path.join(projectRoot, ".sail");
}

/** Absolute path to the current project's state directory (`.sail/` unless `SAIL_DIR` overrides). */
export function sailDir(): string {
  return resolveSailDir();
}

/** Joins segments under `.sail/`. */
export function sailPath(...segments: string[]): string {
  return path.join(sailDir(), ...segments);
}

/** Reads and parses a JSON file, returning null if it is missing or invalid. */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

/**
 * Writes JSON, creating the parent directory (e.g. `.sail/keys/`) if needed.
 *
 * Pass `mode` (e.g. `0o600`) for secret files like keystores — it is applied on
 * create AND re-chmodded afterwards, because `writeFileSync`'s `mode` is ignored
 * when the file already exists. Omit it for non-secret files (account.json,
 * mandates, config) so they keep the default umask.
 */
export function writeJsonFile(filePath: string, data: unknown, mode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(data, null, 2)}\n`,
    mode !== undefined ? { mode } : undefined,
  );
  if (mode !== undefined) fs.chmodSync(filePath, mode);
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/** ISO-8601 timestamp (seconds precision, UTC) for activity log entries. */
export function nowIso(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

/**
 * Appends one JSON line to `activity.jsonl`, creating the `.sail/` dir if
 * needed. The unified activity log holds events from both actors — the
 * delegated signer/agent (`sailor run` dispatches) and the owner (signing-
 * page approvals + mandate lifecycle). Every event SHOULD carry an `actor`
 * field (`"owner"` | `"agent"`); readers treat a missing actor as `"agent"`
 * for back-compat with logs written before the field existed.
 *
 * `baseSailDir` defaults to the current project's `.sail/`. The signing server
 * passes its own `projectRoot/.sail` so owner events land in the right project
 * even when it runs as a standalone daemon from a different cwd.
 */
export function appendActivity(
  event: Record<string, unknown>,
  baseSailDir: string = sailDir(),
): void {
  const filePath = path.join(baseSailDir, "activity.jsonl");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  // Tag the event with the SMA it belongs to so Recent Activity stays per-SMA
  // across multiple accounts in one project. Honor an explicit tag; otherwise
  // stamp the currently-active SMA from account.json (leave untagged if none).
  let tagged = event;
  if (!("safe" in event)) {
    const safe = readActiveAccount(baseSailDir)?.safe;
    if (safe) tagged = { ...event, safe };
  }

  fs.appendFileSync(filePath, `${JSON.stringify(tagged)}\n`);
}

/** Parses a dotenv-style file into a flat record. Returns {} if absent. */
export function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  for (const rawLine of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Upserts the `SAIL_PASSPHRASE` line in a `.sail/.env.local`-style file,
 * preserving every other key, and guarantees the file ends up mode 0600 (owner
 * read/write only) — including when it already existed, where `writeFileSync`'s
 * `mode` is ignored, so we `chmod` explicitly.
 *
 * This is the keystore passphrase the CLI/CI read via `SAIL_PASSPHRASE`. The UI
 * server (packages/ui/server.js) carries an inline JS copy of this exact logic
 * because it cannot import this TS module across the package/language boundary —
 * keep the two in sync.
 */
export function persistPassphrase(envPath: string, passphrase: string): void {
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8").replace(/^SAIL_PASSPHRASE=.*\n?/m, "");
  }
  const trimmed = content.trimEnd();
  content = `${trimmed}${trimmed.length > 0 ? "\n" : ""}SAIL_PASSPHRASE=${passphrase}\n`;
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

// ── Address helpers ───────────────────────────────────────────────────────────

/** Returns the EIP-55 checksummed form of an address (throws if invalid). */
export function checksum(address: string): Address {
  return getAddress(address);
}

// ── SDK client ──────────────────────────────────────────────────────────────

/** Builds a SailorClient for the given chain, reading RPC_URL from .sail/.env.local. */
export function makeClient(chainId: number): SailorClient {
  const env = parseEnvFile(sailPath(".env.local"));
  const rpcUrl = env["RPC_URL"] ?? process.env["RPC_URL"] ?? "http://localhost:8545";
  return new SailorClient({ rpcUrl, chainId });
}

// ── Interactive prompts (built-in readline only) ──────────────────────────────
//
// A single shared readline interface drives every prompt, consuming stdin via
// the "line" event into a queue. This is the only reliable pattern for piped
// input (tests/CI): sequential rl.question() calls hang after the first line
// when stdin is not a TTY. closePrompts() must be called when a command ends so
// the process can exit.

let sharedRl: Interface | null = null;
let muted = false;
const lineQueue: string[] = [];
const waiters: ((line: string) => void)[] = [];
let inputClosed = false;

function getRl(): Interface {
  if (sharedRl) return sharedRl;
  const isTty = process.stdin.isTTY === true;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: isTty });
  if (isTty) {
    const muteable = rl as unknown as { _writeToOutput: (text: string) => void };
    const original = muteable._writeToOutput.bind(rl);
    muteable._writeToOutput = (text: string) => {
      if (!muted) original(text);
    };
  }
  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lineQueue.push(line);
  });
  rl.on("close", () => {
    inputClosed = true;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter?.("");
    }
  });
  sharedRl = rl;
  return rl;
}

function ask(query: string): Promise<string> {
  getRl();
  process.stdout.write(query);
  return new Promise<string>((resolve) => {
    const buffered = lineQueue.shift();
    if (buffered !== undefined) {
      resolve(buffered);
    } else if (inputClosed) {
      resolve("");
    } else {
      waiters.push(resolve);
    }
  });
}

/** Closes the shared prompt interface so the process can exit. */
export function closePrompts(): void {
  if (sharedRl) {
    sharedRl.close();
    sharedRl = null;
  }
}

/** Asks a question and returns the trimmed answer, or `def` if blank. */
export async function prompt(question: string, def?: string): Promise<string> {
  const suffix = def !== undefined ? ` (${def})` : "";
  const answer = await ask(`${question}${suffix}: `);
  const trimmed = answer.trim();
  return trimmed === "" && def !== undefined ? def : trimmed;
}

/** Yes/no confirmation, defaulting to no. */
export async function confirm(question: string): Promise<boolean> {
  const answer = (await prompt(`${question} (y/N)`)).toLowerCase();
  return answer === "y" || answer === "yes";
}

/** Prompts for an address, re-asking on invalid input. Returns it checksummed. */
export async function promptAddress(label: string, def?: string): Promise<Address> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = await prompt(label, def);
    if (isAddress(raw)) return getAddress(raw);
    console.log(`  "${raw}" is not a valid EVM address — try again.`);
  }
  throw new Error(`No valid address provided for: ${label}`);
}

/**
 * Prompts for a secret. In an interactive terminal, keystrokes are not echoed.
 * When stdin is piped (tests/CI), input isn't echoed anyway, so we read plainly.
 */
export async function promptHidden(question: string): Promise<string> {
  const isTty = process.stdin.isTTY === true;
  if (isTty) muted = true;
  const answer = await ask(`${question}: `);
  if (isTty) {
    muted = false;
    process.stdout.write("\n");
  }
  return answer;
}
