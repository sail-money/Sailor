import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Safety for `sailor clone` — a shared project is UNTRUSTED code from a stranger
 * that, once onboarded, can move the cloner's funds. These helpers (a) extract
 * archives without letting them escape the target (zip-slip / symlink / bomb),
 * and (b) surface what the cloner must scrutinize before running: hardcoded
 * addresses (a malicious mandate hardcodes the attacker's payout address — which
 * redaction never touches, since it's not the sharer's identity) and code that
 * auto-executes (npm lifecycle scripts).
 */

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024; // 25 MB compressed
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024; // 100 MB uncompressed
const MAX_ENTRIES = 5000;

/** List archive entry names without extracting (tar -tzf / unzip -Z1). */
function listEntries(archivePath: string): string[] {
  const out = archivePath.endsWith(".zip")
    ? execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf-8" })
    : execFileSync("tar", ["-tzf", archivePath], { encoding: "utf-8" });
  return out.split(/\r?\n/).filter(Boolean);
}

/** Reject an entry path that is absolute or escapes the target via `..`. */
function entryEscapes(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[A-Za-z]:/.test(n)) return true; // absolute
  return n.split("/").some((seg) => seg === "..");
}

/**
 * Refuse — BEFORE extracting a single byte — any archive that contains a symlink
 * or hardlink entry. A symlink dir entry followed by a write through it lets the
 * archive escape `dest` *during* extraction, before any post-extraction walk can
 * see it. Names alone can't reveal this (a link name has no `..`), so we read the
 * verbose listing and match the entry type: the leading `l`/`h` of the ls -l–style
 * mode column (stable across GNU tar, bsdtar, and zipinfo) plus the `->` / `link to`
 * target markers as a belt-and-suspenders backstop.
 */
function assertNoLinkEntries(archivePath: string): void {
  const verbose = archivePath.endsWith(".zip")
    ? execFileSync("unzip", ["-Z", archivePath], { encoding: "utf-8" })
    : execFileSync("tar", ["-tvzf", archivePath], { encoding: "utf-8" });
  for (const raw of verbose.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[lh][-rwxsStT]{9}/.test(line) || / -> /.test(line) || / link to /.test(line)) {
      throw new Error(
        `Refusing to extract: archive contains a symlink/hardlink entry — possible escape attack: "${line.slice(-120)}"`,
      );
    }
  }
}

/**
 * Extract `archivePath` into `dest` with guards: refuse zip-slip / absolute
 * paths, reject symlink/hardlink entries BEFORE extracting (they can redirect a
 * write outside `dest` mid-extraction, before any post-scan runs), cap entry
 * count + compressed + uncompressed size, and re-check for symlinks in the
 * result. Throws on any violation — better to refuse than to clone a
 * booby-trapped archive.
 */
export function safeExtract(archivePath: string, dest: string): void {
  const stat = fs.statSync(archivePath);
  if (stat.size > MAX_ARCHIVE_BYTES) {
    throw new Error(
      `Archive is ${(stat.size / 1e6).toFixed(1)} MB — over the ${MAX_ARCHIVE_BYTES / 1e6} MB limit. Refusing to extract.`,
    );
  }

  const entries = listEntries(archivePath);
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Archive has ${entries.length} entries — over the ${MAX_ENTRIES} limit.`);
  }
  const bad = entries.find(entryEscapes);
  if (bad) {
    throw new Error(`Refusing to extract: archive entry escapes the target directory: "${bad}"`);
  }
  // Reject links up front — the primary defense against symlink write-through.
  assertNoLinkEntries(archivePath);

  fs.mkdirSync(dest, { recursive: true });
  if (archivePath.endsWith(".zip")) {
    execFileSync("unzip", ["-q", "-o", archivePath, "-d", dest], { stdio: "inherit" });
  } else {
    execFileSync("tar", ["-xzf", archivePath, "-C", dest], { stdio: "inherit" });
  }

  // Post-extraction backstop: reject symlinks and enforce the uncompressed size cap.
  let total = 0;
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        throw new Error(
          `Refusing to clone: archive contains a symlink (${path.relative(dest, abs)}) — possible escape attack.`,
        );
      }
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        total += fs.statSync(abs).size;
        if (total > MAX_EXTRACTED_BYTES) {
          throw new Error(
            `Refusing to clone: extracted size exceeds ${MAX_EXTRACTED_BYTES / 1e6} MB (decompression bomb?).`,
          );
        }
      }
    }
  };
  walk(dest);
}

export interface CloneAudit {
  addresses: string[]; // distinct non-zero addresses hardcoded in mandates/ + src/
  lifecycleScripts: { script: string; command: string }[]; // npm hooks that auto-run
}

const HARDCODED_SCAN_DIRS = ["mandates", "src", "test"];
const LIFECYCLE_HOOKS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
  "prepack",
];

/**
 * What the cloner must review before onboarding/running an untrusted project:
 * non-zero addresses hardcoded in the strategy/mandate code (a hostile mandate
 * routes funds to the attacker's address — never redacted, since it isn't the
 * sharer's identity) and npm lifecycle scripts that execute on `npm install`.
 */
export function auditClonedProject(projectRoot: string): CloneAudit {
  const addresses = new Set<string>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".git") walk(abs);
      } else if (e.isFile()) {
        let content: string;
        try {
          content = fs.readFileSync(abs, "utf-8");
        } catch {
          continue;
        }
        if (content.includes("\u0000")) continue;
        for (const m of content.match(/0x[0-9a-fA-F]{40}/g) ?? []) {
          if (!/^0x0{40}$/i.test(m)) addresses.add(m);
        }
      }
    }
  };
  for (const d of HARDCODED_SCAN_DIRS) walk(path.join(projectRoot, d));

  const lifecycleScripts: { script: string; command: string }[] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    for (const hook of LIFECYCLE_HOOKS) {
      const cmd = pkg.scripts?.[hook];
      if (cmd) lifecycleScripts.push({ script: hook, command: cmd });
    }
  } catch {
    /* no package.json / unparseable */
  }

  return { addresses: [...addresses].sort(), lifecycleScripts };
}
