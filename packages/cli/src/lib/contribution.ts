import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitAuthEnv, scrubSecrets } from "../commands/share.js";
import { type PullRequest, canPush, ensureFork, openPullRequest, resolveToken } from "./github.js";

/**
 * Run git, capturing output and scrubbing any auth material from errors. This is
 * a local copy of share.ts's private `git` helper — kept here so `submitContribution`
 * is self-contained and reusable by both `share` and `harbor publish`.
 */
function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  try {
    return execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new Error(scrubSecrets((err as Error).message ?? String(err)));
  }
}

export interface ContributionResult {
  pr: PullRequest;
  /** true when the branch was pushed straight to the registry (write access). */
  direct: boolean;
  /** The repo the branch actually landed in (the registry, or the contributor's fork). */
  pushTarget: string;
}

export interface SubmitContributionArgs {
  /** owner/repo the PR targets (the registry). */
  repo: string;
  /** Target branch of the PR. */
  base: string;
  /** Branch name to create (same name on the registry or the fork). */
  branch: string;
  /** Write the contribution into the freshly checked-out work tree before commit. */
  populate: (checkoutDir: string) => void;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}

/**
 * The contribution path shared by `sailor share` and `sailor harbor publish`:
 * clone the registry, create a branch, populate it, commit, push (straight to the
 * registry when the token has write access, otherwise to a fork), and open a PR.
 * On merge, registry CI turns the merged contribution into a tagged release.
 */
export async function submitContribution(
  args: SubmitContributionArgs,
): Promise<ContributionResult> {
  const token = resolveToken();
  const env = gitAuthEnv(token);
  const baseUrl = `https://github.com/${args.repo}.git`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-contribute-"));

  try {
    const repoDir = path.join(tmp, "repo");
    try {
      git(["clone", "--depth", "1", "--branch", args.base, baseUrl, repoDir], tmp, env);
    } catch {
      git(["clone", "--depth", "1", baseUrl, repoDir], tmp, env);
    }
    git(["checkout", "-b", args.branch], repoDir, env);

    args.populate(repoDir);

    git(["add", "-A"], repoDir, env);
    git(
      [
        "-c",
        "user.name=sailor-cli",
        "-c",
        "user.email=cli@sail.money",
        "commit",
        "-m",
        args.commitMessage,
      ],
      repoDir,
      env,
    );

    const direct = await canPush(args.repo);
    let head = args.branch;
    let pushTarget = args.repo;
    if (direct) {
      git(["push", "-u", "origin", args.branch], repoDir, env);
    } else {
      const fork = await ensureFork(args.repo);
      pushTarget = fork;
      const login = fork.split("/")[0];
      head = `${login}:${args.branch}`; // cross-repo PR head
      const forkUrl = `https://github.com/${fork}.git`;
      git(["remote", "add", "fork", forkUrl], repoDir, env);
      git(["push", "-u", "fork", args.branch], repoDir, env);
    }

    const pr = await openPullRequest({
      repo: args.repo,
      title: args.prTitle,
      body: args.prBody,
      head,
      base: args.base,
    });

    return { pr, direct, pushTarget };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
