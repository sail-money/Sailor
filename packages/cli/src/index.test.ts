import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with: npx tsx --test packages/cli/src/index.test.ts
// (requires `pnpm --filter @sail/sdk build` first so @sail/sdk resolves.)
//
// These tests exercise the real commander tree in index.ts via a subprocess.
// `mandate register` / `--register` are canonical; `mandate attach` / `--attach`
// are hidden backward-compatible aliases that must keep resolving without
// appearing in --help.

const TSX_BIN = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const CLI_ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));

function runCli(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(TSX_BIN, [CLI_ENTRY, ...args], { cwd, encoding: "utf-8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

function emptyProjectDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "sail-cli-surface-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("mandate --help lists register, not attach", () => {
  const { dir, cleanup } = emptyProjectDir();
  try {
    const { stdout, status } = runCli(["mandate", "--help"], dir);
    assert.equal(status, 0);
    assert.match(stdout, /\bregister\b/, "register must be listed as a subcommand");
    assert.doesNotMatch(stdout, /\battach\b/, "attach must not appear in --help output");
  } finally {
    cleanup();
  }
});

test("mandate deploy --help documents --register, not --attach", () => {
  const { dir, cleanup } = emptyProjectDir();
  try {
    const { stdout, status } = runCli(["mandate", "deploy", "--help"], dir);
    assert.equal(status, 0);
    assert.match(stdout, /--register/, "--register must be documented");
    assert.doesNotMatch(stdout, /--attach/, "--attach must not appear in --help output");
  } finally {
    cleanup();
  }
});

test("mandate register --help resolves as the canonical command", () => {
  const { dir, cleanup } = emptyProjectDir();
  try {
    const { stdout, status } = runCli(["mandate", "register", "--help"], dir);
    assert.equal(status, 0);
    assert.match(stdout, /--address/);
    assert.match(stdout, /--sma/);
  } finally {
    cleanup();
  }
});

test("mandate attach resolves as a hidden alias (same options, not 'unknown command')", () => {
  const { dir, cleanup } = emptyProjectDir();
  try {
    // --help on the hidden command still works even though it's absent from
    // the parent's --help listing.
    const help = runCli(["mandate", "attach", "--help"], dir);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--address/);
    assert.match(help.stdout, /--sma/);
    assert.doesNotMatch(help.stderr, /unknown command/i);

    // Invoking it with no args hits commander's own required-option error —
    // proof the alias resolved into the real option schema, not a typo.
    const bare = runCli(["mandate", "attach"], dir);
    assert.notEqual(bare.status, 0);
    assert.doesNotMatch(bare.stderr, /unknown command/i);
    assert.match(bare.stderr, /required option '--address/);
  } finally {
    cleanup();
  }
});

test("mandate deploy --attach is accepted as a hidden alias for --register", () => {
  const { dir, cleanup } = emptyProjectDir();
  try {
    // No .sail project in `dir`, so mandateDeploy's requireProject() fires
    // first — proving commander accepted --attach as a known option (an
    // unrecognized flag would fail during argument parsing, before the
    // handler ever runs).
    const result = runCli(
      ["mandate", "deploy", "--attach", "--sma", "0x1234567890123456789012345678901234567890"],
      dir,
    );
    assert.doesNotMatch(result.stderr, /unknown option/i);
    assert.match(result.stdout, /No Sailor project found/);
  } finally {
    cleanup();
  }
});

// ── `shipyard` alias for `sandbox` ──────────────────────────────────────────
// The product is called Shipyard and its state lives in `.shipyard/`, but the
// command is `sailor sandbox`. `shipyard` is accepted as an alias so a reader
// of the docs who types the product name gets the command instead of "unknown
// command" — while `--help` keeps advertising exactly one spelling.

test("sandbox --help lists the subcommands, and shipyard is not a separate top-level command", () => {
  const { dir, cleanup } = emptyProjectDir();
  try {
    const { stdout, status } = runCli(["--help"], dir);
    assert.equal(status, 0);
    assert.match(stdout, /^\s*sandbox\b/m, "sandbox must be advertised in the top-level help");
    assert.doesNotMatch(
      stdout,
      /^\s*shipyard\b/m,
      "shipyard is an alias and must not get its own top-level help entry",
    );
  } finally {
    cleanup();
  }
});

test("sailor shipyard resolves as an alias (not 'unknown command')", () => {
  const { dir, cleanup } = emptyProjectDir();
  try {
    const { stdout, stderr, status } = runCli(["shipyard", "--help"], dir);
    assert.equal(status, 0, `expected shipyard --help to exit 0; stderr: ${stderr}`);
    assert.doesNotMatch(stderr, /unknown command/i);
    // Proof it resolved into the real command, not a near-miss: the subcommands
    // must be reachable through the alias too, not just the canonical spelling.
    for (const sub of ["start", "stop", "status"]) {
      assert.match(stdout, new RegExp(`\\b${sub}\\b`), `${sub} must be reachable via the alias`);
    }
  } finally {
    cleanup();
  }
});

test("sandbox and shipyard resolve to the same command", () => {
  const { dir, cleanup } = emptyProjectDir();
  try {
    const canonical = runCli(["sandbox", "--help"], dir);
    const aliased = runCli(["shipyard", "--help"], dir);
    assert.equal(canonical.status, 0);
    assert.equal(aliased.status, 0);
    assert.notEqual(canonical.stdout.trim(), "", "help output must not be empty");
    // Commander renders one help page for a command and its aliases — the usage
    // line reads "sandbox|shipyard" whichever spelling was invoked — so the two
    // outputs are byte-identical when they are genuinely the same command.
    assert.equal(aliased.stdout, canonical.stdout, "alias and canonical help must match");
    assert.match(canonical.stdout, /sandbox\|shipyard/, "usage line must show both spellings");
  } finally {
    cleanup();
  }
});

test("subcommand flags are reachable through the shipyard alias", () => {
  const { dir, cleanup } = emptyProjectDir();
  try {
    const { stdout, stderr, status } = runCli(["shipyard", "stop", "--help"], dir);
    assert.equal(status, 0, `stderr: ${stderr}`);
    assert.match(stdout, /--keep-forks/, "--keep-forks must be documented via the alias");
  } finally {
    cleanup();
  }
});
