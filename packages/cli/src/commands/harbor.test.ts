import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeManifestDigest } from "@sail/sdk/blueprint";
import type { ListedRelease } from "../lib/github.js";
import { harborCreate, harborList, harborUpdate } from "./harbor.js";

/** A real `.tar.gz` blueprint artifact whose manifest is correct by construction. */
async function buildArchive(files: Record<string, string>): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harbor-art-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, "payload", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  const manifest = {
    schemaVersion: "shipwright.blueprint.manifest/v1",
    blueprint: { slug: "portfolio", version: "1.0.0", kind: "crystallized" },
    digest: "",
    contents: Object.entries(files).map(([rel, body]) => ({
      path: rel,
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: Buffer.byteLength(body),
      role: "agent-surface",
    })),
  };
  manifest.digest = await computeManifestDigest(manifest as never);
  fs.writeFileSync(path.join(dir, "blueprint.manifest.json"), JSON.stringify(manifest));
  const tgz = path.join(dir, "portfolio.tar.gz");
  execFileSync("tar", ["-czf", tgz, "-C", dir, "blueprint.manifest.json", "payload"]);
  return tgz;
}

function release(
  tag: string,
  assetName: string,
  opts: { name?: string; body?: string; downloads?: number; size?: number } = {},
): ListedRelease {
  return {
    tag,
    name: opts.name ?? "",
    body: opts.body ?? "",
    publishedAt: "2026-08-13T00:00:00Z",
    assets: [
      {
        name: assetName,
        downloadUrl: `https://example.com/${assetName}`,
        apiUrl: `https://api.example.com/${assetName}`,
        size: opts.size ?? 1024,
        downloadCount: opts.downloads ?? 0,
      },
    ],
  };
}

async function capture(fn: () => Promise<void>): Promise<{ out: string; threw: Error | null }> {
  const out: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  let threw: Error | null = null;
  try {
    await fn();
  } catch (e) {
    threw = e as Error;
  } finally {
    console.log = log;
  }
  return { out: out.join("\n"), threw };
}

// ── list ───────────────────────────────────────────────────────────────────────

test("list summarizes the latest release per slug", async () => {
  const releases = [
    release("dca-v1", "dca-v1.tar.gz", {
      body: "Dollar-cost average into a token.\n\nMore detail.",
      downloads: 10,
    }),
    release("dca-v3", "dca-v3.tar.gz", {
      body: "Dollar-cost average into a token.\n\nMore detail.",
      downloads: 34,
    }),
    release("yield-v1", "yield-v1.tar.gz", { body: "Earn yield on idle stables.", downloads: 7 }),
  ];
  const { out, threw } = await capture(() =>
    harborList(undefined, {}, { listReleases: async () => releases }),
  );
  assert.equal(threw, null, threw?.message);
  assert.match(out, /Available agents/);
  assert.match(out, /dca {2}dca-v3 {2}34 downloads/);
  assert.match(out, /yield {2}yield-v1 {2}7 downloads/);
  // only the latest dca appears once, not dca-v1
  assert.doesNotMatch(out, /dca-v1/);
});

test("list emits JSON with the registry and count", async () => {
  const { out } = await capture(() =>
    harborList(
      undefined,
      { json: true },
      { listReleases: async () => [release("dca-v1", "dca.tar.gz")] },
    ),
  );
  const parsed = JSON.parse(out) as { registry: string; count: number; agents: { slug: string }[] };
  assert.equal(parsed.registry, "sail-money/harbor");
  assert.equal(parsed.count, 1);
  assert.equal(parsed.agents[0].slug, "dca");
});

test("list reports an empty registry gracefully", async () => {
  const { out } = await capture(() => harborList(undefined, {}, { listReleases: async () => [] }));
  assert.match(out, /None published yet/);
});

test("list filters by a query across slug, name, and description", async () => {
  const releases = [
    release("dca-v1", "dca.tar.gz", {
      name: "Dollar cost averaging",
      body: "Buy a token on a schedule.",
    }),
    release("yield-v1", "yield.tar.gz", {
      name: "Yield optimizer",
      body: "Earn yield on idle stablecoins.",
    }),
  ];
  const { out } = await capture(() =>
    harborList("yield", {}, { listReleases: async () => releases }),
  );
  assert.match(out, /Agents matching "yield"/);
  assert.match(out, /yield {2}yield-v1/);
  assert.doesNotMatch(out, /dca/);
});

test("list filter is case-insensitive and folds hyphens to spaces", async () => {
  const releases = [
    release("dollar-cost-averaging-v1", "dca.tar.gz", { body: "Buy on a schedule." }),
    release("yield-v1", "yield.tar.gz", { body: "Earn yield." }),
  ];
  const { out } = await capture(() =>
    harborList("Dollar Cost", {}, { listReleases: async () => releases }),
  );
  assert.match(out, /dollar-cost-averaging/);
  assert.doesNotMatch(out, /yield/);
});

test("list filter with no match points to the full list", async () => {
  const { out } = await capture(() =>
    harborList(
      "doesnotexist",
      {},
      {
        listReleases: async () => [release("dca-v1", "dca.tar.gz")],
      },
    ),
  );
  assert.match(out, /No agent matches "doesnotexist"/);
});

test("list JSON includes the query when filtering", async () => {
  const { out } = await capture(() =>
    harborList(
      "yield",
      { json: true },
      {
        listReleases: async () => [release("yield-v1", "yield.tar.gz")],
      },
    ),
  );
  const parsed = JSON.parse(out) as { query: string; count: number; agents: { slug: string }[] };
  assert.equal(parsed.query, "yield");
  assert.equal(parsed.count, 1);
  assert.equal(parsed.agents[0].slug, "yield");
});

function notFound(): Error {
  return new Error("GitHub returned 404 while listing releases on sail-money/harbor: Not Found");
}

test("list handles a not-found registry gracefully", async () => {
  const { out } = await capture(() =>
    harborList(
      undefined,
      {},
      {
        listReleases: async () => {
          throw notFound();
        },
      },
    ),
  );
  assert.match(out, /No registry at sail-money\/harbor yet/);
});

test("create reports a clear error when the registry is not published", async () => {
  await assert.rejects(
    harborCreate(
      "dca",
      undefined,
      {},
      {
        listReleases: async () => {
          throw notFound();
        },
        downloadAsset: async () => Buffer.from("x"),
        blueprintStart: async () => {},
      },
    ),
    /registry is not published yet/,
  );
});

// ── create ─────────────────────────────────────────────────────────────────────

test("create resolves the latest version and hands the archive to blueprint start", async () => {
  const releases = [
    release("dca-v1", "dca-v1.tar.gz"),
    release("dca-v2", "dca-v2.tar.gz"),
    release("dca-v3", "dca-v3.tar.gz"),
  ];
  let downloadedUrl = "";
  let handedOff:
    | { source: string; dir: string; opts: { chain?: string; yes?: boolean } }
    | undefined;
  await harborCreate(
    "dca",
    "my-dca",
    {},
    {
      listReleases: async () => releases,
      downloadAsset: async (url) => {
        downloadedUrl = url;
        return Buffer.from("fake-archive");
      },
      blueprintStart: async (source, dir, opts) => {
        handedOff = { source, dir, opts };
      },
    },
  );
  assert.equal(downloadedUrl, "https://example.com/dca-v3.tar.gz");
  assert.ok(handedOff, "blueprint start must be handed off");
  assert.ok(handedOff.source.endsWith("dca-v3.tar.gz"));
  assert.equal(handedOff.dir, "my-dca");
});

test("create defaults the project directory to the slug", async () => {
  let handedOff: { dir: string } | undefined;
  await harborCreate(
    "yield",
    undefined,
    {},
    {
      listReleases: async () => [release("yield-v1", "yield.tar.gz")],
      downloadAsset: async () => Buffer.from("x"),
      blueprintStart: async (_source, dir) => {
        handedOff = { dir };
      },
    },
  );
  assert.equal(handedOff?.dir, "yield");
});

test("create forwards chain/yes/agent options to blueprint start", async () => {
  let opts: { chain?: string; yes?: boolean; agent?: string | false } | undefined;
  await harborCreate(
    "dca",
    undefined,
    { chain: "8453", yes: true, agent: "claude" },
    {
      listReleases: async () => [release("dca-v1", "dca.tar.gz")],
      downloadAsset: async () => Buffer.from("x"),
      blueprintStart: async (_source, _dir, o) => {
        opts = o;
      },
    },
  );
  // The release tag rides along so import records it in the marker for `harbor update`.
  assert.deepEqual(opts, { chain: "8453", yes: true, agent: "claude", releaseTag: "dca-v1" });
});

test("create errors when no release matches the slug", async () => {
  await assert.rejects(
    harborCreate(
      "nope",
      undefined,
      {},
      {
        listReleases: async () => [release("dca-v1", "dca.tar.gz")],
        downloadAsset: async () => Buffer.from("x"),
        blueprintStart: async () => {},
      },
    ),
    /No blueprint named "nope"/,
  );
});

test("create refuses a release with no archive asset", async () => {
  const bare: ListedRelease = {
    tag: "dca-v1",
    name: "",
    body: "",
    publishedAt: "",
    assets: [],
  };
  await assert.rejects(
    harborCreate(
      "dca",
      undefined,
      {},
      {
        listReleases: async () => [bare],
        downloadAsset: async () => Buffer.from("x"),
        blueprintStart: async () => {},
      },
    ),
    /no \.tar\.gz or \.zip asset/,
  );
});

test(
  "create scaffolds in-place when the current directory is empty",
  { concurrency: false },
  async () => {
    const previous = process.cwd();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-harbor-inplace-"));
    process.chdir(dir);
    let handedOff: { dir: string } | undefined;
    try {
      await harborCreate(
        "portfolio",
        undefined,
        {},
        {
          listReleases: async () => [release("portfolio-v1", "portfolio.tar.gz")],
          downloadAsset: async () => Buffer.from("x"),
          blueprintStart: async (_source, d) => {
            handedOff = { dir: d };
          },
        },
      );
      assert.equal(handedOff?.dir, ".");
    } finally {
      process.chdir(previous);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

// ── update ─────────────────────────────────────────────────────────────────────

test("update re-imports the latest release over a Harbor project in place", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-harbor-update-"));
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sail", ".blueprint"),
    JSON.stringify({
      slug: "portfolio",
      version: "1.0.0",
      release: "portfolio-v1",
      kind: null,
      importedAt: "2026-08-13T00:00:00Z",
    }),
  );
  let imported: { source: string; dir: string | undefined; releaseTag?: string } | undefined;
  const { out, threw } = await capture(() =>
    harborUpdate(
      dir,
      { yes: true },
      {
        listReleases: async () => [
          release("portfolio-v1", "portfolio.tar.gz"),
          release("portfolio-v2", "portfolio.tar.gz"),
        ],
        downloadAsset: async () => Buffer.from("x"),
        importBlueprint: async (source: string, d: string | undefined, o) => {
          imported = { source, dir: d, releaseTag: o.releaseTag };
          return true;
        },
      },
    ),
  );
  assert.equal(threw, null);
  assert.ok(imported, "update must call importBlueprint");
  assert.equal(imported.dir, dir);
  assert.equal(imported.releaseTag, "portfolio-v2");
  assert.match(out, /portfolio-v2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("update through the real import records the release tag, and is then current", async () => {
  // Real `blueprintImport` over a real archive; only the registry calls are mocked. This is
  // the marker/tag contract end to end: the manifest says version "1.0.0" (as published
  // blueprints do), the registry says "portfolio-v2", and only the latter may be compared.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-harbor-update-real-"));
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sail", ".blueprint"),
    JSON.stringify({ slug: "portfolio", version: "1.0.0", release: "portfolio-v1", kind: null }),
  );
  const archive = await buildArchive({ "AGENTS.md": "# portfolio v2\n" });
  const deps = {
    listReleases: async () => [release("portfolio-v2", "portfolio.tar.gz")],
    downloadAsset: async () => fs.readFileSync(archive),
  };
  const { out, threw } = await capture(() => harborUpdate(dir, { yes: true, json: true }, deps));
  assert.equal(threw, null, threw?.message);
  const marker = JSON.parse(fs.readFileSync(path.join(dir, ".sail", ".blueprint"), "utf-8"));
  assert.equal(marker.release, "portfolio-v2");
  assert.equal(marker.version, "1.0.0", "the manifest version is kept on its own axis");
  assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf-8"), "# portfolio v2\n");
  // --json output must be pure JSON: the last line is the result, and nothing human precedes it
  // that the import itself did not print.
  const last = out.trim().split("\n").at(-1) ?? "";
  assert.deepEqual(JSON.parse(last), { updated: true, version: "portfolio-v2" });

  // Second run: the marker now says portfolio-v2, so update is a no-op.
  let reimported = false;
  const { out: again } = await capture(() =>
    harborUpdate(
      dir,
      { yes: true, json: true },
      {
        ...deps,
        importBlueprint: async () => {
          reimported = true;
          return true;
        },
      },
    ),
  );
  assert.equal(reimported, false);
  assert.deepEqual(JSON.parse(again.trim()), {
    updated: false,
    version: "portfolio-v2",
    reason: "current",
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("update is a no-op (idempotent) when already on the latest release", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-harbor-update-"));
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sail", ".blueprint"),
    JSON.stringify({
      slug: "portfolio",
      version: "1.0.0",
      release: "portfolio-v2",
      kind: null,
      importedAt: "2026-08-13T00:00:00Z",
    }),
  );
  let imported = false;
  const { threw } = await capture(() =>
    harborUpdate(
      dir,
      { yes: true },
      {
        listReleases: async () => [release("portfolio-v2", "portfolio.tar.gz")],
        downloadAsset: async () => Buffer.from("x"),
        importBlueprint: async () => {
          imported = true;
          return true;
        },
      },
    ),
  );
  assert.equal(threw, null);
  assert.equal(imported, false, "already-current must not re-import");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("update errors when the project is not a Harbor project", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-harbor-update-"));
  fs.mkdirSync(path.join(dir, ".sail"), { recursive: true });
  await assert.rejects(
    harborUpdate(
      dir,
      { yes: true },
      {
        listReleases: async () => [release("portfolio-v2", "portfolio.tar.gz")],
        downloadAsset: async () => Buffer.from("x"),
        importBlueprint: async () => true,
      },
    ),
    /not a Harbor project/,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
