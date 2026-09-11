import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { BlueprintManifest } from "@sail/sdk/blueprint";
import type { SubmitContributionArgs } from "../lib/contribution.js";
import type { ShareManifest } from "../lib/share.js";
import { harborPublish } from "./harbor-publish.js";

function shareManifest(): ShareManifest {
  return {
    name: "DCA",
    slug: "dca",
    summary: "Dollar-cost average into a token.",
    description: "",
    strategy: "x",
    mandate: "y",
    chains: [8453],
    tags: [],
    author: "aadopico",
    sailorVersion: "2.2.0",
    sharedAt: "",
  };
}

function fakeManifest(): BlueprintManifest {
  return {
    schemaVersion: "shipwright.blueprint.manifest/v1",
    blueprint: { slug: "dca", version: "1.0.0", kind: "crystallized" },
    digest: `sha256:${"0".repeat(64)}`,
    contents: [],
  };
}

function makeArchivePath(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "archive-")), "blueprint.tar.gz");
  fs.writeFileSync(p, "fake-archive-bytes");
  return p;
}

async function inTempCwd(fn: () => Promise<void>): Promise<void> {
  const prev = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harbor-publish-"));
  process.chdir(root);
  try {
    await fn();
  } finally {
    process.chdir(prev);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("publish (default) opens a pull request committing the blueprint + manifest", async () => {
  await inTempCwd(async () => {
    let submitted: SubmitContributionArgs | undefined;
    let populated: Record<string, string> = {};
    await harborPublish(
      {},
      {
        readShareManifest: () => shareManifest(),
        packBlueprint: async () => ({
          manifest: fakeManifest(),
          files: new Map(),
          redactions: [],
          review: { addresses: [], binaries: [] },
        }),
        writeBlueprintArchive: () => makeArchivePath(),
        listReleases: async () => [],
        createRelease: async () => {
          throw new Error("should not release directly in default mode");
        },
        submitContribution: async (args) => {
          submitted = args;
          // Run the populate callback against a scratch dir to verify what it writes.
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), "populate-"));
          args.populate(dir);
          populated = {
            artifact: fs.readFileSync(path.join(dir, "blueprints", "dca", "dca.tar.gz"), "utf-8"),
            manifest: fs.readFileSync(
              path.join(dir, "blueprints", "dca", "manifest.json"),
              "utf-8",
            ),
          };
          return {
            pr: { number: 7, htmlUrl: "https://github.com/sail-money/harbor/pull/7" },
            direct: true,
            pushTarget: "sail-money/harbor",
          };
        },
      },
    );

    assert.ok(submitted);
    assert.equal(submitted.repo, "sail-money/harbor");
    assert.equal(submitted.base, "main");
    assert.equal(submitted.branch, "publish/dca");
    assert.equal(populated.artifact, "fake-archive-bytes");
    const m = JSON.parse(populated.manifest);
    assert.equal(m.slug, "dca");
    assert.equal(m.name, "DCA");
  });
});

test("publish --release computes the next release number and releases directly", async () => {
  await inTempCwd(async () => {
    let released: { tag: string; assetName: string; bytes: string } | undefined;
    await harborPublish(
      { release: true },
      {
        readShareManifest: () => shareManifest(),
        packBlueprint: async () => ({
          manifest: fakeManifest(),
          files: new Map(),
          redactions: [],
          review: { addresses: [], binaries: [] },
        }),
        writeBlueprintArchive: () => makeArchivePath(),
        listReleases: async () => [
          { tag: "dca-v1", name: "", body: "", publishedAt: "", assets: [] },
          { tag: "dca-v3", name: "", body: "", publishedAt: "", assets: [] },
          { tag: "other-v2", name: "", body: "", publishedAt: "", assets: [] },
        ],
        createRelease: async (_repo, input) => {
          released = {
            tag: input.tag,
            assetName: input.assetName ?? "",
            bytes: Buffer.from(input.assetBytes ?? []).toString(),
          };
          return {
            tag: input.tag,
            htmlUrl: `https://github.com/sail-money/harbor/releases/tag/${input.tag}`,
          };
        },
        submitContribution: async () => {
          throw new Error("should not open a PR in --release mode");
        },
      },
    );
    assert.equal(released?.tag, "dca-v4");
    assert.equal(released?.assetName, "dca.tar.gz");
    assert.equal(released?.bytes, "fake-archive-bytes");
  });
});

test("publish --local writes the archive to disk", async () => {
  await inTempCwd(async () => {
    await harborPublish(
      { local: true },
      {
        readShareManifest: () => shareManifest(),
        packBlueprint: async () => ({
          manifest: fakeManifest(),
          files: new Map(),
          redactions: [],
          review: { addresses: [], binaries: [] },
        }),
        writeBlueprintArchive: () => makeArchivePath(),
        listReleases: async () => [],
        createRelease: async () => {
          throw new Error("should not release in --local mode");
        },
        submitContribution: async () => {
          throw new Error("should not open a PR in --local mode");
        },
      },
    );
    assert.ok(fs.existsSync(path.join(process.cwd(), "dca-blueprint.tar.gz")));
  });
});

test("publish --release --json prints pure JSON and sweeps the archive staging dir", async () => {
  await inTempCwd(async () => {
    // The real writeBlueprintArchive stages manifest + payload/ in a
    // `sailor-blueprint-archive-*` mkdtemp dir; publish must remove the whole dir, not
    // just the .tar.gz inside it.
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-blueprint-archive-"));
    const archive = path.join(staging, "blueprint.tar.gz");
    fs.writeFileSync(archive, "fake-archive-bytes");
    fs.writeFileSync(path.join(staging, "blueprint.manifest.json"), "{}");

    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    try {
      await harborPublish(
        { release: true, json: true },
        {
          readShareManifest: () => shareManifest(),
          packBlueprint: async () => ({
            manifest: fakeManifest(),
            files: new Map(),
            redactions: [],
            review: { addresses: [], binaries: [] },
          }),
          writeBlueprintArchive: () => archive,
          listReleases: async () => [],
          createRelease: async (_repo, input) => ({
            tag: input.tag,
            htmlUrl: `https://github.com/sail-money/harbor/releases/tag/${input.tag}`,
          }),
          submitContribution: async () => {
            throw new Error("should not open a PR in --release mode");
          },
        },
      );
    } finally {
      console.log = log;
    }
    // Everything printed must parse as one JSON document — no "Packaging..." preamble.
    const parsed = JSON.parse(lines.join("\n")) as { status: string; tag: string };
    assert.equal(parsed.status, "ok");
    assert.equal(parsed.tag, "dca-v1");
    assert.equal(fs.existsSync(staging), false, "staging dir must be removed");
  });
});

test("publish removes only the archive when its parent is not a staging dir", async () => {
  await inTempCwd(async () => {
    const archive = makeArchivePath(); // parent is `archive-*`, not `sailor-blueprint-archive-*`
    const parent = path.dirname(archive);
    await harborPublish(
      { local: true },
      {
        readShareManifest: () => shareManifest(),
        packBlueprint: async () => ({
          manifest: fakeManifest(),
          files: new Map(),
          redactions: [],
          review: { addresses: [], binaries: [] },
        }),
        writeBlueprintArchive: () => archive,
        listReleases: async () => [],
        createRelease: async () => {
          throw new Error("unused");
        },
        submitContribution: async () => {
          throw new Error("unused");
        },
      },
    );
    assert.equal(fs.existsSync(archive), false);
    assert.equal(fs.existsSync(parent), true, "an unrelated parent directory must survive");
    fs.rmSync(parent, { recursive: true, force: true });
  });
});

test("publish errors when there is no slug", async () => {
  await inTempCwd(async () => {
    await assert.rejects(
      harborPublish(
        {},
        {
          readShareManifest: () => null,
          packBlueprint: async () => {
            throw new Error("unused");
          },
          writeBlueprintArchive: () => makeArchivePath(),
          listReleases: async () => [],
          createRelease: async () => {
            throw new Error("unused");
          },
          submitContribution: async () => {
            throw new Error("unused");
          },
        },
      ),
      /No \.sail\/share\.json slug/,
    );
  });
});
