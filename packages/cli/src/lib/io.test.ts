import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { defaultSailDir } from "@sail/sdk/accounts";
import { sandboxDirFor } from "@sail/sandbox";
import { resolveSailDir } from "./io.js";

// Run with: npx tsx --test packages/cli/src/lib/io.test.ts
//
// SAIL_DIR is the mechanism that keeps a sandbox session from touching real
// state: it repoints every CLI state read and write (account, mandate, keys,
// .env.local, the signing daemon's runtime descriptor) at an alternate root.
// These tests pin its resolution rules so a refactor cannot quietly move where
// state lands.
//
// Resolution order, as the code actually behaves:
//   1. SAIL_DIR, when set to a NON-EMPTY string, always wins. It is resolved
//      against a base directory: absolute values are taken verbatim, relative
//      ones are resolved against that base.
//   2. Otherwise: <base>/.sail
// The function argument is NOT a competing override — it is that base.
//
// One caller inverts this: SigningServer's `opts.sailDir`
// (packages/cli/src/signing/server.ts:152) DOES outrank SAIL_DIR, because it
// resolves `opts.sailDir` when present and only falls back to resolveSailDir
// otherwise. That precedence is not asserted here — the resulting path is a
// private field, and reaching into it would pin an implementation detail
// rather than a behaviour.

/** Run `fn` with SAIL_DIR set to `value` (or unset), always restoring after. */
function withSailDir<T>(value: string | undefined, fn: () => T): T {
  const saved = process.env["SAIL_DIR"];
  if (value === undefined) delete process.env["SAIL_DIR"];
  else process.env["SAIL_DIR"] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env["SAIL_DIR"];
    else process.env["SAIL_DIR"] = saved;
  }
}

/** A real temp directory, so nothing here can touch the developer's home. */
function tempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "sail-saildir-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("withSailDir restores the environment, including when it was unset", () => {
  // Guards every other case in this file against leaking state.
  const before = process.env["SAIL_DIR"];
  withSailDir("/tmp/whatever", () => {
    assert.equal(process.env["SAIL_DIR"], "/tmp/whatever");
  });
  assert.equal(process.env["SAIL_DIR"], before);
  withSailDir(undefined, () => {
    assert.equal(process.env["SAIL_DIR"], undefined);
  });
  assert.equal(process.env["SAIL_DIR"], before);
});

test("default: no SAIL_DIR resolves to <projectRoot>/.sail", () => {
  const { root, cleanup } = tempRoot();
  try {
    withSailDir(undefined, () => {
      assert.equal(resolveSailDir(root), path.join(root, ".sail"));
    });
  } finally {
    cleanup();
  }
});

test("an absolute SAIL_DIR is honoured verbatim and ignores the project root", () => {
  const { root, cleanup } = tempRoot();
  const elsewhere = mkdtempSync(path.join(tmpdir(), "sail-elsewhere-"));
  try {
    withSailDir(elsewhere, () => {
      assert.equal(resolveSailDir(root), elsewhere);
    });
  } finally {
    cleanup();
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("a relative SAIL_DIR resolves against the project root, not the cwd", () => {
  const { root, cleanup } = tempRoot();
  try {
    withSailDir(path.join(".shipyard", "sandbox"), () => {
      assert.equal(resolveSailDir(root), path.join(root, ".shipyard", "sandbox"));
      assert.notEqual(resolveSailDir(root), path.join(process.cwd(), ".shipyard", "sandbox"));
    });
  } finally {
    cleanup();
  }
});

test("relative SAIL_DIR forms normalise to the same directory", () => {
  const { root, cleanup } = tempRoot();
  const expected = path.join(root, ".shipyard", "sandbox");
  try {
    for (const form of [".shipyard/sandbox", "./.shipyard/sandbox", ".shipyard/sandbox/"]) {
      withSailDir(form, () => {
        assert.equal(resolveSailDir(root), expected, `form ${JSON.stringify(form)}`);
      });
    }
  } finally {
    cleanup();
  }
});

test("an empty SAIL_DIR falls back to .sail — never the filesystem root or the cwd", () => {
  const { root, cleanup } = tempRoot();
  try {
    withSailDir("", () => {
      const resolved = resolveSailDir(root);
      assert.equal(resolved, path.join(root, ".sail"));
      assert.notEqual(resolved, path.parse(resolved).root);
      assert.notEqual(resolved, process.cwd());
    });
  } finally {
    cleanup();
  }
});

test("a whitespace-only SAIL_DIR is not trimmed, but still cannot reach the root or the cwd", () => {
  // Documents real current behaviour rather than the ideal: " " is truthy, so
  // it is treated as a directory name and resolves to "<root>/ ". That is odd,
  // but it stays inside the project and cannot clobber the live root — which is
  // the property that actually matters here. If SAIL_DIR is ever trimmed, this
  // test should be updated deliberately, not deleted.
  const { root, cleanup } = tempRoot();
  try {
    for (const blank of [" ", "\t", "  "]) {
      withSailDir(blank, () => {
        const resolved = resolveSailDir(root);
        assert.equal(resolved, path.join(root, blank));
        assert.notEqual(resolved, path.parse(resolved).root);
        assert.notEqual(resolved, process.cwd());
        assert.notEqual(resolved, root);
      });
    }
  } finally {
    cleanup();
  }
});

test("the argument is the base, not a competing override: SAIL_DIR still wins", () => {
  // Passing a project root does NOT opt out of the environment override — the
  // only thing the argument decides is what a relative SAIL_DIR hangs off.
  const { root, cleanup } = tempRoot();
  const elsewhere = mkdtempSync(path.join(tmpdir(), "sail-elsewhere-"));
  try {
    withSailDir(elsewhere, () => {
      assert.equal(resolveSailDir(root), elsewhere);
      assert.notEqual(resolveSailDir(root), path.join(root, ".sail"));
    });
  } finally {
    cleanup();
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("SAIL_DIR may point outside the project entirely", () => {
  // Not a sandbox escape to defend against — absolute paths are supported by
  // design — but pinned so the traversal behaviour is a decision, not a
  // surprise.
  const { root, cleanup } = tempRoot();
  try {
    withSailDir(path.join("..", "elsewhere"), () => {
      assert.equal(resolveSailDir(root), path.join(path.dirname(root), "elsewhere"));
    });
  } finally {
    cleanup();
  }
});

// ── The isolation guarantee ─────────────────────────────────────────────────

test("ISOLATION: sandbox and live state roots are different directories, and neither contains the other", () => {
  // This is the whole promise of sandbox mode: "sandbox writes here, live
  // writes there, never the same place." If this test ever fails, a sandbox
  // session can read or clobber real funds-bearing state — treat it as a
  // release blocker, not a broken test.
  const { root, cleanup } = tempRoot();
  try {
    const live = withSailDir(undefined, () => resolveSailDir(root));
    const sandbox = sandboxDirFor(root);

    assert.notEqual(sandbox, live, "sandbox and live resolved to the SAME directory");

    const within = (parent: string, child: string): boolean => {
      const rel = path.relative(parent, child);
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    };
    assert.equal(within(live, sandbox), false, "sandbox root is nested inside the live root");
    assert.equal(within(sandbox, live), false, "live root is nested inside the sandbox root");
  } finally {
    cleanup();
  }
});

test("ISOLATION: pointing SAIL_DIR at the sandbox reproduces sandboxDirFor exactly", () => {
  // How `sailor sandbox start` actually wires it: the CLI exports
  // SAIL_DIR=<sandboxDirFor(root)> to the server it spawns. Both halves must
  // agree on the resulting path, or signing lands in one root and the agent
  // reads the other.
  const { root, cleanup } = tempRoot();
  try {
    const sandbox = sandboxDirFor(root);
    withSailDir(sandbox, () => {
      assert.equal(resolveSailDir(root), sandbox);
    });
    withSailDir(path.join(".shipyard", "sandbox"), () => {
      assert.equal(resolveSailDir(root), sandbox);
    });
  } finally {
    cleanup();
  }
});

// ── CLI and SDK must not disagree ───────────────────────────────────────────

test("AGREEMENT: resolveSailDir and the SDK's defaultSailDir match for the cwd", () => {
  // A disagreement between these two is exactly how state ends up split across
  // two directories: the CLI writes account.json to one, the SDK reads it from
  // the other. Every production call site resolves against process.cwd(), so
  // that is the case pinned here.
  const cases = [undefined, "", ".shipyard/sandbox", "./.shipyard/sandbox", path.join(tmpdir(), "abs-root")];
  for (const value of cases) {
    withSailDir(value, () => {
      assert.equal(
        resolveSailDir(),
        defaultSailDir(),
        `CLI and SDK disagreed for SAIL_DIR=${JSON.stringify(value)}`,
      );
    });
  }
});

test("AGREEMENT: the two diverge only when the project root is not the cwd and SAIL_DIR is relative", () => {
  // Documents a real latent trap. resolveSailDir resolves a relative SAIL_DIR
  // against its projectRoot argument; defaultSailDir always uses process.cwd()
  // and takes no argument. Today every caller passes process.cwd(), so they
  // agree — but SigningServer accepts an arbitrary projectRoot, so the moment
  // one is passed with a relative SAIL_DIR, the CLI and SDK resolve to
  // different directories. Pinned so the divergence is visible rather than
  // discovered in production.
  const { root, cleanup } = tempRoot();
  try {
    withSailDir(path.join(".shipyard", "sandbox"), () => {
      assert.notEqual(root, process.cwd());
      assert.notEqual(
        resolveSailDir(root),
        defaultSailDir(),
        "expected divergence; if this now passes, the two were unified — update this test",
      );
    });
    // An absolute SAIL_DIR is immune: the base is ignored by both.
    const abs = path.join(tmpdir(), "sail-abs-root");
    withSailDir(abs, () => {
      assert.equal(resolveSailDir(root), defaultSailDir());
    });
  } finally {
    cleanup();
  }
});
