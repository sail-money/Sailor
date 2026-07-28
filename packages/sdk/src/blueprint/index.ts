/**
 * Blueprint artifact contract — the shared boundary between a blueprint producer
 * (the Shipwright factory) and a consumer (`sailor blueprint import`).
 *
 * This module lives in the SDK on purpose. Producer and consumer must agree
 * byte-for-byte on the digest and the manifest shape, or verification is theatre —
 * so the digest, the schema constants and the verifier ship together, through the
 * same channel the consumer already trusts. A verifier vendored inside the artifact
 * would mean running code supplied by the thing under test.
 *
 * Deliberately dependency-free and side-effect-free:
 *   - no `fs`, no network — `verifyArtifact` takes an injected {@link ArtifactReader},
 *     so it works over a tarball, a directory or an in-memory map, and is testable
 *     without building archives;
 *   - WebCrypto (`crypto.subtle`) rather than `node:crypto`, so this subpath stays
 *     usable in a browser as well as Node >= 18. Digests are therefore async.
 *
 * INTEGRITY, NOT AUTHENTICITY. Every check here detects accidental corruption —
 * a truncated file, a bad merge, a hand-edited manifest. None of it resists a
 * deliberate attacker, who would simply recompute the digests after editing. Trust
 * in the *origin* of an artifact requires signing, which is deliberately out of
 * scope here (roadmap phase 07). Do not present a passing `verifyArtifact` as proof
 * that an artifact is safe to run — only that it is internally consistent.
 */

/** Schema id for the manifest. Mirrors the `shipwright.benchmark.<record>/v1` convention. */
export const MANIFEST_VERSION = "shipwright.blueprint.manifest/v1";

/** Prefix every digest carries, so a digest is never mistaken for a bare hash. */
const DIGEST_PREFIX = "sha256:";

/** Matches a full digest. Kept identical to the frozen benchmark-contract `DIGEST_RE`. */
export const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

/**
 * What a payload file is FOR. `agent-surface` is the load-bearing one: it marks a
 * file as the delivered product rather than replaceable scaffolding, which is what
 * stops an importer's "restore missing core files" step from silently reverting a
 * crystallized blueprint to the stock surface it deliberately replaced.
 */
export type ContentRole =
  | "agent-surface"
  | "generator"
  | "runtime"
  | "contract"
  | "config"
  | "schema"
  | "evaluator"
  | "example";

export interface ManifestEntry {
  /** POSIX, project-relative. Never absolute, never containing `..`. */
  path: string;
  /** Lowercase hex sha256 of the file's bytes, unprefixed. */
  sha256: string;
  bytes?: number;
  role: ContentRole;
  /** Optional schema id the file's own content declares (e.g. `sail.dca.config/v1`). */
  schema?: string;
}

export interface BlueprintManifest {
  schemaVersion: string;
  blueprint: { slug: string; version: string; kind: "guidance" | "crystallized" };
  /** Digest over this whole manifest with `digest` itself removed. See {@link computeManifestDigest}. */
  digest: string;
  contents: ManifestEntry[];
  surface?: {
    keepSkills?: string[];
    /** Paths absent ON PURPOSE. Their presence is a finding, not their absence. */
    pruned?: string[];
    replaces?: string[];
    /**
     * A guidance kit appends a marker-bounded block into an existing file rather than
     * replacing it. `path` is the payload file (and must also appear in `contents`);
     * `target` is the project file it is appended into. Absent for a crystallized kit,
     * which ships a whole agent surface instead. An importer that copied this as a plain
     * file would clobber the target it was meant to extend.
     */
    fragment?: { path: string; target: string; marker: string };
  };
  compatibility?: {
    /** Range the consuming Sailor CLI must satisfy. See {@link satisfiesRange} for the supported subset. */
    sailor?: string;
    sdk?: string;
    node?: string;
    chains?: number[];
    kernel?: Record<string, string>;
    singletons?: Record<string, Record<string, string>>;
  };
  provenance?: {
    producedBy?: string;
    kitHash?: string;
    cycle?: number;
    grade?: string;
    score?: number;
    producedAt?: string;
  };
  evaluatorPack?: { kpis?: string; fixtures?: string[] };
}

export type FindingCode =
  | "manifest_invalid"
  | "schema_version_mismatch"
  | "digest_mismatch"
  | "file_missing"
  | "hash_mismatch"
  | "unexpected_file"
  | "pruned_file_present"
  | "unsafe_path"
  | "incompatible_sailor"
  | "incompatible_chain"
  | "unparseable_constraint";

export interface VerifyFinding {
  code: FindingCode;
  message: string;
  path?: string;
}

export interface VerifyResult {
  ok: boolean;
  findings: VerifyFinding[];
}

/** Supplies artifact bytes to {@link verifyArtifact}. Return `null` for an absent path. */
export interface ArtifactReader {
  read(path: string): Promise<Uint8Array | null>;
  /**
   * Every path the artifact actually contains. Optional — but without it an extra,
   * unlisted file cannot be detected, so `verifyArtifact` reports that gap rather
   * than staying silent about it.
   */
  list?(): Promise<string[]>;
}

export interface VerifyOptions {
  /** Version of the consuming Sailor CLI, checked against `compatibility.sailor`. */
  sailorVersion?: string;
  /** Chain the artifact is being imported for, checked against `compatibility.chains`. */
  chainId?: number;
}

// ── digests ────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  let out = "";
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Lowercase hex sha256 of raw bytes, unprefixed — the form used in `contents[].sha256`. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `as BufferSource` keeps this compiling against both DOM and Node lib typings.
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return toHex(buf);
}

/**
 * Canonical JSON: object keys sorted recursively, array order preserved.
 *
 * Throws on `undefined` and on non-finite numbers rather than coercing them, so two
 * materially different values can never canonicalize to the same string — the same
 * guarantee `assertFiniteJson` gives on the benchmark side.
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown, path: string): unknown => {
    if (v === undefined) throw new TypeError(`undefined is not canonicalizable at ${path}`);
    if (typeof v === "number" && !Number.isFinite(v)) {
      throw new TypeError(`non-finite number at ${path}`);
    }
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((item, i) => walk(item, `${path}[${i}]`));
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = walk(src[key], `${path}.${key}`);
    return out;
  };
  return JSON.stringify(walk(value, "$"));
}

/**
 * Digest over a directory-shaped file set: sorted by POSIX path, absorbing
 * `path \0 bytes \0` per file.
 *
 * This is the canonicalization Shipwright's `kit.mjs contentHash` already uses, kept
 * deliberately identical so that script can delegate here instead of maintaining a
 * second implementation of the one value that must never disagree. The only change
 * is the output: full 64-hex and `sha256:`-prefixed, so it satisfies {@link DIGEST_RE}
 * (the truncated, unprefixed 16-char form never could). Use {@link shortDigest} where
 * a human-readable short hash is wanted.
 */
export async function computeContentDigest(
  files: ReadonlyArray<{ path: string; bytes: Uint8Array }>,
): Promise<string> {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const parts: Uint8Array[] = [];
  const NUL = new Uint8Array([0]);
  for (const f of sorted) {
    parts.push(encoder.encode(f.path), NUL, f.bytes, NUL);
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const joined = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    at += p.length;
  }
  return DIGEST_PREFIX + (await sha256Hex(joined));
}

/**
 * The manifest's own digest: computed over the whole manifest with `digest` (and any
 * `$schema` annotation) removed, then canonicalized.
 *
 * Because `contents[].sha256` is inside the hashed material, this single value covers
 * both layers — editing a file is caught by its own hash, and editing the manifest
 * (a relaxed `compatibility`, a flipped `role`, a doctored per-file hash) is caught
 * here. Same strip-self-then-canonicalize shape as the benchmark side's
 * `computeFixtureDigest`, so the pattern is already proven in this codebase.
 */
export async function computeManifestDigest(manifest: BlueprintManifest): Promise<string> {
  const material: Record<string, unknown> = { ...(manifest as unknown as Record<string, unknown>) };
  delete material.digest;
  delete material.$schema;
  return DIGEST_PREFIX + (await sha256Hex(encoder.encode(canonicalJson(material))));
}

/** First 16 hex chars of a digest — display/change-detection only, never for verification. */
export function shortDigest(digest: string): string {
  return digest.startsWith(DIGEST_PREFIX) ? digest.slice(DIGEST_PREFIX.length, DIGEST_PREFIX.length + 16) : digest.slice(0, 16);
}

// ── path safety ────────────────────────────────────────────────────────────────

/**
 * Whether a manifest-declared path is safe to write under a project root.
 *
 * Mirrors the refusals in `kit.mjs prunablePath`: absolute paths and Windows drive
 * letters are rejected outright rather than reinterpreted as relative, and any `..`
 * segment is rejected wherever it appears.
 */
export function isSafeRelativePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  if (p.includes("\\")) return false;
  const segments = p.split("/");
  if (segments.some((s) => s === ".." || s === "")) return false;
  return true;
}

// ── version ranges ─────────────────────────────────────────────────────────────

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Minimal semver range check — returns `null` for anything it cannot parse, so an
 * unrecognised constraint becomes a finding instead of silently passing.
 *
 * Supported deliberately narrow subset: `*`, an exact `X.Y.Z`, `>=X.Y.Z`, and
 * `>=X.Y.Z <A.B.C`. A general semver implementation would mean a dependency, and
 * this module stays dependency-free; widen the subset here rather than reaching for
 * one, and keep the fail-closed `null` for the unhandled cases.
 */
export function satisfiesRange(version: string, range: string): boolean | null {
  const v = parseVersion(version);
  if (!v) return null;
  const r = range.trim();
  if (r === "" || r === "*") return true;

  const exact = /^\d+\.\d+\.\d+$/.exec(r);
  if (exact) {
    const target = parseVersion(r);
    return target ? cmp(v, target) === 0 : null;
  }

  const bounded = /^>=\s*(\d+\.\d+\.\d+)(?:\s+<\s*(\d+\.\d+\.\d+))?$/.exec(r);
  if (bounded) {
    const lower = parseVersion(bounded[1]);
    if (!lower || cmp(v, lower) < 0) return lower ? false : null;
    if (bounded[2]) {
      const upper = parseVersion(bounded[2]);
      if (!upper) return null;
      if (cmp(v, upper) >= 0) return false;
    }
    return true;
  }

  return null;
}

// ── validation ─────────────────────────────────────────────────────────────────

/**
 * Structural check on a manifest: shape, schema version, and path safety. Does not
 * read any file — that is {@link verifyArtifact}'s job.
 */
export function validateManifest(manifest: unknown): VerifyResult {
  const findings: VerifyFinding[] = [];
  const bad = (code: FindingCode, message: string, path?: string) =>
    findings.push({ code, message, path });

  if (manifest === null || typeof manifest !== "object") {
    return { ok: false, findings: [{ code: "manifest_invalid", message: "manifest is not an object" }] };
  }
  const m = manifest as Partial<BlueprintManifest>;

  if (m.schemaVersion !== MANIFEST_VERSION) {
    bad(
      "schema_version_mismatch",
      `schemaVersion must be "${MANIFEST_VERSION}", got ${JSON.stringify(m.schemaVersion)}`,
    );
  }

  if (!m.blueprint || typeof m.blueprint !== "object") {
    bad("manifest_invalid", "blueprint { slug, version, kind } is required");
  } else {
    const { slug, version, kind } = m.blueprint;
    if (!slug || typeof slug !== "string") bad("manifest_invalid", "blueprint.slug is required");
    if (!version || typeof version !== "string") bad("manifest_invalid", "blueprint.version is required");
    if (kind !== "guidance" && kind !== "crystallized") {
      bad("manifest_invalid", `blueprint.kind must be "guidance" or "crystallized", got ${JSON.stringify(kind)}`);
    }
  }

  if (typeof m.digest !== "string" || !DIGEST_RE.test(m.digest)) {
    bad("manifest_invalid", `digest must match ${DIGEST_RE}, got ${JSON.stringify(m.digest)}`);
  }

  if (!Array.isArray(m.contents) || m.contents.length === 0) {
    bad("manifest_invalid", "contents[] is required and must be non-empty");
  } else {
    const seen = new Set<string>();
    for (const [i, entry] of m.contents.entries()) {
      const at = `contents[${i}]`;
      if (!entry || typeof entry !== "object") {
        bad("manifest_invalid", `${at} is not an object`);
        continue;
      }
      if (!isSafeRelativePath(entry.path)) {
        bad("unsafe_path", `${at}.path is not a safe project-relative path: ${JSON.stringify(entry.path)}`, entry.path);
      } else if (seen.has(entry.path)) {
        bad("manifest_invalid", `${at}.path is a duplicate: ${entry.path}`, entry.path);
      } else {
        seen.add(entry.path);
      }
      if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
        bad("manifest_invalid", `${at}.sha256 must be 64 lowercase hex chars`, entry.path);
      }
      if (!entry.role) bad("manifest_invalid", `${at}.role is required`, entry.path);
    }
  }

  for (const p of m.surface?.pruned ?? []) {
    if (!isSafeRelativePath(p)) {
      bad("unsafe_path", `surface.pruned contains an unsafe path: ${JSON.stringify(p)}`, p);
    }
  }

  const fragment = m.surface?.fragment;
  if (fragment !== undefined) {
    if (!isSafeRelativePath(fragment.path)) {
      bad("unsafe_path", `surface.fragment.path is not a safe path: ${JSON.stringify(fragment.path)}`, fragment.path);
    } else if (Array.isArray(m.contents) && !m.contents.some((c) => c?.path === fragment.path)) {
      // Otherwise the manifest instructs an importer to append a file that the payload does
      // not carry and no hash covers.
      bad("manifest_invalid", `surface.fragment.path is not declared in contents[]: ${fragment.path}`, fragment.path);
    }
    if (!isSafeRelativePath(fragment.target)) {
      bad(
        "unsafe_path",
        `surface.fragment.target is not a safe path: ${JSON.stringify(fragment.target)}`,
        fragment.target,
      );
    }
    if (typeof fragment.marker !== "string" || fragment.marker.length === 0) {
      bad("manifest_invalid", "surface.fragment.marker is required");
    }
  }

  return { ok: findings.length === 0, findings };
}

/**
 * Full verification: structure, per-file hashes, the manifest digest, pruned-path
 * absence, and declared compatibility.
 *
 * Fail-closed by construction — every branch that cannot reach a verdict emits a
 * finding rather than falling through, including a missing `reader.list` (which
 * makes extra unlisted files undetectable) and an unparseable version range. Callers
 * must treat `ok === false` as a refusal to import.
 */
export async function verifyArtifact(
  manifest: unknown,
  reader: ArtifactReader,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const structural = validateManifest(manifest);
  // A malformed manifest makes every downstream check meaningless — stop here rather
  // than reporting a cascade of failures derived from a shape we already rejected.
  if (!structural.ok) return structural;

  const m = manifest as BlueprintManifest;
  const findings: VerifyFinding[] = [];

  // 1. Every declared file present, with matching bytes.
  for (const entry of m.contents) {
    const bytes = await reader.read(entry.path);
    if (bytes === null) {
      findings.push({ code: "file_missing", message: `declared in contents[] but absent`, path: entry.path });
      continue;
    }
    const actual = await sha256Hex(bytes);
    if (actual !== entry.sha256) {
      findings.push({
        code: "hash_mismatch",
        message: `sha256 mismatch — manifest ${entry.sha256}, actual ${actual}`,
        path: entry.path,
      });
    }
  }

  // 2. Nothing present that the manifest does not declare.
  if (typeof reader.list === "function") {
    const declared = new Set(m.contents.map((c) => c.path));
    for (const path of await reader.list()) {
      if (!declared.has(path)) {
        findings.push({ code: "unexpected_file", message: "present in artifact but not declared", path });
      }
    }
  } else {
    findings.push({
      code: "unexpected_file",
      message:
        "reader cannot list the artifact, so undeclared extra files cannot be ruled out — supply ArtifactReader.list to close this",
    });
  }

  // 3. Pruned paths are absent ON PURPOSE; their reappearance is the finding.
  for (const path of m.surface?.pruned ?? []) {
    if ((await reader.read(path)) !== null) {
      findings.push({
        code: "pruned_file_present",
        message: "declared pruned in surface.pruned but present in the artifact",
        path,
      });
    }
  }

  // 4. Manifest self-integrity (accidental corruption only — see the module note).
  const expected = await computeManifestDigest(m);
  if (expected !== m.digest) {
    findings.push({
      code: "digest_mismatch",
      message: `manifest digest mismatch — recorded ${m.digest}, recomputed ${expected}`,
    });
  }

  // 5. Declared compatibility.
  const sailorRange = m.compatibility?.sailor;
  if (sailorRange !== undefined) {
    if (options.sailorVersion === undefined) {
      findings.push({
        code: "incompatible_sailor",
        message: `manifest requires Sailor ${sailorRange} but no sailorVersion was supplied to check against`,
      });
    } else {
      const satisfied = satisfiesRange(options.sailorVersion, sailorRange);
      if (satisfied === null) {
        findings.push({
          code: "unparseable_constraint",
          message: `cannot evaluate Sailor range ${JSON.stringify(sailorRange)} against ${options.sailorVersion}`,
        });
      } else if (!satisfied) {
        findings.push({
          code: "incompatible_sailor",
          message: `Sailor ${options.sailorVersion} does not satisfy ${sailorRange}`,
        });
      }
    }
  }

  const chains = m.compatibility?.chains;
  if (chains !== undefined && options.chainId !== undefined && !chains.includes(options.chainId)) {
    findings.push({
      code: "incompatible_chain",
      message: `artifact declares chains [${chains.join(", ")}] and does not support chain ${options.chainId}`,
    });
  }

  return { ok: findings.length === 0, findings };
}
