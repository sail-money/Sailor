import { resolveToken } from "../commands/trigger.js";

/**
 * Thin GitHub REST helpers shared by `sailor share` (open a PR) and
 * `sailor clone` (resolve + download a release asset). Same conventions as
 * commands/trigger.ts: raw `fetch`, no SDK, token only from the environment via
 * {@link resolveToken}. Re-exported here so the share/clone commands have a
 * single import surface.
 */
export { resolveToken, parseRepoFromRemoteUrl } from "../commands/trigger.js";

const GH_API = "https://api.github.com";

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "sailor-cli",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghError(res: Response, action: string): Promise<Error> {
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string };
    detail = body.message ? `: ${body.message}` : "";
  } catch {
    /* no body */
  }
  return new Error(`GitHub returned ${res.status} while ${action}${detail}`);
}

export interface PullRequest {
  number: number;
  htmlUrl: string;
}

/** Login of the token's owner (`GET /user`). */
export async function getViewerLogin(): Promise<string> {
  const token = resolveToken();
  const res = await fetch(`${GH_API}/user`, { headers: ghHeaders(token) });
  if (!res.ok) throw await ghError(res, "reading the authenticated user");
  return ((await res.json()) as { login: string }).login;
}

/** Whether the token can push to `repo` (collaborator/member with write). */
export async function canPush(repo: string): Promise<boolean> {
  const token = resolveToken();
  const res = await fetch(`${GH_API}/repos/${repo}`, { headers: ghHeaders(token) });
  if (!res.ok) return false;
  const r = (await res.json()) as { permissions?: { push?: boolean; maintain?: boolean } };
  return Boolean(r.permissions?.push || r.permissions?.maintain);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Ensure the token's owner has a fork of `baseRepo` (owner/name) and return the
 * fork's `full_name` (`<login>/<name>`). Creates it if missing and polls until
 * GitHub finishes provisioning it. This is what lets a public user — with no write
 * access to the registry — open a cross-repo PR from their own fork.
 */
export async function ensureFork(baseRepo: string): Promise<string> {
  const token = resolveToken();
  const name = baseRepo.split("/")[1];
  const login = await getViewerLogin();
  const forkRepo = `${login}/${name}`;

  const exists = async (): Promise<boolean> => {
    const res = await fetch(`${GH_API}/repos/${forkRepo}`, { headers: ghHeaders(token) });
    return res.ok;
  };

  if (!(await exists())) {
    const res = await fetch(`${GH_API}/repos/${baseRepo}/forks`, {
      method: "POST",
      headers: ghHeaders(token),
    });
    if (!res.ok && res.status !== 202) throw await ghError(res, `forking ${baseRepo}`);
    // Fork creation is async — poll until the repo is queryable (~up to 30s).
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      if (await exists()) break;
    }
    if (!(await exists())) {
      throw new Error(`Fork ${forkRepo} was requested but isn't ready yet — retry shortly.`);
    }
  }
  return forkRepo;
}

/**
 * Open a pull request. Token must have `pull_requests: write` on `repo`.
 * `head` is the branch name (same-repo PR); `base` is the target branch.
 */
export async function openPullRequest(args: {
  repo: string; // owner/repo
  title: string;
  body: string;
  head: string;
  base: string;
}): Promise<PullRequest> {
  const token = resolveToken();
  const res = await fetch(`${GH_API}/repos/${args.repo}/pulls`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      title: args.title,
      body: args.body,
      head: args.head,
      base: args.base,
    }),
  });
  if (res.status !== 201) throw await ghError(res, `opening a PR on ${args.repo}`);
  const pr = (await res.json()) as { number: number; html_url: string };
  return { number: pr.number, htmlUrl: pr.html_url };
}

export interface ReleaseAsset {
  name: string;
  downloadUrl: string; // browser_download_url
  apiUrl: string; // /releases/assets/:id (octet-stream)
  size: number;
  downloadCount: number;
}

export interface Release {
  tag: string;
  assets: ReleaseAsset[];
}

export interface ListedRelease extends Release {
  name: string;
  body: string;
  publishedAt: string;
}

/** True if `err` is a GitHub 404 (repo or endpoint not found). */
export function isGithubNotFound(err: unknown): boolean {
  return err instanceof Error && /GitHub returned 404/.test(err.message);
}

/** Fetch a release by tag. Token optional for public repos. */
export async function getReleaseByTag(repo: string, tag: string): Promise<Release> {
  const token = process.env.SAIL_GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const res = await fetch(`${GH_API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) throw await ghError(res, `fetching release "${tag}" on ${repo}`);
  const rel = (await res.json()) as {
    tag_name: string;
    assets: Array<{
      name: string;
      browser_download_url: string;
      url: string;
      size: number;
      download_count: number;
    }>;
  };
  return {
    tag: rel.tag_name,
    assets: rel.assets.map((a) => ({
      name: a.name,
      downloadUrl: a.browser_download_url,
      apiUrl: a.url,
      size: a.size,
      downloadCount: a.download_count,
    })),
  };
}

/**
 * List all releases on a repo, newest first, following pagination (100 per page, up to
 * 10 pages). Token optional for public repos. This is what `sailor harbor list` and
 * `sailor harbor start` use to discover blueprints in the registry.
 */
export async function listReleases(repo: string): Promise<ListedRelease[]> {
  const token = process.env.SAIL_GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const out: ListedRelease[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${GH_API}/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers: ghHeaders(token),
    });
    if (!res.ok) throw await ghError(res, `listing releases on ${repo}`);
    const rels = (await res.json()) as Array<{
      tag_name: string;
      name: string | null;
      body: string | null;
      published_at: string | null;
      assets: Array<{
        name: string;
        browser_download_url: string;
        url: string;
        size: number;
        download_count: number;
      }>;
    }>;
    for (const r of rels) {
      out.push({
        tag: r.tag_name,
        name: r.name ?? "",
        body: r.body ?? "",
        publishedAt: r.published_at ?? "",
        assets: r.assets.map((a) => ({
          name: a.name,
          downloadUrl: a.browser_download_url,
          apiUrl: a.url,
          size: a.size,
          downloadCount: a.download_count,
        })),
      });
    }
    if (rels.length < 100) break;
  }
  return out;
}

/** Download a release asset to a Buffer. Token optional for public repos. */
export async function downloadAsset(url: string): Promise<Buffer> {
  const token = process.env.SAIL_GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const res = await fetch(url, {
    headers: { ...ghHeaders(token), Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!res.ok) throw await ghError(res, `downloading asset from ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface CreateReleaseInput {
  tag: string;
  name?: string;
  body?: string;
  assetName?: string;
  assetBytes?: Uint8Array;
}

export interface CreatedRelease {
  tag: string;
  htmlUrl: string;
}

/**
 * Upload a binary asset to a release. GitHub serves release assets from
 * `uploads.github.com` (the `upload_url` returned by the create-release call),
 * NOT from `api.github.com` — POSTing to the API host returns 404 even though
 * the release already exists. The upload is retried a few times on transient
 * 404/5xx, since a freshly created release is occasionally not indexed for a
 * beat after creation.
 */
async function uploadReleaseAsset(
  token: string,
  uploadUrl: string,
  assetName: string,
  assetBytes: Uint8Array,
): Promise<void> {
  // upload_url looks like `…/assets{?name,label}`; append the name query param.
  const url = `${uploadUrl.replace(/\{\?name,label\}$/, "")}?name=${encodeURIComponent(assetName)}`;

  let last: Response | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const up = await fetch(url, {
      method: "POST",
      headers: { ...ghHeaders(token), "Content-Type": "application/octet-stream" },
      body: assetBytes as unknown as BodyInit,
    });
    if (up.status === 201) return;
    last = up;
    // 404 = not indexed yet; 502/503 = upload backend not ready. Anything else is a
    // hard failure we surface immediately.
    if (up.status !== 404 && up.status !== 502 && up.status !== 503) break;
    await sleep(attempt * 1000);
  }
  if (last) throw await ghError(last, `uploading asset "${assetName}"`);
  throw new Error(`uploading asset "${assetName}" failed`);
}

/**
 * Create a release (and optionally attach a binary asset) on a repo. Requires a token
 * with `contents: write` on the repo — this is the write path `sailor harbor publish`
 * uses to release a blueprint into the registry.
 */
export async function createRelease(
  repo: string,
  input: CreateReleaseInput,
): Promise<CreatedRelease> {
  const token = resolveToken();
  const res = await fetch(`${GH_API}/repos/${repo}/releases`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: input.tag,
      name: input.name ?? input.tag,
      body: input.body ?? "",
      draft: false,
      prerelease: false,
    }),
  });
  if (res.status !== 201) throw await ghError(res, `creating release "${input.tag}" on ${repo}`);
  const rel = (await res.json()) as { id: number; html_url: string; upload_url?: string };

  if (input.assetName && input.assetBytes) {
    const uploadUrl =
      rel.upload_url ??
      `https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets{?name,label}`;
    await uploadReleaseAsset(token, uploadUrl, input.assetName, input.assetBytes);
  }

  return { tag: input.tag, htmlUrl: rel.html_url };
}

/**
 * Parse a release reference from user input. Accepts:
 *   - `owner/repo@tag`
 *   - a release page URL: https://github.com/owner/repo/releases/tag/<tag>
 *   - an asset download URL: https://github.com/owner/repo/releases/download/<tag>/<file>
 * Returns repo + tag (+ asset filename if the URL named one).
 */
export function parseReleaseRef(input: string): { repo: string; tag: string; asset?: string } {
  const shorthand = input.match(/^([^/\s]+\/[^/\s@]+)@(.+)$/);
  if (shorthand) return { repo: shorthand[1], tag: shorthand[2] };

  const dl = input.match(/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)/);
  if (dl) return { repo: dl[1], tag: decodeURIComponent(dl[2]), asset: decodeURIComponent(dl[3]) };

  const tagUrl = input.match(/github\.com\/([^/]+\/[^/]+)\/releases\/tag\/([^/?#]+)/);
  if (tagUrl) return { repo: tagUrl[1], tag: decodeURIComponent(tagUrl[2]) };

  throw new Error(
    `Could not parse a release reference from "${input}".\nUse owner/repo@tag, a release page URL, or a release asset download URL.`,
  );
}
