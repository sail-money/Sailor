import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { BlueprintImportOptions } from "./blueprint.js";
import {
  type BlueprintStartDependencies,
  blueprintStart,
} from "./blueprint-start.js";

async function inTempCwd(
  fn: (root: string, artifact: string) => Promise<void>,
): Promise<void> {
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
    init: async (dir) => {
      assert.equal(typeof dir, "string");
      fs.mkdirSync(path.join(process.cwd(), dir as string, ".sail"), { recursive: true });
      events.push(`init:${dir}`);
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

test("start owns the whole artifact-to-guided-onboarding sequence", { concurrency: false }, async () => {
  await inTempCwd(async (_root, artifact) => {
    const events: string[] = [];
    await blueprintStart(artifact, "new-dca", { chain: "130", yes: true }, dependencies(events));
    assert.deepEqual(events.slice(0, 4), [
      "init:new-dca",
      "import:new-dca",
      "npm:install",
      "npm:run typecheck --if-present",
    ]);
    assert.match(events[4], /^codex:Start this imported blueprint/);
    assert.match(events[4], /guided onboarding now/);
  });
});

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
    await blueprintStart(artifact, "prepared-only", { yes: true, agent: false }, dependencies(events));
    assert.deepEqual(events, [
      "init:prepared-only",
      "import:prepared-only",
      "npm:install",
      "npm:run typecheck --if-present",
    ]);
  });
});

test("start refuses an existing target before scaffolding", { concurrency: false }, async () => {
  await inTempCwd(async (_root, artifact) => {
    fs.mkdirSync("already-here");
    let touched = false;
    await assert.rejects(
      blueprintStart(artifact, "already-here", { yes: true }, {
        hasExecutable: () => true,
        init: async () => {
          touched = true;
        },
      }),
      /Refusing to overwrite existing project/,
    );
    assert.equal(touched, false);
  });
});

test("a declined import retains the scaffold and never installs", { concurrency: false }, async () => {
  await inTempCwd(async (_root, artifact) => {
    let ran = false;
    await assert.rejects(
      blueprintStart(artifact, "declined", {}, {
        hasExecutable: () => true,
        init: async (dir) => {
          fs.mkdirSync(path.join(process.cwd(), dir as string, ".sail"), { recursive: true });
        },
        importBlueprint: async () => false,
        run: () => {
          ran = true;
        },
      }),
      /blueprint was not imported[\s\S]*retained for inspection/,
    );
    assert.equal(ran, false);
    assert.equal(fs.existsSync(path.join("declined", ".sail")), true);
  });
});
