import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ArtifactReader,
  type BlueprintManifest,
  DIGEST_RE,
  MANIFEST_VERSION,
  canonicalJson,
  computeContentDigest,
  computeManifestDigest,
  isSafeRelativePath,
  satisfiesRange,
  sha256Hex,
  shortDigest,
  validateManifest,
  verifyArtifact,
} from "../blueprint/index.js";

const enc = (s: string) => new TextEncoder().encode(s);

/** An in-memory artifact plus a manifest whose digest and hashes are correct by construction. */
async function buildArtifact(
  files: Record<string, string> = { "AGENTS.md": "# surface\n", "scripts/gen.mjs": "export default 1\n" },
  overrides: Partial<BlueprintManifest> = {},
): Promise<{ manifest: BlueprintManifest; reader: ArtifactReader }> {
  const contents = await Promise.all(
    Object.entries(files).map(async ([path, body]) => ({
      path,
      sha256: await sha256Hex(enc(body)),
      bytes: enc(body).length,
      role: "agent-surface" as const,
    })),
  );
  const base: BlueprintManifest = {
    schemaVersion: MANIFEST_VERSION,
    blueprint: { slug: "dca-multitoken-multichain", version: "v3.2", kind: "crystallized" },
    digest: `sha256:${"0".repeat(64)}`,
    contents,
    ...overrides,
  };
  base.digest = await computeManifestDigest(base);
  const reader: ArtifactReader = {
    read: async (p) => (p in files ? enc(files[p]) : null),
    list: async () => Object.keys(files),
  };
  return { manifest: base, reader };
}

// ── digests ────────────────────────────────────────────────────────────────────

test("computeContentDigest: deterministic, prefixed, and DIGEST_RE-conformant", async () => {
  const files = [{ path: "a.txt", bytes: enc("hello") }];
  const a = await computeContentDigest(files);
  const b = await computeContentDigest(files);
  assert.equal(a, b);
  assert.match(a, DIGEST_RE);
});

test("computeContentDigest: input order does not matter — paths are sorted", async () => {
  const x = { path: "a.txt", bytes: enc("1") };
  const y = { path: "b.txt", bytes: enc("2") };
  assert.equal(await computeContentDigest([x, y]), await computeContentDigest([y, x]));
});

test("computeContentDigest: the path/bytes boundary is unambiguous", async () => {
  // Without a delimiter these two file sets would concatenate identically. The NUL
  // separators are what make "ab"+"c" and "a"+"bc" distinguishable.
  const one = await computeContentDigest([{ path: "ab", bytes: enc("c") }]);
  const two = await computeContentDigest([{ path: "a", bytes: enc("bc") }]);
  assert.notEqual(one, two);
});

test("computeContentDigest: any byte change moves the digest", async () => {
  const before = await computeContentDigest([{ path: "a", bytes: enc("x") }]);
  const after = await computeContentDigest([{ path: "a", bytes: enc("y") }]);
  assert.notEqual(before, after);
});

test("shortDigest: 16 hex chars, and strips the prefix", async () => {
  const d = await computeContentDigest([{ path: "a", bytes: enc("x") }]);
  const short = shortDigest(d);
  assert.equal(short.length, 16);
  assert.ok(!short.startsWith("sha256:"));
  assert.ok(d.includes(short));
});

// ── canonical JSON ─────────────────────────────────────────────────────────────

test("canonicalJson: key order does not affect output", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
});

test("canonicalJson: array order IS significant", () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("canonicalJson: refuses undefined and non-finite numbers rather than coercing", () => {
  // Coercion would let two materially different manifests hash identically.
  assert.throws(() => canonicalJson({ a: undefined }), TypeError);
  assert.throws(() => canonicalJson({ a: Number.NaN }), TypeError);
  assert.throws(() => canonicalJson({ a: Number.POSITIVE_INFINITY }), TypeError);
});

// ── version ranges ─────────────────────────────────────────────────────────────

test("satisfiesRange: supported subset behaves", () => {
  assert.equal(satisfiesRange("2.1.1", "*"), true);
  assert.equal(satisfiesRange("2.1.1", ""), true);
  assert.equal(satisfiesRange("2.1.1", "2.1.1"), true);
  assert.equal(satisfiesRange("2.1.2", "2.1.1"), false);
  assert.equal(satisfiesRange("2.1.1", ">=2.1.0"), true);
  assert.equal(satisfiesRange("2.0.9", ">=2.1.0"), false);
  assert.equal(satisfiesRange("2.1.1", ">=2.1.1 <3.0.0"), true);
  assert.equal(satisfiesRange("3.0.0", ">=2.1.1 <3.0.0"), false);
});

test("satisfiesRange: unsupported syntax returns null so callers fail closed", () => {
  for (const range of ["^2.1.0", "~2.1.0", ">2.0.0", "2.x", "1.0.0 || 2.0.0"]) {
    assert.equal(satisfiesRange("2.1.1", range), null, `expected null for ${range}`);
  }
  assert.equal(satisfiesRange("not-a-version", ">=1.0.0"), null);
});

// ── path safety ────────────────────────────────────────────────────────────────

test("isSafeRelativePath: accepts ordinary project-relative paths", () => {
  for (const p of ["AGENTS.md", ".agents/skills/dca-mandate/SKILL.md", "a/b/c.json"]) {
    assert.equal(isSafeRelativePath(p), true, p);
  }
});

test("isSafeRelativePath: refuses escapes, absolutes and drive letters", () => {
  for (const p of ["/etc/passwd", "C:/Windows", "../outside", "a/../../b", "a//b", "", "a\\b"]) {
    assert.equal(isSafeRelativePath(p), false, JSON.stringify(p));
  }
});

// ── validateManifest ───────────────────────────────────────────────────────────

test("validateManifest: a well-formed manifest passes", async () => {
  const { manifest } = await buildArtifact();
  assert.equal(validateManifest(manifest).ok, true);
});

test("validateManifest: wrong schemaVersion is rejected", async () => {
  const { manifest } = await buildArtifact();
  const result = validateManifest({ ...manifest, schemaVersion: "shipwright.blueprint.manifest/v2" });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === "schema_version_mismatch"));
});

test("validateManifest: unsafe and duplicate content paths are rejected", async () => {
  const { manifest } = await buildArtifact();
  const sha = manifest.contents[0].sha256;
  const unsafe = validateManifest({
    ...manifest,
    contents: [{ path: "../escape", sha256: sha, role: "agent-surface" }],
  });
  assert.ok(unsafe.findings.some((f) => f.code === "unsafe_path"));

  const dup = validateManifest({
    ...manifest,
    contents: [
      { path: "a.md", sha256: sha, role: "agent-surface" },
      { path: "a.md", sha256: sha, role: "agent-surface" },
    ],
  });
  assert.ok(dup.findings.some((f) => f.message.includes("duplicate")));
});

test("validateManifest: a malformed digest or kind is rejected", async () => {
  const { manifest } = await buildArtifact();
  assert.ok(validateManifest({ ...manifest, digest: "deadbeef" }).findings.some((f) => f.code === "manifest_invalid"));
  assert.ok(
    validateManifest({ ...manifest, blueprint: { slug: "s", version: "v1", kind: "other" } }).findings.some((f) =>
      f.message.includes("blueprint.kind"),
    ),
  );
});

// ── verifyArtifact ─────────────────────────────────────────────────────────────

test("verifyArtifact: a correctly built artifact verifies clean", async () => {
  const { manifest, reader } = await buildArtifact();
  const result = await verifyArtifact(manifest, reader, { sailorVersion: "2.1.1" });
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
});

test("verifyArtifact: tampered file bytes are caught by the per-file hash", async () => {
  const { manifest } = await buildArtifact();
  const reader: ArtifactReader = {
    read: async (p) => (p === "AGENTS.md" ? enc("# TAMPERED\n") : enc("export default 1\n")),
    list: async () => manifest.contents.map((c) => c.path),
  };
  const result = await verifyArtifact(manifest, reader);
  assert.equal(result.ok, false);
  const finding = result.findings.find((f) => f.code === "hash_mismatch");
  assert.equal(finding?.path, "AGENTS.md");
});

test("verifyArtifact: a declared-but-absent file is caught", async () => {
  const { manifest } = await buildArtifact();
  const reader: ArtifactReader = { read: async () => null, list: async () => [] };
  const result = await verifyArtifact(manifest, reader);
  assert.ok(result.findings.some((f) => f.code === "file_missing"));
});

test("verifyArtifact: an undeclared extra file is caught", async () => {
  const { manifest, reader } = await buildArtifact();
  const withExtra: ArtifactReader = {
    read: async (p) => (p === "stowaway.sh" ? enc("rm -rf /\n") : reader.read(p)),
    list: async () => [...(await reader.list!()), "stowaway.sh"],
  };
  const result = await verifyArtifact(manifest, withExtra, { sailorVersion: "2.1.1" });
  assert.equal(result.ok, false);
  const finding = result.findings.find((f) => f.code === "unexpected_file");
  assert.equal(finding?.path, "stowaway.sh");
});

test("verifyArtifact: a reader that cannot list fails closed rather than staying silent", async () => {
  const { manifest, reader } = await buildArtifact();
  const result = await verifyArtifact(manifest, { read: reader.read }, { sailorVersion: "2.1.1" });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === "unexpected_file" && f.path === undefined));
});

test("verifyArtifact: a pruned path that reappeared is caught", async () => {
  // src/mandate.ts is pruned on purpose by a crystallized kit; its return means the
  // subtractive surface was undone.
  const { manifest } = await buildArtifact(
    { "AGENTS.md": "# surface\n" },
    { surface: { pruned: ["src/mandate.ts"] } },
  );
  const reader: ArtifactReader = {
    read: async (p) => (p === "AGENTS.md" ? enc("# surface\n") : p === "src/mandate.ts" ? enc("export {}\n") : null),
    list: async () => ["AGENTS.md"],
  };
  const result = await verifyArtifact(manifest, reader);
  assert.equal(result.ok, false);
  const finding = result.findings.find((f) => f.code === "pruned_file_present");
  assert.equal(finding?.path, "src/mandate.ts");
});

test("verifyArtifact: editing the manifest is caught by the self-digest", async () => {
  // The whole point of hashing contents[] inside the manifest digest: relaxing a
  // constraint or doctoring a per-file hash must not go unnoticed.
  const { manifest, reader } = await buildArtifact({ "AGENTS.md": "# surface\n" });
  const relaxed = { ...manifest, compatibility: { sailor: "*" } };
  const result = await verifyArtifact(relaxed, reader, { sailorVersion: "2.1.1" });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === "digest_mismatch"));
});

test("verifyArtifact: an incompatible Sailor version is refused", async () => {
  const { manifest, reader } = await buildArtifact({ "AGENTS.md": "# surface\n" }, {
    compatibility: { sailor: ">=2.1.1 <3.0.0" },
  });
  const good = await verifyArtifact(manifest, reader, { sailorVersion: "2.4.0" });
  assert.equal(good.ok, true);

  const bad = await verifyArtifact(manifest, reader, { sailorVersion: "3.0.0" });
  assert.ok(bad.findings.some((f) => f.code === "incompatible_sailor"));
});

test("verifyArtifact: an unknown range or an unchecked version both fail closed", async () => {
  const { manifest, reader } = await buildArtifact({ "AGENTS.md": "# surface\n" }, {
    compatibility: { sailor: "^2.1.0" },
  });
  const unparseable = await verifyArtifact(manifest, reader, { sailorVersion: "2.1.1" });
  assert.ok(unparseable.findings.some((f) => f.code === "unparseable_constraint"));

  // A constraint the caller never supplied a version for must not silently pass.
  const unchecked = await verifyArtifact(manifest, reader, {});
  assert.ok(unchecked.findings.some((f) => f.code === "incompatible_sailor"));
});

test("verifyArtifact: importing onto an unsupported chain is refused", async () => {
  const { manifest, reader } = await buildArtifact({ "AGENTS.md": "# surface\n" }, {
    compatibility: { chains: [130] },
  });
  assert.equal((await verifyArtifact(manifest, reader, { chainId: 130 })).ok, true);
  const wrong = await verifyArtifact(manifest, reader, { chainId: 8453 });
  assert.ok(wrong.findings.some((f) => f.code === "incompatible_chain"));
});

test("verifyArtifact: a structurally invalid manifest stops before file checks cascade", async () => {
  const result = await verifyArtifact({ schemaVersion: "wrong" }, { read: async () => null });
  assert.equal(result.ok, false);
  assert.ok(result.findings.every((f) => f.code !== "file_missing"));
});
