import fs from "node:fs";
import path from "node:path";
import { packBlueprint, writeBlueprintArchive } from "../lib/blueprint-pack.js";
import { type ListedRelease, createRelease, listReleases } from "../lib/github.js";
import { readJsonFile, sailPath } from "../lib/io.js";
import type { ShareManifest } from "../lib/share.js";

/**
 * `sailor harbor publish` — the producer half of Harbor. Turns the current project
 * into a self-contained blueprint artifact (agent surface + manifest) and releases
 * it into the registry (`sail-money/harbor` by default), tagged `<slug>-v<n>` so
 * `sailor harbor create <slug>` can fetch it. `--local` writes the `.tar.gz` to disk
 * instead of releasing, which is the no-GitHub path for testing and hand-off.
 *
 * The publisher's own identity is redacted and the payload secret-scanned by
 * `packBlueprint` (the same machinery `sailor share` uses). The slug + metadata come
 * from `.sail/share.json`, so a project already prepared for `share` publishes with
 * no extra ceremony.
 */

const DEFAULT_REGISTRY = "sail-money/harbor";
const BLUEPRINT_VERSION = "1.0.0";

export interface HarborPublishOptions {
  registry?: string;
  local?: boolean;
  out?: string;
  json?: boolean;
}

export interface HarborPublishDependencies {
  packBlueprint?: typeof packBlueprint;
  writeBlueprintArchive?: typeof writeBlueprintArchive;
  listReleases?: typeof listReleases;
  createRelease?: typeof createRelease;
  readShareManifest?: () => ShareManifest | null;
}

/** Next `<slug>-v<n>` release number: one past the highest existing one, or 1. */
function nextReleaseNumber(releases: ListedRelease[], slug: string): number {
  const prefix = `${slug}-v`;
  let max = 0;
  for (const r of releases) {
    if (!r.tag.startsWith(prefix)) continue;
    const n = Number(r.tag.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

export async function harborPublish(
  options: HarborPublishOptions = {},
  deps: HarborPublishDependencies = {},
): Promise<void> {
  const projectRoot = process.cwd();
  const pack = deps.packBlueprint ?? packBlueprint;
  const writeArchive = deps.writeBlueprintArchive ?? writeBlueprintArchive;
  const list = deps.listReleases ?? listReleases;
  const release = deps.createRelease ?? createRelease;
  const readShare =
    deps.readShareManifest ?? (() => readJsonFile<ShareManifest>(sailPath("share.json")));

  const share = readShare();
  if (!share?.slug) {
    throw new Error(
      "No .sail/share.json slug. Run `sailor share` once (or write .sail/share.json) so the blueprint has a name.",
    );
  }
  const slug = share.slug;
  const registry = options.registry ?? DEFAULT_REGISTRY;

  const packed = await pack(projectRoot, {
    slug,
    version: BLUEPRINT_VERSION,
    kind: "crystallized",
    chains: share.chains,
    author: share.author,
  });

  const archivePath = writeArchive(packed);
  try {
    if (options.local) {
      const out = path.resolve(process.cwd(), options.out ?? `${slug}-blueprint.tar.gz`);
      fs.copyFileSync(archivePath, out);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              status: "ok",
              mode: "local",
              out,
              slug,
              files: packed.files.size,
              review: packed.review,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(`\n✓ Wrote blueprint ${slug} → ${path.relative(process.cwd(), out) || out}`);
        console.log(
          `  ${packed.files.size} file(s), ${packed.redactions.length} redaction group(s)`,
        );
        console.log(`\n  Try it locally with: sailor blueprint start ${path.basename(out)} <dir>`);
        console.log("  Or release it with: sailor harbor publish (without --local)");
      }
      return;
    }

    const n = nextReleaseNumber(await list(registry), slug);
    const tag = `${slug}-v${n}`;
    const assetBytes = fs.readFileSync(archivePath);

    console.log(`Packaging "${slug}" and releasing to ${registry} ...`);
    console.log(`  ${packed.files.size} file(s), tag ${tag}`);
    const rel = await release(registry, {
      tag,
      name: share.name || slug,
      body: share.summary || share.description || "",
      assetName: `${slug}.tar.gz`,
      assetBytes,
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: "ok",
            tag: rel.tag,
            url: rel.htmlUrl,
            slug,
            files: packed.files.size,
            review: packed.review,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`\n✓ Released ${slug} as ${tag}`);
      console.log(`  ${rel.htmlUrl}`);
      console.log(`\n  Try it with: sailor harbor create ${slug}`);
    }
  } finally {
    fs.rmSync(archivePath, { recursive: true, force: true });
  }
}
