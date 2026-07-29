import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { blueprintImport } from "./blueprint.js";
import { initCommand } from "./init.js";

export interface BlueprintStartOptions {
  chain?: string;
  yes?: boolean;
  /** Executable selected by `--agent`; Commander maps `--no-agent` to `false`. */
  agent?: string | false;
}

type InitFn = typeof initCommand;
type ImportFn = typeof blueprintImport;
type RunFn = (command: string, args: string[], cwd: string, label: string) => void;

export interface BlueprintStartDependencies {
  init?: InitFn;
  importBlueprint?: ImportFn;
  run?: RunFn;
  hasExecutable?: (name: string) => boolean;
}

function commandForDisplay(command: string, args: string[]): string {
  const quote = (value: string): string =>
    /^[A-Za-z0-9_./:@=,+-]+$/.test(value) ? value : JSON.stringify(value);
  return [command, ...args].map(quote).join(" ");
}

function executableOnPath(name: string): boolean {
  if (path.isAbsolute(name)) return fs.existsSync(name);
  return (process.env["PATH"] ?? "")
    .split(path.delimiter)
    .some((dir) => dir.length > 0 && fs.existsSync(path.join(dir, name)));
}

function runExternal(command: string, args: string[], cwd: string, label: string): void {
  console.log(`\n[${label}]`);
  console.log(`  ${commandForDisplay(command, args)}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
}

function onboardingPrompt(chain?: string): string {
  const chainInstruction = chain
    ? `The bootstrap pinned chain ${chain}; treat it as confirmed unless the owner explicitly changes it.`
    : "The chain is not pinned; include environment and chain in the first compact intake question.";
  return [
    "Start this imported blueprint's guided onboarding now.",
    "Read AGENTS.md and the blueprint-specific skill it routes to before acting.",
    "Collect and confirm every missing mandate parameter before starting any UI.",
    chainInstruction,
    "Then start the matching native Sandbox or live Sailor UI, give me its URL, and pause for my owner-controlled account setup.",
    "After the account is ready, continue through the generated mandate plan, explaining every signature and requiring zero simulation mismatches.",
  ].join(" ");
}

/**
 * Consumer-side blueprint bootstrap.
 *
 * This deliberately knows nothing about how or where an artifact was produced. Its only inputs
 * are a local artifact and a new project directory. Discovery/download/signing belong to the
 * registry and trust-policy layers; this command owns the local scaffold-to-onboarding path.
 */
export async function blueprintStart(
  source: string,
  dir: string,
  opts: BlueprintStartOptions,
  dependencies: BlueprintStartDependencies = {},
): Promise<void> {
  const artifact = path.resolve(source);
  if (!fs.existsSync(artifact)) throw new Error(`No such artifact: ${source}`);

  if (!dir || dir === ".") {
    throw new Error("blueprint start requires a new project directory, not the current directory");
  }
  const projectRoot = path.resolve(process.cwd(), dir);
  const cwd = path.resolve(process.cwd());
  if (projectRoot === cwd || !projectRoot.startsWith(cwd + path.sep)) {
    throw new Error("Project directory must be inside the current working directory");
  }
  if (fs.existsSync(projectRoot)) {
    throw new Error(`Refusing to overwrite existing project: ${projectRoot}`);
  }

  const init = dependencies.init ?? initCommand;
  const importBlueprint = dependencies.importBlueprint ?? blueprintImport;
  const run = dependencies.run ?? runExternal;
  const hasExecutable = dependencies.hasExecutable ?? executableOnPath;

  if (!hasExecutable("npm")) throw new Error("npm is not available on PATH");
  const agentExecutable = typeof opts.agent === "string" ? opts.agent : "codex";
  if (opts.agent !== false && !hasExecutable(agentExecutable)) {
    throw new Error(
      `${agentExecutable} is not available on PATH. Re-run with --no-agent, then open the created project in your preferred coding agent.`,
    );
  }

  console.log("Blueprint onboarding bootstrap");
  console.log(`  artifact  ${artifact}`);
  console.log(`  project   ${projectRoot}`);
  console.log(`  chain     ${opts.chain ?? "chosen during blueprint intake"}`);

  try {
    console.log("\n[create Sailor project]");
    await init(dir, { chain: opts.chain });

    console.log("\n[verify and import blueprint]");
    const imported = await importBlueprint(artifact, projectRoot, {
      chain: opts.chain,
      yes: opts.yes,
    });
    if (!imported) {
      throw new Error("blueprint was not imported");
    }

    run("npm", ["install"], projectRoot, "install project dependencies");
    run("npm", ["run", "typecheck", "--if-present"], projectRoot, "pre-onboarding typecheck");

    const prompt = onboardingPrompt(opts.chain);
    if (opts.agent === false) {
      console.log("\n[ready for guided onboarding]");
      console.log(`  Project: ${projectRoot}`);
      console.log("  Open this folder in your coding agent.");
      console.log(`  Prompt: ${prompt}`);
      return;
    }
    run(agentExecutable, [prompt], projectRoot, "start blueprint-specific onboarding");
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
        `The new project was retained for inspection: ${projectRoot}`,
    );
  }
}
