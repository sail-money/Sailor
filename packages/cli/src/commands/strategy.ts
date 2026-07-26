import fs from "node:fs";
import path from "node:path";
import { chainBySlug, getChain } from "@sail/sdk/chains";
import { readExecutableAccount } from "@sail/sdk/accounts";
import {
  addStep,
  createStrategy,
  deleteStrategy,
  deployedChainsForSma,
  isValidExecutableName,
  listStrategies,
  readChainEnv,
  removeStep,
  setPipelineType,
  setStrategyActive,
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

/** `sailor strategy create <name>` */
export async function strategyCreate(name: string): Promise<void> {
  const s = createStrategy(name);
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
  const sma = opts.sma ? checksum(opts.sma) : readExecutableAccount()?.safe;
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
  if (!isValidExecutableName(name)) {
    throw new Error(`Invalid executable name "${name}" — use camelCase letters/digits (e.g. checkData).`);
  }
  const dir = path.join(process.cwd(), "src", "strategy");
  const file = path.join(dir, `${name}.ts`);
  if (fs.existsSync(file)) throw new Error(`Executable "${name}" already exists at src/strategy/${name}.ts.`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, executableTemplate(name));
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

function executableTemplate(name: string): string {
  return `import type { Agent, AgentContext, Dispatch } from "@sail.money/sailor/sdk";

/**
 * Executable "${name}" — one runnable step in a strategy pipeline.
 *
 * The runner calls tick() each interval for every (SMA, chain) this executable is bound to.
 * Return an array of Dispatch intents; return [] to skip. Per-chain env values configured in
 * .sail/env/<chain>.json are available on ctx.env (e.g. ctx.env.MORPHO_TOKEN_ADDR).
 */
export const agent: Agent = {
  name: "${name}",
  description: "Describe what ${name} does.",

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    ctx.log(\`${name} tick — chain \${ctx.chainId}, sma \${ctx.safe}\`);

    // TODO: implement. Read on-chain state, decide, return intent dispatches.
    // const token = ctx.env.MORPHO_TOKEN_ADDR;
    // const balance = await ctx.read.balance(token as \`0x\${string}\`);

    return [];
  },
};
`;
}
