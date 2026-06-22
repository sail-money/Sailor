import fs from "node:fs";
import path from "node:path";
import { TEMPLATE_COPY_EXCLUDES } from "./template.js";

/**
 * Helpers for `sailor share` — turning a live project into a sanitized,
 * publishable template. Pure/fs-only so the command layer stays thin and the
 * tricky bits (what counts as sensitive, what counts as a secret leak, what's
 * compulsory) are unit-testable without the network.
 */

// ── Manifest ────────────────────────────────────────────────────────────────

/**
 * `.sail/share.json` — the compulsory metadata every shared project must carry.
 * It is both the publish gate and the PR body source. `strategy` and `mandate`
 * are required prose so a reviewer (and a future replicator) understands what
 * the project does and what authority it needs before running it.
 */
export interface ShareManifest {
  name: string; // display title
  slug: string; // folder + release-tag key (kebab, unique)
  summary: string; // one line → PR title
  description: string; // what it's about → PR body
  strategy: string; // REQUIRED: what the strategy does
  mandate: string; // REQUIRED: what permissions/mandate it needs + why
  chains: number[]; // REQUIRED: target chain ids
  tags: string[];
  author: string; // gh handle or email
  sailorVersion: string;
  sharedAt: string; // ISO
}

/** kebab-case slug from a free-form name; safe as a folder + git ref + tag. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Validate a (possibly partial) manifest. Returns a list of human-readable
 * problems; empty list means valid. Never throws — the caller decides how to
 * surface the errors.
 */
export function validateManifest(m: Partial<ShareManifest> | null): string[] {
  const errors: string[] = [];
  if (!m) return ["share.json is missing or unparseable"];

  const req = (field: keyof ShareManifest, label: string): void => {
    const v = m[field];
    if (typeof v !== "string" || v.trim() === "") errors.push(`${label} is required`);
  };
  req("name", "name");
  req("summary", "summary");
  req("strategy", "strategy (what the strategy does)");
  req("mandate", "mandate (what permissions it needs and why)");
  req("author", "author");

  if (typeof m.slug === "string" && m.slug !== "" && slugify(m.slug) !== m.slug) {
    errors.push(`slug "${m.slug}" is not a valid kebab-case slug`);
  }
  if (!Array.isArray(m.chains) || m.chains.length === 0) {
    errors.push("chains is required (at least one chain id)");
  } else if (!m.chains.every((c) => Number.isInteger(c) && c > 0)) {
    errors.push("chains must all be positive integers");
  }
  return errors;
}

// ── Sensitive file map ────────────────────────────────────────────────────────

/**
 * Project-relative paths that must NEVER be published. Authoritative mirror of
 * `templates/default/_gitignore` plus the sharer-identity files (account/mandate
 * carry the sharer's SMA address, owner, and signatures — strategy, not theirs).
 * Matched as exact files or directory prefixes.
 */
export const SENSITIVE_PATHS: readonly string[] = [
  ".sail/keys",
  ".sail/runtime",
  ".sail/state",
  ".sail/.env.local",
  ".sail/.wizard-state.json",
  ".sail/activity.jsonl",
  ".sail/account.json",
  ".sail/mandate.json",
  ".sail/mandate-draft.json",
  "ci-keystore.json",
];

/** True if a project-relative POSIX path is sensitive and must be stripped. */
export function isSensitivePath(rel: string): boolean {
  const p = rel.split(path.sep).join("/");
  for (const s of SENSITIVE_PATHS) {
    if (p === s || p.startsWith(`${s}/`)) return true;
  }
  // .env and .env.* (real secrets) — but keep the .env.example template.
  const base = p.split("/").pop() ?? "";
  if ((base === ".env" || base.startsWith(".env.")) && base !== ".env.example") return true;
  return false;
}

// ── Clean copy ──────────────────────────────────────────────────────────────

/**
 * Sanitize `.sail/config.json` for publication: keep the structural fields,
 * blank the chain-specific contract addresses, and drop the per-install
 * timestamp. Returns the JSON string to write.
 */
export function sanitizeConfig(raw: string): string {
  const cfg = JSON.parse(raw) as Record<string, unknown>;
  const clean = {
    version: cfg.version ?? 1,
    name: cfg.name ?? "",
    chainId: cfg.chainId ?? null,
    stateDir: cfg.stateDir ?? ".sail/state",
    contracts: { kernel: "", mandateFactory: "" },
  };
  return `${JSON.stringify(clean, null, 2)}\n`;
}

/**
 * Copy `srcRoot` → `destRoot`, skipping build/VCS dirs and every sensitive
 * path, and sanitizing `.sail/config.json` on the way through. Returns the list
 * of project-relative files written (for the dry-run preview).
 */
export function buildCleanCopy(srcRoot: string, destRoot: string): string[] {
  const written: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (TEMPLATE_COPY_EXCLUDES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(srcRoot, abs);
      if (isSensitivePath(rel)) continue;

      const destAbs = path.join(destRoot, rel);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(destAbs), { recursive: true });
        if (rel.split(path.sep).join("/") === ".sail/config.json") {
          fs.writeFileSync(destAbs, sanitizeConfig(fs.readFileSync(abs, "utf-8")));
        } else {
          fs.copyFileSync(abs, destAbs);
        }
        written.push(rel.split(path.sep).join("/"));
      }
    }
  };

  walk(srcRoot);
  return written.sort();
}

// ── Required files ────────────────────────────────────────────────────────────

/**
 * Compulsory contents every shared project must have. Returns the list of
 * missing requirements (empty = ok). `mandates/**\/*.sol` is satisfied by any
 * Solidity file under mandates/.
 */
export function findMissingRequiredFiles(root: string): string[] {
  const missing: string[] = [];
  const has = (rel: string): boolean => fs.existsSync(path.join(root, rel));

  if (!has("src/agent.ts")) missing.push("src/agent.ts (strategy logic)");
  if (!has("src/mandate.ts")) missing.push("src/mandate.ts (strategy parameters)");
  if (!has("AGENTS.md")) missing.push("AGENTS.md (operator guide)");

  const mandatesDir = path.join(root, "mandates");
  const hasSol =
    fs.existsSync(mandatesDir) && listFilesRecursive(mandatesDir).some((f) => f.endsWith(".sol"));
  if (!hasSol) missing.push("mandates/**/*.sol (at least one permission contract)");

  return missing;
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (TEMPLATE_COPY_EXCLUDES.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(abs));
    else out.push(abs);
  }
  return out;
}

// ── Secret scan (defense in depth) ──────────────────────────────────────────

export interface SecretFinding {
  file: string; // project-relative
  line: number; // 1-based
  kind: string;
}

const PLACEHOLDER = /your-|change-me|example|placeholder|xxxx|<[a-z]|0x0{40,}|0{60,}/i;
const SCAN_SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".zip",
  ".gz",
  ".lock",
  ".wasm",
]);

const SECRET_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "private-key (0x + 64 hex)", re: /\b0x[0-9a-fA-F]{64}\b/ },
  { kind: "rpc url with embedded key", re: /(RPC_URL|_RPC_URL)\s*[:=]\s*['"]?https?:\/\/\S+/i },
  {
    kind: "api key / secret / passphrase",
    re: /\b(api[_-]?key|secret|passphrase|private[_-]?key|access[_-]?token)\b\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{12,}/i,
  },
];

/** 12/24-word BIP-39-style mnemonic on a single line (lowercase words only). */
function looksLikeMnemonic(line: string): boolean {
  const words = line.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) return false;
  return words.every((w) => /^[a-z]{3,8}$/.test(w));
}

/**
 * Scan every text file under `root` for things that look like leaked secrets.
 * Placeholder values (your-rpc-endpoint, change-me, all-zero addresses) are
 * ignored so the shipped `.env.example` doesn't trip the gate.
 */
export function scanForSecrets(root: string): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const abs of listFilesRecursive(root)) {
    if (SCAN_SKIP_EXT.has(path.extname(abs).toLowerCase())) continue;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    if (content.includes("\u0000")) continue; // binary (NUL byte)

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (PLACEHOLDER.test(line)) continue;
      for (const { kind, re } of SECRET_PATTERNS) {
        if (re.test(line)) findings.push({ file: rel, line: i + 1, kind });
      }
      if (looksLikeMnemonic(line)) {
        findings.push({ file: rel, line: i + 1, kind: "possible mnemonic phrase" });
      }
    }
  }
  return findings;
}

// ── Auto-redaction of identity / secrets in kept files ───────────────────────

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const RPC_PLACEHOLDER = "https://YOUR_RPC_ENDPOINT";
const ZERO_KEY = `0x${"0".repeat(64)}`;

export interface SensitiveValues {
  addresses: string[]; // lowercased, 0x + 40 hex
  rpcUrls: string[]; // full URLs
}

function addAddressesFrom(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) out.add(value.toLowerCase());
  } else if (Array.isArray(value)) {
    for (const v of value) addAddressesFrom(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) addAddressesFrom(v, out);
  }
}

/**
 * Gather the project's own identity + private endpoints from its live state, so
 * they can be redacted out of the files that ARE published (src, docs, comments).
 * The secret-bearing files themselves are dropped separately by buildCleanCopy.
 */
export function collectSensitiveValues(projectRoot: string): SensitiveValues {
  const addresses = new Set<string>();
  const rpcUrls = new Set<string>();

  const readJson = (rel: string): unknown => {
    try {
      return JSON.parse(fs.readFileSync(path.join(projectRoot, rel), "utf-8"));
    } catch {
      return null;
    }
  };

  // Every address in the identity/state files (SMA, owner, manager, signer,
  // historical managers, deployed mandate + attachment addresses).
  for (const rel of [
    ".sail/account.json",
    ".sail/mandate.json",
    ".sail/state/accounts.json",
    ".sail/state/mandates.json",
  ]) {
    addAddressesFrom(readJson(rel), addresses);
  }

  // RPC URLs (and any other real values) from the env files.
  for (const rel of [".sail/.env.local", ".env", ".env.local"]) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(projectRoot, rel), "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const val = trimmed
        .slice(trimmed.indexOf("=") + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (/^https?:\/\/\S+/.test(val) && !PLACEHOLDER.test(val)) rpcUrls.add(val);
      if (/^0x[0-9a-fA-F]{40}$/.test(val)) addresses.add(val.toLowerCase());
    }
  }

  return { addresses: [...addresses], rpcUrls: [...rpcUrls] };
}

export interface Redaction {
  file: string;
  kind: string;
  count: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite the cleaned copy in place: replace the project's own addresses and
 * private RPC URLs with neutral placeholders, and defensively neutralize any
 * stray private-key-shaped hex or RPC_URL assignment. Returns what was changed.
 */
export function autoRedact(dir: string, values: SensitiveValues): Redaction[] {
  const redactions: Redaction[] = [];

  // Longest first so substrings don't shadow longer matches.
  const knownAddrs = [...values.addresses].sort((a, b) => b.length - a.length);
  const knownRpcs = [...values.rpcUrls].sort((a, b) => b.length - a.length);

  for (const abs of listFilesRecursive(dir)) {
    if (SCAN_SKIP_EXT.has(path.extname(abs).toLowerCase())) continue;
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    if (content.includes("\u0000")) continue; // binary (NUL byte)

    const tally: Record<string, number> = {};
    const bump = (kind: string, n: number): void => {
      if (n > 0) tally[kind] = (tally[kind] ?? 0) + n;
    };

    for (const addr of knownAddrs) {
      const re = new RegExp(escapeRegExp(addr), "gi");
      const m = content.match(re);
      if (m) {
        content = content.replace(re, ZERO_ADDRESS);
        bump("sma/owner/manager address", m.length);
      }
    }
    for (const url of knownRpcs) {
      const re = new RegExp(escapeRegExp(url), "g");
      const m = content.match(re);
      if (m) {
        content = content.replace(re, RPC_PLACEHOLDER);
        bump("private rpc url", m.length);
      }
    }
    // Defensive generics for anything not in the known set.
    const rpcAssign = /((?:RPC_URL|_RPC_URL)\s*[:=]\s*['"]?)(https?:\/\/[^\s'"]+)/gi;
    content = content.replace(rpcAssign, (full, lead, val) => {
      if (PLACEHOLDER.test(val)) return full;
      bump("private rpc url", 1);
      return `${lead}${RPC_PLACEHOLDER}`;
    });
    const keyLike = /\b0x[0-9a-fA-F]{64}\b/g;
    const km = content.match(keyLike);
    if (km) {
      content = content.replace(keyLike, ZERO_KEY);
      bump("private-key-shaped hex", km.length);
    }

    if (Object.keys(tally).length > 0) {
      fs.writeFileSync(abs, content);
      for (const [kind, count] of Object.entries(tally))
        redactions.push({ file: rel, kind, count });
    }
  }

  return redactions;
}

/** Build the PR markdown body from a manifest. */
export function renderPrBody(m: ShareManifest): string {
  return [
    m.description?.trim() ? m.description.trim() : m.summary,
    "",
    "## Strategy",
    m.strategy,
    "",
    "## Mandate",
    m.mandate,
    "",
    "## Details",
    `- **Chains:** ${m.chains.join(", ")}`,
    `- **Tags:** ${m.tags.length ? m.tags.join(", ") : "—"}`,
    `- **Author:** ${m.author}`,
    `- **Sailor version:** ${m.sailorVersion}`,
    "",
    "_Opened by `sailor share`._",
  ].join("\n");
}
