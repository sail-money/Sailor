import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { type BlueprintStartDependencies, blueprintStart } from "./blueprint-start.js";
import type { BlueprintImportOptions } from "./blueprint.js";

async function inTempCwd(fn: (root: string, artifact: string) => Promise<void>): Promise<void> {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-blueprint-start-"));
  const artifact = path.join(root, "portable-blueprint.tar.gz");
  fs.writeFileSync(artifact, "fixture");
  process.chdir(root);
  try {
    await fn(root, artifact);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function dependencies(events: string[]): BlueprintStartDependencies {
  return {
    hasExecutable: () => true,
    scaffold: (dest, name) => {
      fs.mkdirSync(path.join(dest, ".sail"), { recursive: true });
      events.push(`scaffold:${name}`);
    },
    importBlueprint: async (artifact, project, opts: BlueprintImportOptions) => {
      assert.equal(path.isAbsolute(artifact), true);
      assert.equal(fs.existsSync(path.join(project ?? "", ".sail")), true);
      assert.equal(opts.yes, true);
      events.push(`import:${path.basename(project ?? "")}`);
      return true;
    },
    run: (command, args) => {
      events.push(`${command}:${args.join(" ")}`);
    },
  };
}

test(
  "start owns the whole artifact-to-guided-onboarding sequence",
  { concurrency: false },
  async () => {
    await inTempCwd(async (_root, artifact) => {
      const events: string[] = [];
      await blueprintStart(artifact, "new-dca", { chain: "130", yes: true }, dependencies(events));
      assert.deepEqual(events.slice(0, 3), ["scaffold:new-dca", "import:new-dca", "npm:install"]);
      // No tsconfig.json in the scaffolded project → the typecheck step is skipped, never
      // delegated to an `npm run` script the blueprint controls.
      assert.match(events[3], /^codex:Start this imported blueprint/);
      assert.match(events[3], /guided onboarding now/);
      assert.ok(!events.some((e) => e.includes("typecheck")));
    });
  },
);

test("--agent selects another coding-agent executable", { concurrency: false }, async () => {
  await inTempCwd(async (_root, artifact) => {
    const events: string[] = [];
    await blueprintStart(
      artifact,
      "claude-project",
      { yes: true, agent: "claude" },
      dependencies(events),
    );
    assert.match(events.at(-1) ?? "", /^claude:Start this imported blueprint/);
  });
});

test("--no-agent stops after install/typecheck", { concurrency: false }, async () => {
  await inTempCwd(async (_root, artifact) => {
    const events: string[] = [];
    await blueprintStart(
      artifact,
      "prepared-only",
      { yes: true, agent: false },
      dependencies(events),
    );
    assert.deepEqual(events, ["scaffold:prepared-only", "import:prepared-only", "npm:install"]);
  });
});

test(
  "typecheck runs the project's own tsc binary directly, never an npm script",
  { concurrency: false },
  async () => {
    await inTempCwd(async (_root, artifact) => {
      const events: string[] = [];
      const deps = dependencies(events);
      // blueprintStart resolves against process.cwd() (a realpath; macOS maps /var → /private/var).
      const project = path.join(process.cwd(), "typed");
      await blueprintStart(
        artifact,
        "typed",
        { yes: true, agent: false },
        {
          ...deps,
          importBlueprint: async (...args) => {
            // The blueprint's payload lands tsconfig.json; `npm install` (mocked) would land tsc.
            fs.writeFileSync(path.join(project, "tsconfig.json"), "{}");
            fs.mkdirSync(path.join(project, "node_modules", ".bin"), { recursive: true });
            fs.writeFileSync(path.join(project, "node_modules", ".bin", "tsc"), "#!/bin/sh\n");
            return deps.importBlueprint?.(...args) ?? true;
          },
        },
      );
      const tsc = path.join(project, "node_modules", ".bin", "tsc");
      assert.deepEqual(events, [
        "scaffold:typed",
        "import:typed",
        "npm:install",
        `${tsc}:--noEmit -p tsconfig.json`,
      ]);
      assert.ok(!events.some((e) => e.startsWith("npm:run")), "must not run a package.json script");
    });
  },
);

test("start refuses an existing target before scaffolding", { concurrency: false }, async () => {
  await inTempCwd(async (_root, artifact) => {
    fs.mkdirSync("already-here");
    let touched = false;
    await assert.rejects(
      blueprintStart(
        artifact,
        "already-here",
        { yes: true },
        {
          hasExecutable: () => true,
          scaffold: () => {
            touched = true;
          },
        },
      ),
      /Refusing to overwrite existing project/,
    );
    assert.equal(touched, false);
  });
});

test(
  "a declined import retains the scaffold and never installs",
  { concurrency: false },
  async () => {
    await inTempCwd(async (_root, artifact) => {
      let ran = false;
      await assert.rejects(
        blueprintStart(
          artifact,
          "declined",
          {},
          {
            hasExecutable: () => true,
            scaffold: (dest) => {
              fs.mkdirSync(path.join(dest, ".sail"), { recursive: true });
            },
            importBlueprint: async () => false,
            run: () => {
              ran = true;
            },
          },
        ),
        /blueprint was not imported[\s\S]*retained for inspection/,
      );
      assert.equal(ran, false);
      assert.equal(fs.existsSync(path.join("declined", ".sail")), true);
    });
  },
);

test('start scaffolds in-place when dir is "."', { concurrency: false }, async () => {
  const previous = process.cwd();
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-bs-inplace-"));
  const artifact = path.join(outer, "portable-blueprint.tar.gz");
  fs.writeFileSync(artifact, "fixture");
  const project = path.join(outer, "empty-project");
  fs.mkdirSync(project);
  process.chdir(project);
  try {
    const events: string[] = [];
    await blueprintStart(artifact, ".", { yes: true }, dependencies(events));
    assert.deepEqual(events.slice(0, 3), [
      "scaffold:empty-project",
      "import:empty-project",
      "npm:install",
    ]);
  } finally {
    process.chdir(previous);
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test("start refuses in-place when the directory is not empty", { concurrency: false }, async () => {
  const previous = process.cwd();
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-bs-inplace-full-"));
  const artifact = path.join(outer, "portable-blueprint.tar.gz");
  fs.writeFileSync(artifact, "fixture");
  const project = path.join(outer, "full-project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "existing.txt"), "x");
  process.chdir(project);
  try {
    await assert.rejects(
      blueprintStart(artifact, ".", { yes: true }, dependencies([])),
      /not empty/,
    );
  } finally {
    process.chdir(previous);
    fs.rmSync(outer, { recursive: true, force: true });
  }
});
