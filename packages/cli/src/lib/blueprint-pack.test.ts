import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyArtifact } from "@sail/sdk/blueprint";
import { packBlueprint, writeBlueprintArchive } from "./blueprint-pack.js";

const SMA = `0x${"ab".repeat(20)}`;

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bp-pack-"));
  for (const d of [
    [".sail", "keys"],
    ["src"],
    [".agents", "skills", "sailor-strategy"],
    ["contracts", "mandates"],
    ["node_modules", "x"],
    [".git"],
  ]) {
    fs.mkdirSync(path.join(root, ...d), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, ".sail", "account.json"),
    JSON.stringify({ safe: SMA, owner: SMA, manager: SMA }),
  );
  fs.writeFileSync(path.join(root, ".sail", "keys", "manager.json"), "secret");
  fs.writeFileSync(
    path.join(root, ".sail", ".env.local"),
    "RPC_URL=https://my-private-rpc.example\n",
  );
  fs.writeFileSync(path.join(root, ".env.example"), "RPC_URL=https://your-rpc-endpoint\n");
  fs.writeFileSync(path.join(root, "src", "agent.ts"), `// trades against ${SMA}\n`);
  fs.writeFileSync(path.join(root, "src", "mandate.ts"), "export const x = 1;\n");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# guide\n");
  fs.writeFileSync(
    path.join(root, ".agents", "skills", "sailor-strategy", "SKILL.md"),
    "# strategy\n",
  );
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"test"}\n');
  fs.writeFileSync(
    path.join(root, "contracts", "mandates", "BoundedCallPermission.sol"),
    "contract C {}\n",
  );
  fs.writeFileSync(path.join(root, "node_modules", "x", "y.js"), "bad");
  fs.writeFileSync(path.join(root, ".git", "config"), "bad");
  return root;
}

test("packBlueprint selects the agent surface and excludes the skeleton", async () => {
  const root = makeProject();
  const packed = await packBlueprint(root, { slug: "dca", version: "1.0.0", kind: "crystallized" });
  assert.deepEqual([...packed.files.keys()].sort(), [
    ".agents/skills/sailor-strategy/SKILL.md",
    "AGENTS.md",
    "contracts/mandates/BoundedCallPermission.sol",
    "package.json",
    "src/agent.ts",
    "src/mandate.ts",
  ]);
});

test("packBlueprint assigns roles", async () => {
  const root = makeProject();
  const packed = await packBlueprint(root, { slug: "dca", version: "1.0.0", kind: "crystallized" });
  const byPath = new Map(packed.manifest.contents.map((c) => [c.path, c.role]));
  assert.equal(byPath.get("src/agent.ts"), "agent-surface");
  assert.equal(byPath.get("contracts/mandates/BoundedCallPermission.sol"), "contract");
  assert.equal(byPath.get("package.json"), "config");
});

test("packBlueprint excludes archive files (no self-nesting)", async () => {
  const root = makeProject();
  // `publish --local` drops its own .tar.gz into the project; without an explicit
  // exclusion it would nest into the next publish's payload.
  fs.writeFileSync(path.join(root, "index-blueprint.tar.gz"), "stale-archive");
  fs.writeFileSync(path.join(root, "index.zip"), "stale-zip");
  fs.writeFileSync(path.join(root, "index.tgz"), "stale-tgz");
  const packed = await packBlueprint(root, { slug: "dca", version: "1.0.0", kind: "crystallized" });
  for (const p of packed.files.keys()) {
    assert.doesNotMatch(p, /\.(tar\.gz|tgz|zip)$/);
  }
});

test("packBlueprint redacts the operator's addresses", async () => {
  const root = makeProject();
  const packed = await packBlueprint(root, { slug: "dca", version: "1.0.0", kind: "crystallized" });
  const agentTs = new TextDecoder().decode(packed.files.get("src/agent.ts"));
  assert.doesNotMatch(agentTs, new RegExp(SMA, "i"));
  assert.match(agentTs, /0x0{40}/);
});

test("packBlueprint refuses a residual secret", async () => {
  const root = makeProject();
  // Bare (no 0x) 64-hex key on a key-ish name: autoRedact only neutralizes 0x-prefixed
  // hex, so this survives redaction and must be caught by the secret scan.
  fs.writeFileSync(path.join(root, "src", "leak.ts"), `const secretKey = "${"cd".repeat(32)}";\n`);
  await assert.rejects(
    packBlueprint(root, { slug: "dca", version: "1.0.0", kind: "crystallized" }),
    /possible secrets remain/,
  );
});

test("writeBlueprintArchive round-trips through verifyArtifact", async () => {
  const root = makeProject();
  const packed = await packBlueprint(root, { slug: "dca", version: "1.0.0", kind: "crystallized" });
  const archive = writeBlueprintArchive(packed);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-roundtrip-"));
  execFileSync("tar", ["-xzf", archive, "-C", dir]);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "blueprint.manifest.json"), "utf-8"));
  const listPayload = (): string[] => {
    const out: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const a = path.join(d, e.name);
        if (e.isDirectory()) walk(a);
        else out.push(path.relative(path.join(dir, "payload"), a).split(path.sep).join("/"));
      }
    };
    walk(path.join(dir, "payload"));
    return out;
  };
  const result = await verifyArtifact(manifest, {
    read: async (p) => {
      const abs = path.join(dir, "payload", p);
      return fs.existsSync(abs) ? new Uint8Array(fs.readFileSync(abs)) : null;
    },
    list: async () => listPayload(),
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
});
