import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ListedRelease,
  type ReleaseAsset,
  downloadAsset,
  isGithubNotFound,
  listReleases,
} from "../lib/github.js";
import { blueprintStart } from "./blueprint-start.js";

/**
 * `sailor harbor list | create` — the one-word entry point for Harbor, the library of
 * ready-to-run money agents. Blueprints are published as GitHub releases in the registry
 * (`sail-money/Dock` by default), one release per agent tagged `<slug>-v<n>` with a `.tar.gz`
 * blueprint artifact. `list` shows what is available; `create` downloads the latest release for
 * a slug and hands off to `blueprint start` (skeleton + import + install + guided onboarding).
 *
 * Discovery and download are deliberately the only things here: trust (verification, secret
 * scan, import confirmation) lives in `blueprint import`, which `blueprint start` calls.
 */

const DEFAULT_REGISTRY = "sail-money/Dock";

// ── helpers ────────────────────────────────────────────────────────────────────

/** A registry tag is `<slug>-v<n>`; strip the version suffix to recover the slug. */
function slugFromTag(tag: string): string {
  return tag.replace(/-v\d+$/, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function versionNumber(tag: string): number {
  const m = tag.match(/-v(\d+)$/);
  return m ? Number(m[1]) : 0;
}

/** Is `tag` a release of `slug`? Accepts `<slug>` and `<slug>-v<n>`. */
function isSlugRelease(tag: string, slug: string): boolean {
  return new RegExp(`^${escapeRegExp(slug)}(?:-v\\d+)?$`).test(tag);
}

/** The archive asset of a release: the `.tar.gz`/`.zip` blueprint artifact. */
function pickArchiveAsset(assets: ReleaseAsset[]): ReleaseAsset {
  const hit = assets.find((a) => a.name.endsWith(".tar.gz") || a.name.endsWith(".zip"));
  if (!hit) throw new Error("Release has no .tar.gz or .zip asset to import.");
  return hit;
}

/** Highest-version release for a slug, or undefined if none matches. */
function resolveLatest(releases: ListedRelease[], slug: string): ListedRelease | undefined {
  let best: ListedRelease | undefined;
  let bestN = -1;
  for (const r of releases) {
    if (!isSlugRelease(r.tag, slug)) continue;
    const n = versionNumber(r.tag);
    if (n > bestN) {
      best = r;
      bestN = n;
    }
  }
  return best;
}

function firstLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

function formatDownloads(n: number): string {
  return `${n.toLocaleString("en-US")} downloads`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface HarborEntry {
  slug: string;
  name: string;
  summary: string;
  version: string;
  downloads: number;
}

/** Collapse a release list into one entry per slug: latest version and its download count. */
function summarize(releases: ListedRelease[]): HarborEntry[] {
  const bySlug = new Map<string, ListedRelease>();
  for (const r of releases) {
    const slug = slugFromTag(r.tag);
    const prev = bySlug.get(slug);
    if (!prev || versionNumber(r.tag) > versionNumber(prev.tag)) bySlug.set(slug, r);
  }
  const entries: HarborEntry[] = [];
  for (const [slug, r] of bySlug) {
    const archive = r.assets.find((a) => a.name.endsWith(".tar.gz") || a.name.endsWith(".zip"));
    entries.push({
      slug,
      name: r.name || slug,
      summary: firstLine(r.body),
      version: r.tag,
      downloads: archive?.downloadCount ?? 0,
    });
  }
  return entries.sort((a, b) => a.slug.localeCompare(b.slug));
}

// ── list ───────────────────────────────────────────────────────────────────────

export interface HarborListOptions {
  registry?: string;
  json?: boolean;
}

export interface HarborListDependencies {
  listReleases?: typeof listReleases;
}

export async function harborList(
  options: HarborListOptions = {},
  deps: HarborListDependencies = {},
): Promise<void> {
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const list = deps.listReleases ?? listReleases;
  let releases: ListedRelease[];
  try {
    releases = await list(registry);
  } catch (err) {
    if (!isGithubNotFound(err)) throw err;
    if (options.json) {
      console.log(JSON.stringify({ registry, error: "not_found", count: 0, agents: [] }, null, 2));
    } else {
      console.log(`No registry at ${registry} yet.`);
      console.log(
        "\nIt appears as soon as the first agent is published there. Try again after one is shared.",
      );
    }
    return;
  }
  const entries = summarize(releases);

  if (options.json) {
    console.log(JSON.stringify({ registry, count: entries.length, agents: entries }, null, 2));
    return;
  }

  console.log(`Available agents (${registry}):\n`);
  if (entries.length === 0) {
    console.log("  None published yet.");
    console.log(
      `\n  Publish one to ${registry}, or build and share a project with \`sailor share\`.`,
    );
    return;
  }
  for (const e of entries) {
    console.log(`  ${e.slug}  ${e.version}  ${formatDownloads(e.downloads)}`);
    if (e.summary) console.log(`    ${e.summary}`);
    console.log();
  }
  console.log("Create one with: sailor harbor create <slug>");
}

// ── create ─────────────────────────────────────────────────────────────────────

export interface HarborCreateOptions {
  registry?: string;
  chain?: string;
  yes?: boolean;
  agent?: string | false;
}

export interface HarborCreateDependencies {
  listReleases?: typeof listReleases;
  downloadAsset?: typeof downloadAsset;
  blueprintStart?: typeof blueprintStart;
}

export async function harborCreate(
  slug: string,
  dir: string | undefined,
  options: HarborCreateOptions = {},
  deps: HarborCreateDependencies = {},
): Promise<void> {
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const list = deps.listReleases ?? listReleases;
  const download = deps.downloadAsset ?? downloadAsset;
  const start = deps.blueprintStart ?? blueprintStart;

  let releases: ListedRelease[];
  try {
    releases = await list(registry);
  } catch (err) {
    if (!isGithubNotFound(err)) throw err;
    throw new Error(
      `No blueprint named "${slug}" in ${registry} (the registry is not published yet). Run \`sailor harbor list\` to see what is available.`,
    );
  }
  const release = resolveLatest(releases, slug);
  if (!release) {
    throw new Error(
      `No blueprint named "${slug}" in ${registry}. Run \`sailor harbor list\` to see what is available.`,
    );
  }
  const asset = pickArchiveAsset(release.assets);

  console.log(`Resolving "${slug}" in ${registry} ...`);
  console.log(`  latest release: ${release.tag}`);
  console.log(`  asset: ${asset.name} (${formatBytes(asset.size)})`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-harbor-"));
  const archivePath = path.join(tmp, asset.name);
  try {
    let buf: Buffer;
    try {
      buf = await download(asset.downloadUrl);
    } catch {
      buf = await download(asset.apiUrl);
    }
    fs.writeFileSync(archivePath, buf);
    console.log(`  downloaded ${asset.name}`);
    console.log();

    await start(archivePath, dir ?? slug, {
      chain: options.chain,
      yes: options.yes,
      agent: options.agent,
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
