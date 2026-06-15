import { execFileSync } from "node:child_process";
import { emit } from "../lib/output.js";

/**
 * `sailor trigger github` — wake the agent on demand by firing the project's
 * GitHub Actions `workflow_dispatch` (the same job the cron runs). This is the
 * external-trigger seam: any system that can make an HTTP call (a local watcher,
 * a keeper, a webhook) can cause a run, while authority stays bounded by the
 * manager signature + mandate on-chain. No protocol change, no new key exposure.
 *
 * Credential handling (deliberate): the GitHub token is read from the
 * environment ONLY (SAIL_GH_TOKEN, else GITHUB_TOKEN). It is never accepted as a
 * CLI argument (which would leak into shell history / the process list), never
 * prompted for, and never written to disk or logged. It travels only as the
 * Authorization header on the dispatch request.
 */

export interface TriggerGithubOptions {
  workflow?: string;
  ref?: string;
  reason?: string;
  repo?: string;
  json?: boolean;
}

const GH_API = "https://api.github.com";

/**
 * Parse `owner/repo` from a git remote URL (https or ssh form). Returns null if
 * the URL isn't a recognizable GitHub remote.
 */
export function parseRepoFromRemoteUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\.git$/, "");
  // Matches https://github.com/owner/repo, git@github.com:owner/repo,
  // and ssh://git@github.com/owner/repo.
  const m = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+?)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Resolve `owner/repo`: explicit `--repo` wins, else the git `origin` remote. */
export function resolveRepo(explicit?: string): string {
  if (explicit) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(explicit)) {
      throw new Error(`--repo must be in "owner/repo" form — got: "${explicit}"`);
    }
    return explicit;
  }
  let url: string;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(
      'Could not read the git remote "origin".\nPass --repo <owner/repo> explicitly.',
    );
  }
  const repo = parseRepoFromRemoteUrl(url);
  if (!repo) {
    throw new Error(
      `Could not parse a GitHub owner/repo from the origin remote (${url}).\nPass --repo <owner/repo>.`,
    );
  }
  return repo;
}

/**
 * Read the GitHub token from the environment ONLY — never argv, never a prompt,
 * never stored. Fails with actionable guidance if unset.
 */
export function resolveToken(): string {
  const token = process.env.SAIL_GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "No GitHub token found. Set SAIL_GH_TOKEN (or GITHUB_TOKEN) in your environment.\n" +
        "It needs the `actions: write` permission on the repo (a fine-grained PAT or a GitHub App token).\n" +
        "The token is read from the environment only — it is never passed as an argument or stored.",
    );
  }
  return token;
}

export interface DispatchRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/**
 * Build the `workflow_dispatch` request. Pure and side-effect-free so it can be
 * unit-tested without a token or the network. The token lives ONLY in the
 * Authorization header — never in the URL or body.
 */
export function buildDispatchRequest(args: {
  repo: string;
  workflow: string;
  ref: string;
  reason: string;
  token: string;
}): DispatchRequest {
  return {
    url: `${GH_API}/repos/${args.repo}/actions/workflows/${encodeURIComponent(args.workflow)}/dispatches`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "sailor-cli",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: args.ref, inputs: { reason: args.reason } }),
  };
}

export async function triggerGithub(options: TriggerGithubOptions = {}): Promise<void> {
  const workflow = options.workflow ?? "agent-tick.yml";
  const ref = options.ref ?? "main";
  const reason = options.reason ?? "manual";
  const repo = resolveRepo(options.repo);
  const token = resolveToken();

  const req = buildDispatchRequest({ repo, workflow, ref, reason, token });

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  } catch (err) {
    // Network/DNS error — never includes the token.
    throw new Error(`Could not reach GitHub to fire workflow_dispatch: ${(err as Error).message}`);
  }

  // A successful workflow_dispatch returns 204 No Content.
  if (res.status === 204) {
    emit(
      options.json,
      () => {
        console.log(`✓ Triggered ${workflow} on ${repo}@${ref}`);
        console.log(`  reason: ${reason}`);
        console.log(`  runs:   https://github.com/${repo}/actions/workflows/${workflow}`);
      },
      { status: "ok", repo, workflow, ref, reason },
    );
    return;
  }

  // Surface GitHub's error clearly — body/status only, never the token.
  let detail = "";
  try {
    detail = await res.text();
  } catch {
    /* no body */
  }
  let message = `GitHub returned ${res.status}`;
  if (res.status === 401) message += " — bad or expired token";
  else if (res.status === 403) message += " — token lacks `actions: write` on this repo";
  else if (res.status === 404)
    message += ` — workflow "${workflow}" or repo "${repo}" not found (or the token can't see it)`;
  if (detail) {
    try {
      const parsed = JSON.parse(detail) as { message?: string };
      if (parsed.message) message += `: ${parsed.message}`;
    } catch {
      message += `: ${detail.slice(0, 200)}`;
    }
  }
  throw new Error(message);
}
