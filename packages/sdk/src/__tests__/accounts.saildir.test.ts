import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { defaultSailDir } from "../accounts.js";

// `defaultSailDir` is the default argument behind every account read and write
// in this package (readActiveAccount, persistAccount, switchAccount, …), so
// where it points decides which project's state the SDK touches. The CLI has a
// matching resolver and the two must agree; that cross-package agreement is
// asserted in packages/cli/src/lib/io.test.ts, which can import both. Here we
// pin the SDK half on its own.
//
// Note: defaultSailDir takes no arguments and always resolves against
// process.cwd(), so these cases move the cwd rather than passing a root.

function withEnvAndCwd<T>(sailDir: string | undefined, cwd: string, fn: () => T): T {
  const savedEnv = process.env["SAIL_DIR"];
  const savedCwd = process.cwd();
  if (sailDir === undefined) delete process.env["SAIL_DIR"];
  else process.env["SAIL_DIR"] = sailDir;
  process.chdir(cwd);
  try {
    return fn();
  } finally {
    process.chdir(savedCwd);
    if (savedEnv === undefined) delete process.env["SAIL_DIR"];
    else process.env["SAIL_DIR"] = savedEnv;
  }
}

function tempRoot(): { root: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "sdk-saildir-"));
  // macOS reports /var/... as /private/var/... once you chdir into it; compare
  // against the realpath form so assertions are not fighting the symlink.
  return { root: path.resolve(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("defaultSailDir: no override resolves to <cwd>/.sail", () => {
  const { root, cleanup } = tempRoot();
  try {
    withEnvAndCwd(undefined, root, () => {
      assert.equal(defaultSailDir(), path.join(process.cwd(), ".sail"));
    });
  } finally {
    cleanup();
  }
});

test("defaultSailDir: an absolute SAIL_DIR is honoured verbatim", () => {
  const { root, cleanup } = tempRoot();
  const elsewhere = mkdtempSync(path.join(tmpdir(), "sdk-elsewhere-"));
  try {
    withEnvAndCwd(elsewhere, root, () => {
      assert.equal(defaultSailDir(), elsewhere);
    });
  } finally {
    cleanup();
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("defaultSailDir: a relative SAIL_DIR resolves against the cwd", () => {
  const { root, cleanup } = tempRoot();
  try {
    withEnvAndCwd(path.join(".shipyard", "sandbox"), root, () => {
      assert.equal(defaultSailDir(), path.join(process.cwd(), ".shipyard", "sandbox"));
    });
  } finally {
    cleanup();
  }
});

test("defaultSailDir: an empty SAIL_DIR falls back to .sail, not the filesystem root", () => {
  const { root, cleanup } = tempRoot();
  try {
    withEnvAndCwd("", root, () => {
      const resolved = defaultSailDir();
      assert.equal(resolved, path.join(process.cwd(), ".sail"));
      assert.notEqual(resolved, path.parse(resolved).root);
      assert.notEqual(resolved, process.cwd());
    });
  } finally {
    cleanup();
  }
});

test("defaultSailDir: a whitespace-only SAIL_DIR cannot reach the root or the bare cwd", () => {
  const { root, cleanup } = tempRoot();
  try {
    withEnvAndCwd(" ", root, () => {
      const resolved = defaultSailDir();
      assert.notEqual(resolved, path.parse(resolved).root);
      assert.notEqual(resolved, process.cwd());
    });
  } finally {
    cleanup();
  }
});

test("defaultSailDir: live and sandbox roots never collide", () => {
  const { root, cleanup } = tempRoot();
  try {
    const live = withEnvAndCwd(undefined, root, () => defaultSailDir());
    const sandbox = withEnvAndCwd(path.join(".shipyard", "sandbox"), root, () => defaultSailDir());
    assert.notEqual(sandbox, live);
    const rel = path.relative(live, sandbox);
    assert.equal(rel.startsWith("..") || path.isAbsolute(rel), true, "sandbox must not sit inside live");
  } finally {
    cleanup();
  }
});
