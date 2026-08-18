import fs from "node:fs";
import path from "node:path";
import { packBlueprint, writeBlueprintArchive } from "../lib/blueprint-pack.js";
import { submitContribution } from "../lib/contribution.js";
import { type ListedRelease, createRelease, listReleases } from "../lib/github.js";
import { readJsonFile, sailPath } from "../lib/io.js";
import type { ShareManifest } from "../lib/share.js";

/**
 * `sailor harbor publish` — the producer half of Harbor. Turns the current project
 * into a self-contained blueprint artifact (agent surface + manifest).
 *
 * By default it does NOT release directly: it opens a pull request into the
 * registry (`sail-money/harbor`) that a maintainer reviews and merges, and registry
 * CI turns the merge into a tagged release (`<slug>-v<n>`) that `sailor harbor create`
 * can fetch. This is the review gate that keeps the catalog curated. `--release`
 * skips review and releases directly (maintainers only); `--local` writes the
 * `.tar.gz` to disk with no GitHub at all.
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
  /** Skip review: release directly instead of opening a pull request. */
  release?: boolean;
}

export interface HarborPublishDependencies {
  packBlueprint?: typeof packBlueprint;
  writeBlueprintArchive?: typeof writeBlueprintArchive;
  listReleases?: typeof listReleases;
  createRelease?: typeof createRelease;
  submitContribution?: typeof submitContribution;
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

/** One-line + detail PR body for the review gate. */
function renderPrBody(share: ShareManifest): string {
  const lines = [share.summary || share.description || "", ""];
  if (share.description && share.description !== share.summary) {
    lines.push(share.description, "");
  }
  lines.push(
    `Author: ${share.author || "unknown"}`,
    `Chains: ${(share.chains ?? []).join(", ") || "none"}`,
  );
  lines.push("", "Review before merge: this publishes a ready-to-run money agent that runs");
  lines.push("with real funds. On merge, registry CI releases it as a tagged blueprint.");
  return lines.join("\n");
}

/** Registry-side metadata for a blueprint submission, written next to the artifact. */
function blueprintManifest(share: ShareManifest): Record<string, unknown> {
  return {
    slug: share.slug,
    name: share.name,
    summary: share.summary,
    description: share.description,
    author: share.author,
    chains: share.chains ?? [],
    blueprintVersion: BLUEPRINT_VERSION,
    createdAt: new Date().toISOString(),
  };
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
  const contribute = deps.submitContribution ?? submitContribution;
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
    // ── --local: write the archive to disk, no GitHub. ─────────────────────────
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
        console.log("  Or submit it for review with: sailor harbor publish (without --local)");
      }
      return;
    }

    // ── --release: maintainer path, release directly (no review). ─────────────
    if (options.release) {
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
              mode: "release",
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
      return;
    }

    // ── default: open a pull request for review. ──────────────────────────────
    const assetBytes = fs.readFileSync(archivePath);
    const manifest = blueprintManifest(share);
    const result = await contribute({
      repo: registry,
      base: "main",
      branch: `publish/${slug}`,
      populate: (checkoutDir) => {
        const dest = path.join(checkoutDir, "blueprints", slug);
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, `${slug}.tar.gz`), assetBytes);
        fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));
      },
      commitMessage: `feat(${slug}): submit blueprint for review`,
      prTitle: share.summary || `Publish ${share.name || slug}`,
      prBody: renderPrBody(share),
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: "ok",
            mode: "pr",
            repo: registry,
            slug,
            pr: result.pr.number,
            url: result.pr.htmlUrl,
            via: result.direct ? "direct" : "fork",
            pushTarget: result.pushTarget,
            files: packed.files.size,
            review: packed.review,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`\n✓ Opened PR #${result.pr.number} on ${registry}`);
      console.log(`  ${result.pr.htmlUrl}`);
      console.log(
        result.direct
          ? "  pushed branch directly (you have write access)"
          : `  via your fork ${result.pushTarget} (cross-repo PR)`,
      );
      console.log(
        "\nA maintainer reviews and merges; registry CI then releases the tagged blueprint.",
      );
    }
  } finally {
    fs.rmSync(archivePath, { recursive: true, force: true });
  }
}
