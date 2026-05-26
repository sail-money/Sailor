import fs from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { SailorClient } from "@sail/sdk";
import { type Address, getAddress, isAddress } from "viem";

// ── .sail/ filesystem helpers ───────────────────────────────────────────────

/** Absolute path to the current project's `.sail/` directory. */
export function sailDir(): string {
  return path.join(process.cwd(), ".sail");
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

/** Writes JSON, creating the parent directory (e.g. `.sail/keys/`) if needed. */
export function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
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

// ── Address helpers ───────────────────────────────────────────────────────────

/** Returns the EIP-55 checksummed form of an address (throws if invalid). */
export function checksum(address: string): Address {
  return getAddress(address);
}

export { isAddress };

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
