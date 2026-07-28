import fs from "node:fs";
import path from "node:path";
import { chainBySlug, getChain } from "@sail/sdk/chains";
import { readActiveAccount } from "@sail/sdk/accounts";
import {
  addStep,
  createStrategyExecutable,
  createStrategy,
  deleteStrategy,
  deployedChainsForSma,
  isValidExecutableName,
  listStrategies,
  readChainEnv,
  removeStep,
  setPipelineType,
  setStrategyActive,
  setStrategyDescription,
} from "@sail/sdk/strategies";
import { checksum, sailPath } from "../lib/io.js";

/** Resolve a chain argument that is either a numeric id or a slug → chainId, or throw. */
function resolveChainId(arg: string): number {
  const n = Number(arg);
  if (Number.isFinite(n) && n > 0) {
    getChain(n); // throws with a helpful list if unknown
    return n;
  }
  const cfg = chainBySlug(arg);
  if (!cfg) throw new Error(`Unknown chain "${arg}". Use a chain id (e.g. 8453) or slug (e.g. base).`);
  return cfg.chainId;
}

/** `sailor strategy list [--json]` */
export async function strategyList(opts: { json?: boolean }): Promise<void> {
  const strategies = listStrategies();
  if (opts.json) {
    console.log(JSON.stringify(strategies, null, 2));
    return;
  }
  if (strategies.length === 0) {
    console.log("No strategies configured. Create one with `sailor strategy create <name>`.");
    return;
  }
  for (const s of strategies) {
    console.log(`${s.active ? "●" : "○"} ${s.name}  (${s.pipeline.type})`);
    if (s.pipeline.steps.length === 0) {
      console.log("    (no steps — add one with `sailor strategy add-step`)");
    }
    s.pipeline.steps.forEach((st, i) => {
      console.log(`    ${i}. ${st.executable} → ${checksum(st.sma)}  chains [${st.chains.join(", ")}]`);
    });
  }
}

/** `sailor strategy create <name> [--description <text>]` */
export async function strategyCreate(name: string, opts: { description?: string } = {}): Promise<void> {
  const s = createStrategy(name);
  if (opts.description?.trim()) setStrategyDescription(s.name, opts.description);
  console.log(`Created strategy "${s.name}" (inactive). Add steps, then \`sailor strategy activate ${s.name}\`.`);
}

/** `sailor strategy activate|deactivate <name>` */
export async function strategySetActive(name: string, active: boolean): Promise<void> {
  const s = setStrategyActive(name, active);
  if (!s) throw new Error(`No strategy named "${name}".`);
  console.log(`Strategy "${s.name}" is now ${s.active ? "active" : "inactive"}.`);
}

/** `sailor strategy add-step <strategy> --executable <n> [--sma <addr>] --chains <ids> [--pipeline <type>]` */
export async function strategyAddStep(
  name: string,
  opts: { executable?: string; sma?: string; chains?: string; pipeline?: string },
): Promise<void> {
  const executable = opts.executable;
  if (!executable) throw new Error("Missing --executable <name>.");
  if (!isValidExecutableName(executable)) {
    throw new Error(`Invalid executable name "${executable}" — use camelCase (e.g. agent, checkData).`);
  }
  const sma = opts.sma ? checksum(opts.sma) : readActiveAccount()?.safe;
  if (!sma) throw new Error("No SMA given and no executable account found. Pass --sma <address>.");

  const chains = (opts.chains ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map(resolveChainId);
  const finalChains = chains.length > 0 ? chains : deployedChainsForSma(sma).slice(0, 1);

  if (opts.pipeline) {
    if (opts.pipeline !== "parallel" && opts.pipeline !== "sequential") {
      throw new Error(`--pipeline must be "parallel" or "sequential" (got "${opts.pipeline}").`);
    }
    setPipelineType(name, opts.pipeline);
  }

  const s = addStep(name, { executable, sma, chains: finalChains });
  const step = s.pipeline.steps[s.pipeline.steps.length - 1];
  console.log(`Added step to "${s.name}": ${step.executable} → ${step.sma} chains [${step.chains.join(", ")}].`);
}

/** `sailor strategy remove-step <strategy> <index>` */
export async function strategyRemoveStep(name: string, indexArg: string): Promise<void> {
  const index = Number(indexArg);
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid step index "${indexArg}".`);
  const s = removeStep(name, index);
  if (!s) throw new Error(`No strategy named "${name}".`);
  console.log(`Removed step ${index} from "${s.name}".`);
}

/** `sailor strategy delete <name>` */
export async function strategyDelete(name: string): Promise<void> {
  if (!deleteStrategy(name)) throw new Error(`No strategy named "${name}".`);
  console.log(`Deleted strategy "${name}".`);
}

/** `sailor strategy new-executable <name>` — scaffold src/strategy/<name>.ts from a template. */
export async function strategyNewExecutable(name: string): Promise<void> {
  createStrategyExecutable(name);
  console.log(`Created src/strategy/${name}.ts. Configure it, then add it to a strategy with \`sailor strategy add-step\`.`);
}

/** `sailor strategy env show <chain>` */
export async function strategyEnvShow(chainArg: string): Promise<void> {
  const chainId = resolveChainId(chainArg);
  const env = readChainEnv(chainId);
  const slug = getChain(chainId).slug;
  const keys = Object.keys(env);
  if (keys.length === 0) {
    console.log(`No env values for ${slug} (${chainId}). Set one with \`sailor strategy env set ${slug} KEY=VALUE\`.`);
    return;
  }
  console.log(`.sail/env/${slug}.json:`);
  for (const k of keys) console.log(`  ${k}=${env[k]}`);
}

/** `sailor strategy env set <chain> KEY=VALUE [KEY=VALUE ...]` */
export async function strategyEnvSet(chainArg: string, assignments: string[]): Promise<void> {
  if (!assignments || assignments.length === 0) throw new Error("Provide at least one KEY=VALUE.");
  const chainId = resolveChainId(chainArg);
  const slug = getChain(chainId).slug;
  const file = sailPath("env", `${slug}.json`);
  const current = readChainEnv(chainId);
  for (const a of assignments) {
    const eq = a.indexOf("=");
    if (eq <= 0) throw new Error(`Invalid assignment "${a}" — expected KEY=VALUE.`);
    current[a.slice(0, eq).trim()] = a.slice(eq + 1);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Updated .sail/env/${slug}.json (${Object.keys(current).length} keys).`);
}
