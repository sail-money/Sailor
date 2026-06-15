import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDispatchRequest,
  parseRepoFromRemoteUrl,
  resolveRepo,
  resolveToken,
} from "./trigger.js";

// Run with: npx tsx --test packages/cli/src/commands/trigger.test.ts
// (the CLI has no wired `test` script — same convention as the SDK's colocated tests.)

test("parseRepoFromRemoteUrl: https form", () => {
  assert.equal(parseRepoFromRemoteUrl("https://github.com/sail-money/Sailor.git"), "sail-money/Sailor");
  assert.equal(parseRepoFromRemoteUrl("https://github.com/sail-money/Sailor"), "sail-money/Sailor");
});

test("parseRepoFromRemoteUrl: ssh forms", () => {
  assert.equal(parseRepoFromRemoteUrl("git@github.com:sail-money/Sailor.git"), "sail-money/Sailor");
  assert.equal(parseRepoFromRemoteUrl("ssh://git@github.com/sail-money/Sailor.git"), "sail-money/Sailor");
});

test("parseRepoFromRemoteUrl: non-GitHub remote → null", () => {
  assert.equal(parseRepoFromRemoteUrl("https://gitlab.com/x/y.git"), null);
});

test("resolveRepo: validates the explicit --repo form", () => {
  assert.equal(resolveRepo("owner/repo"), "owner/repo");
  assert.throws(() => resolveRepo("not-a-repo"), /owner\/repo/);
});

test("resolveToken: clear error when no env var is set (no hang, no crash)", () => {
  const sail = process.env.SAIL_GH_TOKEN;
  const gh = process.env.GITHUB_TOKEN;
  delete process.env.SAIL_GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    assert.throws(() => resolveToken(), /No GitHub token found/);
  } finally {
    if (sail !== undefined) process.env.SAIL_GH_TOKEN = sail;
    if (gh !== undefined) process.env.GITHUB_TOKEN = gh;
  }
});

test("buildDispatchRequest: token lives ONLY in the Authorization header", () => {
  const req = buildDispatchRequest({
    repo: "sail-money/Sailor",
    workflow: "agent-tick.yml",
    ref: "main",
    reason: "unit-test",
    token: "tok_SECRET_VALUE",
  });
  assert.equal(
    req.url,
    "https://api.github.com/repos/sail-money/Sailor/actions/workflows/agent-tick.yml/dispatches",
  );
  assert.equal(req.method, "POST");
  assert.equal(req.headers.Authorization, "Bearer tok_SECRET_VALUE");
  // The secret must never appear in the URL or the body.
  assert.ok(!req.url.includes("tok_SECRET_VALUE"));
  assert.ok(!req.body.includes("tok_SECRET_VALUE"));
  const body = JSON.parse(req.body) as { ref: string; inputs: { reason: string } };
  assert.equal(body.ref, "main");
  assert.equal(body.inputs.reason, "unit-test");
});
