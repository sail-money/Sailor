import assert from "node:assert/strict";
import { test } from "node:test";
import { gitAuthEnv, scrubSecrets } from "./share.js";

// Run with: npx tsx --test packages/cli/src/commands/share.test.ts

const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

test("gitAuthEnv keeps the raw token out of argv-visible config, injecting it via env only", () => {
  const env = gitAuthEnv(TOKEN);
  // Auth travels as an env-injected http.extraheader (git >= 2.31), never in a
  // remote URL or persisted .git/config.
  assert.equal(env.GIT_CONFIG_COUNT, "1");
  assert.equal(env.GIT_CONFIG_KEY_0, "http.extraheader");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  const basic = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
  assert.equal(env.GIT_CONFIG_VALUE_0, `AUTHORIZATION: basic ${basic}`);
  // The raw token never appears verbatim in any env value (only base64-wrapped).
  for (const v of Object.values(env)) {
    if (typeof v === "string") assert.ok(!v.includes(TOKEN), "raw token not present verbatim");
  }
});

test("scrubSecrets removes tokens from URLs, auth headers, and provider tokens", () => {
  assert.equal(
    scrubSecrets(`fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/o/r.git/'`),
    "fatal: unable to access 'https://***@github.com/o/r.git/'",
  );
  assert.ok(!scrubSecrets(`Authorization: basic ${btoa("x")}`).includes(btoa("x")));
  assert.ok(!scrubSecrets(`token is ${TOKEN} here`).includes(TOKEN));
  const pat = "github_pat_11ABCDEFG0aAbBcCdDeEfFgG";
  assert.ok(!scrubSecrets(`used ${pat}`).includes(pat));
});
