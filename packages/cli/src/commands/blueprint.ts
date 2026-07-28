import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ArtifactReader,
  type BlueprintManifest,
  isSafeRelativePath,
  verifyArtifact,
} from "@sail/sdk/blueprint";
import { safeExtract } from "../lib/clone-safety.js";
import { confirm } from "../lib/io.js";
import { packageRoot } from "../lib/packagePaths.js";
import { scanForSecrets } from "../lib/share.js";

/**
 * `sailor blueprint verify | inspect | import` — the consuming half of the blueprint
 * artifact contract.
 *
 * A blueprint is a DELTA over the stock scaffold, not a whole project: it replaces the
 * agent surface, prunes what its frozen design made dead, and ships generators, contracts
 * and a runtime skeleton. So `import` lands on a project that already exists (`sailor init`),
 * rather than creating one — which is what distinguishes it from `clone`.
 *
 * Why not just extend `clone`: `share`/`clone` strip and re-inject CORE_REUSE_PATHS
 * (AGENTS.md, .agents/, examples/) on the assumption that the agent surface is generic and
 * the receiver has its own copy. For a blueprint the agent surface IS the product, so that
 * assumption inverts — see the header of Shipwright's blueprint-pkg.mjs for the measured
 * detail.
 *
 * Verification is NOT implemented here. `verifyArtifact` lives in `@sail/sdk/blueprint` so
 * that the producer cannot certify its own output against a friendlier rule than the
 * consumer applies, and so this command and the factory check the identical contract.
 *
 * INTEGRITY, NOT AUTHENTICITY. A clean verify means the artifact is internally consistent —
 * nothing was corrupted, truncated or edited by accident. It says nothing about who produced
 * it or whether its code is safe to run: an attacker who edits a payload file simply
 * recomputes the digests. Treat an imported blueprint as untrusted code and read it. Origin
 * guarantees need signing, which is deliberately out of scope (roadmap phase 07).
 */

const MANIFEST_NAME = "blueprint.manifest.json";

/** Never removable by a `surface.pruned` entry, whatever a manifest asks for. */
const PRUNE_PROTECTED = [
  ".sail",
  ".shipyard",
  ".git",
  "node_modules",
  "package.json",
  "package-lock.json",
  ".env",
  ".env.local",
];

export interface BlueprintVerifyOptions {
  chain?: string;
  json?: boolean;
}

export interface BlueprintImportOptions extends BlueprintVerifyOptions {
  yes?: boolean;
  dryRun?: boolean;
}

interface LoadedArtifact {
  root: string;
  payload: string;
  manifest: BlueprintManifest;
  cleanup: () => void;
}

/** Same resolution index.ts uses; kept local so this module has no import cycle with it. */
function cliVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot(), "package.json"), "utf-8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Resolve an artifact source to an on-disk tree.
 *
 * An archive goes through `safeExtract` — the same hardening `clone` uses (size and entry
 * caps, `..`/absolute refusal, and symlink/hardlink rejection *before* a byte is written,
 * since a symlinked directory entry can redirect a write outside the target mid-extraction).
 */
function loadArtifact(source: string): LoadedArtifact {
  const abs = path.resolve(source);
  if (!fs.existsSync(abs)) throw new Error(`No such artifact: ${source}`);

  let root = abs;
  let cleanup = () => {};
  if (fs.statSync(abs).isFile()) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-blueprint-"));
    safeExtract(abs, temp);
    root = temp;
    cleanup = () => fs.rmSync(temp, { recursive: true, force: true });
  }

  const manifestPath = path.join(root, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    cleanup();
    throw new Error(`Artifact is missing ${MANIFEST_NAME} — not a blueprint artifact.`);
  }
  let manifest: BlueprintManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as BlueprintManifest;
  } catch (e) {
    cleanup();
    throw new Error(`${MANIFEST_NAME} is not valid JSON: ${(e as Error).message}`);
  }

  const payload = path.join(root, "payload");
  if (!fs.existsSync(payload)) {
    cleanup();
    throw new Error(`Artifact has no payload/ directory — nothing to import.`);
  }
  return { root, payload, manifest, cleanup };
}

function listRel(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push(path.relative(dir, abs).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

function readerFor(payload: string): ArtifactReader {
  return {
    read: async (p: string) => {
      if (!isSafeRelativePath(p)) return null;
      const abs = path.join(payload, p);
      return fs.existsSync(abs) && fs.statSync(abs).isFile() ? new Uint8Array(fs.readFileSync(abs)) : null;
    },
    list: async () => listRel(payload),
  };
}

function describe(m: BlueprintManifest): string {
  const b = m.blueprint ?? ({} as BlueprintManifest["blueprint"]);
  return `${b.slug}@${b.version} [${b.kind}]`;
}

// ── verify ─────────────────────────────────────────────────────────────────────

export async function blueprintVerify(source: string, opts: BlueprintVerifyOptions): Promise<void> {
  const art = loadArtifact(source);
  try {
    const result = await verifyArtifact(art.manifest, readerFor(art.payload), {
      sailorVersion: cliVersion(),
      chainId: opts.chain ? Number(opts.chain) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify({ status: result.ok ? "ok" : "refused", ...result }, null, 2));
    } else {
      console.log(`${describe(art.manifest)}  ${art.manifest.contents?.length ?? 0} file(s)`);
      if (result.ok) {
        console.log("✓ verified — manifest, per-file hashes and declared compatibility all agree.");
        console.log("  This is an INTEGRITY check, not a signature: it proves nothing about origin.");
      } else {
        console.log(`✗ refused — ${result.findings.length} finding(s):`);
        for (const f of result.findings) console.log(`  [${f.code}] ${f.path ? `${f.path}: ` : ""}${f.message}`);
      }
    }
    if (!result.ok) process.exitCode = 1;
  } finally {
    art.cleanup();
  }
}

// ── inspect ────────────────────────────────────────────────────────────────────

export async function blueprintInspect(source: string, opts: { json?: boolean }): Promise<void> {
  const art = loadArtifact(source);
  try {
    const m = art.manifest;
    if (opts.json) {
      console.log(JSON.stringify(m, null, 2));
      return;
    }
    console.log(`${describe(m)}  ${m.schemaVersion}`);
    console.log(`  digest    ${m.digest}`);
    console.log(`  contents  ${m.contents?.length ?? 0} file(s)`);
    const byRole = new Map<string, string[]>();
    for (const c of m.contents ?? []) byRole.set(c.role, [...(byRole.get(c.role) ?? []), c.path]);
    for (const [role, paths] of [...byRole].sort()) {
      console.log(`    ${role} (${paths.length})`);
      for (const p of paths) console.log(`      ${p}`);
    }
    if (m.surface?.pruned?.length) {
      console.log(`  removes   ${m.surface.pruned.length} stock path(s): ${m.surface.pruned.join(", ")}`);
    }
    if (m.surface?.keepSkills) {
      console.log(`  keeps     stock skills: ${m.surface.keepSkills.join(", ") || "(none)"} — all others pruned`);
    }
    if (m.surface?.fragment) {
      console.log(`  appends   ${m.surface.fragment.path} into ${m.surface.fragment.target}`);
    }
    if (m.compatibility) console.log(`  compat    ${JSON.stringify(m.compatibility)}`);
    if (m.provenance) console.log(`  claims    ${JSON.stringify(m.provenance)}`);
    console.log("  inspect does NOT verify — run `sailor blueprint verify` before importing.");
  } finally {
    art.cleanup();
  }
}

// ── import ─────────────────────────────────────────────────────────────────────

/**
 * Resolve a manifest-declared path against the project, refusing anything that escapes it
 * or touches protected state. Mirrors kit.mjs `prunablePath`: an absolute path is an error
 * rather than being silently reinterpreted as relative.
 */
function safeTarget(projectRoot: string, rel: string): string | null {
  if (!isSafeRelativePath(rel)) return null;
  const head = rel.split("/")[0];
  if (PRUNE_PROTECTED.includes(head) || PRUNE_PROTECTED.includes(rel)) return null;
  const projAbs = path.resolve(projectRoot);
  const abs = path.resolve(projAbs, rel);
  if (abs === projAbs || !abs.startsWith(projAbs + path.sep)) return null;
  return abs;
}

export async function blueprintImport(
  source: string,
  dir: string | undefined,
  opts: BlueprintImportOptions,
): Promise<void> {
  const projectRoot = path.resolve(dir ?? process.cwd());
  const art = loadArtifact(source);

  try {
    const m = art.manifest;

    // 1. A blueprint is a delta, so it needs a project to land on.
    if (!fs.existsSync(path.join(projectRoot, ".sail"))) {
      throw new Error(
        `${projectRoot} is not a Sailor project (no .sail/). Run \`sailor init\` there first — ` +
          `a blueprint is an overlay on a scaffold, not a whole project.`,
      );
    }

    // 2. Verify. Fail-closed and no override flag: an artifact that does not match its own
    //    manifest is not a candidate for "import anyway".
    const result = await verifyArtifact(m, readerFor(art.payload), {
      sailorVersion: cliVersion(),
      chainId: opts.chain ? Number(opts.chain) : undefined,
    });
    if (!result.ok) {
      console.error(`Refusing to import ${describe(m)} — ${result.findings.length} verification finding(s):`);
      for (const f of result.findings) console.error(`  [${f.code}] ${f.path ? `${f.path}: ` : ""}${f.message}`);
      throw new Error("artifact failed verification");
    }

    // 3. Secret scan on the payload. `clone` never did this — export-side scanning cannot
    //    cover an artifact that arrived from somewhere else.
    const secrets = scanForSecrets(art.payload);
    if (secrets.length) {
      console.error(`Refusing to import — ${secrets.length} possible secret(s) in the payload:`);
      for (const s of secrets) console.error(`  payload/${s.file}:${s.line} ${s.kind}`);
      throw new Error("payload contains possible secrets");
    }

    // 4. Auto-executing code. A kit ships no package.json, so this should never fire — but
    //    it is the one thing that would run without being read.
    const payloadPkg = path.join(art.payload, "package.json");
    if (fs.existsSync(payloadPkg)) {
      const hooks = ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepack"];
      const pkg = JSON.parse(fs.readFileSync(payloadPkg, "utf-8")) as { scripts?: Record<string, string> };
      const found = hooks.filter((h) => pkg.scripts?.[h]);
      if (found.length) throw new Error(`payload package.json defines auto-running scripts: ${found.join(", ")}`);
    }

    // 5. Plan every filesystem change before making any of them, so the operator confirms a
    //    complete picture and a refusal costs nothing.
    const writes: { rel: string; abs: string; role: string; overwrites: boolean }[] = [];
    for (const entry of m.contents) {
      if (m.surface?.fragment && entry.path === m.surface.fragment.path) continue; // appended, not copied
      const abs = safeTarget(projectRoot, entry.path);
      if (!abs) throw new Error(`manifest declares an unsafe destination: ${entry.path}`);
      writes.push({ rel: entry.path, abs, role: entry.role, overwrites: fs.existsSync(abs) });
    }

    const removals: string[] = [];
    const refusedPrunes: string[] = [];
    for (const rel of m.surface?.pruned ?? []) {
      const abs = safeTarget(projectRoot, rel);
      if (!abs) {
        refusedPrunes.push(rel);
        continue;
      }
      if (fs.existsSync(abs)) removals.push(rel);
    }

    // keepSkills: every stock skill the frozen design no longer needs. A skill the artifact
    // itself ships is never removable — it would delete what it just installed.
    const shipped = new Set(
      m.contents
        .map((c) => /^\.agents\/skills\/([^/]+)\//.exec(c.path)?.[1])
        .filter((s): s is string => Boolean(s)),
    );
    const skillsDir = path.join(projectRoot, ".agents", "skills");
    if (Array.isArray(m.surface?.keepSkills) && fs.existsSync(skillsDir)) {
      const keep = new Set([...m.surface.keepSkills, ...shipped]);
      for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (e.isDirectory() && !keep.has(e.name)) removals.push(`.agents/skills/${e.name}`);
      }
    }

    console.log(`${describe(m)} → ${projectRoot}`);
    console.log(`  ✓ verified (integrity only — origin is not authenticated)`);
    console.log(`  writes   ${writes.length} file(s), ${writes.filter((w) => w.overwrites).length} overwriting`);
    for (const w of writes) console.log(`    ${w.overwrites ? "replace" : "add    "} ${w.role.padEnd(13)} ${w.rel}`);
    if (m.surface?.fragment) console.log(`    append  ${m.surface.fragment.path} → ${m.surface.fragment.target}`);
    if (removals.length) {
      console.log(`  removes  ${removals.length} stock path(s) the blueprint's design does not use:`);
      for (const r of [...removals].sort()) console.log(`    ${r}`);
    }
    for (const r of refusedPrunes) console.log(`  (refused to remove protected/escaping path) ${r}`);
    const pinned = pinnedAddresses(m);
    if (pinned.length) {
      console.log(`  pins     ${pinned.length} on-chain address(es) — covered by the verified digest, but READ them:`);
      for (const a of pinned) console.log(`    ${a}`);
    }

    if (opts.dryRun) {
      console.log("\n--dry-run: nothing written.");
      return;
    }

    // 6. Confirm. Non-interactive without --yes REFUSES rather than proceeding, which is the
    //    opposite of `clone`, where --yes/--json skips its audit gate entirely.
    if (!opts.yes) {
      if (process.stdin.isTTY !== true) {
        throw new Error("not a TTY and --yes was not given; refusing to modify the project unattended");
      }
      console.log("\nThis is untrusted code that will run against your account once onboarded.");
      if (!(await confirm("Apply this blueprint?"))) {
        console.log("Aborted; nothing written.");
        return;
      }
    }

    // 7. Apply: remove first, then write, then append — the same order kit.mjs uses, so a
    //    file the artifact provides is never deleted by a later prune rule.
    for (const rel of removals) {
      const abs = safeTarget(projectRoot, rel);
      if (abs) fs.rmSync(abs, { recursive: true, force: true });
    }
    for (const w of writes) {
      fs.mkdirSync(path.dirname(w.abs), { recursive: true });
      fs.copyFileSync(path.join(art.payload, w.rel), w.abs);
    }
    if (m.surface?.fragment) applyFragment(projectRoot, art.payload, m.surface.fragment);

    // 8. Post-condition: assert the delivered surface is actually the artifact's. This is what
    //    catches a crystallized blueprint having been quietly reverted to the stock surface —
    //    the failure mode that otherwise looks like a successful import.
    const problems = assertApplied(projectRoot, m, shipped);
    if (problems.length) {
      console.error("\nImport wrote files but the result does not match the manifest:");
      for (const p of problems) console.error(`  ${p}`);
      throw new Error("post-import verification failed");
    }

    console.log(`\n✓ imported ${describe(m)}`);
    console.log(`  ${writes.length} file(s) written, ${removals.length} removed, surface verified against the manifest.`);
    // The manifest is deliberately NOT copied into the project: it names the blueprint, its
    // version and its grade, and a project carrying that is no longer a blind subject for a
    // later measurement cycle. Provenance goes to the operator's terminal instead.
    console.log(`  provenance (not written into the project): ${JSON.stringify(m.provenance ?? {})}`);
    console.log(`  next: npm install, then read AGENTS.md.`);
  } finally {
    art.cleanup();
  }
}

/** Addresses the artifact pins. Informational: a blueprint legitimately fixes venue singletons. */
function pinnedAddresses(m: BlueprintManifest): string[] {
  const out = new Set<string>();
  for (const byChain of Object.values(m.compatibility?.singletons ?? {})) {
    for (const addr of Object.values(byChain)) out.add(addr);
  }
  for (const addr of Object.values(m.compatibility?.kernel ?? {})) out.add(addr);
  return [...out].sort();
}

/** Insert or replace a marker-bounded block, matching kit.mjs `upsertBlock` so re-import is idempotent. */
function applyFragment(
  projectRoot: string,
  payload: string,
  fragment: { path: string; target: string; marker: string },
): void {
  const target = safeTarget(projectRoot, fragment.target);
  if (!target) throw new Error(`fragment target is not a safe path: ${fragment.target}`);
  const body = fs.readFileSync(path.join(payload, fragment.path), "utf-8").trim();
  const start = `<!-- ${fragment.marker}:start -->`;
  const end = `<!-- ${fragment.marker}:end -->`;
  const block = `${start}\n${body}\n${end}\n`;
  const re = new RegExp(`<!-- ${fragment.marker}:start[^\\n]*-->[\\s\\S]*?<!-- ${fragment.marker}:end -->\\n?`, "g");

  let content = fs.existsSync(target) ? fs.readFileSync(target, "utf-8").replace(re, "") : "";
  if (content.length && !content.endsWith("\n")) content += "\n";
  if (content.length) content += "\n";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content + block);
}

/** Did the project end up as the manifest describes? */
function assertApplied(projectRoot: string, m: BlueprintManifest, shipped: Set<string>): string[] {
  const problems: string[] = [];

  for (const entry of m.contents) {
    if (m.surface?.fragment && entry.path === m.surface.fragment.path) continue;
    const abs = path.join(projectRoot, entry.path);
    if (!fs.existsSync(abs)) {
      problems.push(`${entry.path}: declared but not present after import`);
      continue;
    }
    const actual = sha256HexSync(fs.readFileSync(abs));
    if (actual !== entry.sha256) {
      problems.push(`${entry.path}: on-disk sha256 ${actual} != manifest ${entry.sha256}`);
    }
  }

  for (const rel of m.surface?.pruned ?? []) {
    if (safeTarget(projectRoot, rel) && fs.existsSync(path.join(projectRoot, rel))) {
      problems.push(`${rel}: declared pruned but still present`);
    }
  }

  const skillsDir = path.join(projectRoot, ".agents", "skills");
  if (Array.isArray(m.surface?.keepSkills) && fs.existsSync(skillsDir)) {
    const keep = new Set([...m.surface.keepSkills, ...shipped]);
    for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (e.isDirectory() && !keep.has(e.name)) problems.push(`.agents/skills/${e.name}: should have been pruned`);
    }
  }

  return problems;
}

/**
 * Synchronous sha256 for the post-import check.
 *
 * The SDK's `sha256Hex` is async because it uses WebCrypto to stay browser-usable; this call
 * site is Node-only and inside a synchronous walk, so it uses node:crypto directly. Same
 * algorithm over the same bytes — and it is only a post-condition check. The authority on
 * per-file hashes is `verifyArtifact`, which already gated the import above.
 */
function sha256HexSync(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
