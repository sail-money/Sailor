import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { BlueprintManifest } from "@sail/sdk/blueprint";
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

test("publish computes the next release number and releases the asset", async () => {
  await inTempCwd(async () => {
    let released: { tag: string; assetName: string; bytes: string } | undefined;
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
      },
    );
    assert.ok(fs.existsSync(path.join(process.cwd(), "dca-blueprint.tar.gz")));
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
        },
      ),
      /No \.sail\/share\.json slug/,
    );
  });
});
