import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type BlueprintManifest,
  type ContentRole,
  MANIFEST_VERSION,
  type ManifestEntry,
  computeManifestDigest,
  sha256Hex,
} from "@sail/sdk/blueprint";
import {
  type Redaction,
  type ReviewSurface,
  autoRedact,
  collectSensitiveValues,
  isSensitivePath,
  reviewSurface,
  scanForSecrets,
} from "./share.js";
import { TEMPLATE_COPY_EXCLUDES } from "./template.js";

/**
 * Blueprint producer: turn a live Sailor project into a self-contained blueprint
 * artifact (Model C). The payload is the *agent surface* — skills, AGENTS.md,
 * soul.md, src/, package.json, contracts — everything `blueprint start` needs that
 * the skeleton (`.sail/`, env templates) does not provide. `.sail/` and `.env*` are
 * deliberately excluded: `scaffoldProjectWorkspace` recreates them fresh at start.
 *
 * The publisher's own identity is redacted (addresses → zero, private RPC URLs →
 * placeholder) and the result is secret-scanned, exactly as `sailor share` does —
 * the difference is the file selection (keep `.agents/` and `AGENTS.md`; drop all of
 * `.sail/` and `.env*`) and the output shape (`blueprint.manifest.json` + `payload/`).
 */

// ── file selection ─────────────────────────────────────────────────────────────

/** True if a project-relative path is NOT part of a blueprint's agent surface. */
function isBlueprintExcluded(rel: string): boolean {
  const p = rel.split(path.sep).join("/");
  // The skeleton owns .sail/ (keys, state, config) and every env template; both are
  // recreated by scaffoldProjectWorkspace, so a blueprint must not ship either.
  if (p === ".sail" || p.startsWith(".sail/")) return true;
  if (p === ".env" || p.startsWith(".env.")) return true;
  // A blueprint archive is the deliverable, not payload content. `publish --local`
  // drops its own .tar.gz into the project, and without this it would nest into the
  // next publish. Skip any archive file so a stray one can never self-nest.
  if (p.endsWith(".tar.gz") || p.endsWith(".tgz") || p.endsWith(".zip")) return true;
  // Everything else is the share machinery's junk/credential/editor/Safe-tx rules.
  return isSensitivePath(rel);
}

/** A file's manifest role. The load-bearing one is `agent-surface` (the product). */
function roleFor(rel: string): ContentRole {
  if (rel.endsWith(".sol")) return "contract";
  if (rel === "package.json" || rel === "tsconfig.json" || rel === "foundry.toml") return "config";
  return "agent-surface";
}

/**
 * Copy the agent surface of `srcRoot` into `destRoot`, skipping build/VCS dirs,
 * `.sail/`, `.env*`, and every sensitive/junk path. Returns the sorted list of
 * project-relative POSIX paths written (the payload file list).
 */
function buildBlueprintCopy(srcRoot: string, destRoot: string): string[] {
  const written: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (TEMPLATE_COPY_EXCLUDES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(srcRoot, abs);
      if (isBlueprintExcluded(rel)) continue;
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const destAbs = path.join(destRoot, rel);
        fs.mkdirSync(path.dirname(destAbs), { recursive: true });
        fs.copyFileSync(abs, destAbs);
        written.push(rel.split(path.sep).join("/"));
      }
    }
  };
  walk(srcRoot);
  return written.sort();
}

// ── pack ───────────────────────────────────────────────────────────────────────

export interface PackBlueprintOptions {
  slug: string;
  version: string;
  kind: "guidance" | "crystallized";
  chains?: number[];
  author?: string;
}

export interface PackedBlueprint {
  manifest: BlueprintManifest;
  /** POSIX path → redacted file bytes. These are the `payload/` contents. */
  files: Map<string, Uint8Array>;
  redactions: Redaction[];
  review: ReviewSurface;
}

/**
 * Build a blueprint from a live project: redact the publisher's identity, refuse on
 * residual secrets, hash every payload file, and assemble the manifest + digest.
 * Returns the manifest and the redacted payload bytes; the caller decides whether
 * to write them to disk (`.tar.gz` via {@link writeBlueprintArchive}) or inspect them.
 */
export async function packBlueprint(
  projectRoot: string,
  opts: PackBlueprintOptions,
): Promise<PackedBlueprint> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-blueprint-pack-"));
  try {
    // 1. Copy the agent surface into a clean tree, then redact the operator's identity.
    const values = collectSensitiveValues(projectRoot);
    const rels = buildBlueprintCopy(projectRoot, tmp);
    const redactions = autoRedact(tmp, values);

    // 2. Refuse on anything secret-like that survived redaction.
    const secrets = scanForSecrets(tmp);
    if (secrets.length > 0) {
      const detail = secrets.map((s) => `${s.file}:${s.line} ${s.kind}`).join("; ");
      throw new Error(`possible secrets remain after redaction: ${detail}`);
    }

    // 3. Hash every payload file and assign roles.
    const contents: ManifestEntry[] = [];
    const files = new Map<string, Uint8Array>();
    for (const rel of rels) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(tmp, rel)));
      files.set(rel, bytes);
      contents.push({
        path: rel,
        sha256: await sha256Hex(bytes),
        bytes: bytes.length,
        role: roleFor(rel),
      });
    }

    // 4. Assemble the manifest and its digest.
    const manifest: BlueprintManifest = {
      schemaVersion: MANIFEST_VERSION,
      blueprint: { slug: opts.slug, version: opts.version, kind: opts.kind },
      digest: "",
      contents,
      ...(opts.chains && opts.chains.length > 0 ? { compatibility: { chains: opts.chains } } : {}),
      ...(opts.author
        ? { provenance: { producedBy: opts.author, producedAt: new Date().toISOString() } }
        : {}),
    };
    manifest.digest = await computeManifestDigest(manifest);

    return { manifest, files, redactions, review: reviewSurface(tmp) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Write a packed blueprint as a `.tar.gz` containing `blueprint.manifest.json` and
 * `payload/`, in exactly the shape `blueprint import` (`loadArtifact`) reads back.
 * Returns the path of the archive; the caller owns cleaning it up.
 */
export function writeBlueprintArchive(packed: PackedBlueprint): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-blueprint-archive-"));
  fs.writeFileSync(
    path.join(tmp, "blueprint.manifest.json"),
    `${JSON.stringify(packed.manifest, null, 2)}\n`,
    "utf-8",
  );
  const payloadDir = path.join(tmp, "payload");
  for (const [rel, bytes] of packed.files) {
    const dest = path.join(payloadDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
  }
  const out = path.join(tmp, "blueprint.tar.gz");
  execFileSync("tar", ["-czf", out, "-C", tmp, "blueprint.manifest.json", "payload"], {
    stdio: "ignore",
  });
  return out;
}
