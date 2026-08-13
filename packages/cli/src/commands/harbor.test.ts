import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { ListedRelease } from "../lib/github.js";
import { harborList, harborStart } from "./harbor.js";

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
    harborList({}, { listReleases: async () => releases }),
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
    harborList({ json: true }, { listReleases: async () => [release("dca-v1", "dca.tar.gz")] }),
  );
  const parsed = JSON.parse(out) as { registry: string; count: number; agents: { slug: string }[] };
  assert.equal(parsed.registry, "sail-money/Dock");
  assert.equal(parsed.count, 1);
  assert.equal(parsed.agents[0].slug, "dca");
});

test("list reports an empty registry gracefully", async () => {
  const { out } = await capture(() => harborList({}, { listReleases: async () => [] }));
  assert.match(out, /None published yet/);
});

function notFound(): Error {
  return new Error("GitHub returned 404 while listing releases on sail-money/Dock: Not Found");
}

test("list handles a not-found registry gracefully", async () => {
  const { out } = await capture(() =>
    harborList(
      {},
      {
        listReleases: async () => {
          throw notFound();
        },
      },
    ),
  );
  assert.match(out, /No registry at sail-money\/Dock yet/);
});

test("start reports a clear error when the registry is not published", async () => {
  await assert.rejects(
    harborStart(
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

// ── start ──────────────────────────────────────────────────────────────────────

test("start resolves the latest version and hands the archive to blueprint start", async () => {
  const releases = [
    release("dca-v1", "dca-v1.tar.gz"),
    release("dca-v2", "dca-v2.tar.gz"),
    release("dca-v3", "dca-v3.tar.gz"),
  ];
  let downloadedUrl = "";
  let handedOff:
    | { source: string; dir: string; opts: { chain?: string; yes?: boolean } }
    | undefined;
  await harborStart(
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

test("start defaults the project directory to the slug", async () => {
  let handedOff: { dir: string } | undefined;
  await harborStart(
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

test("start forwards chain/yes/agent options to blueprint start", async () => {
  let opts: { chain?: string; yes?: boolean; agent?: string | false } | undefined;
  await harborStart(
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
  assert.deepEqual(opts, { chain: "8453", yes: true, agent: "claude" });
});

test("start errors when no release matches the slug", async () => {
  await assert.rejects(
    harborStart(
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

test("start refuses a release with no archive asset", async () => {
  const bare: ListedRelease = {
    tag: "dca-v1",
    name: "",
    body: "",
    publishedAt: "",
    assets: [],
  };
  await assert.rejects(
    harborStart(
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
