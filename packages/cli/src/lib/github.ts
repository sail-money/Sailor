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
