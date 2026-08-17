import fs from "node:fs";
import path from "node:path";
import { chainBySlug, getChain } from "@sail/sdk/chains";
import {
  DEFAULT_EXECUTABLE,
  createStrategy,
  createStrategyExecutable,
  deleteStrategy,
  isValidExecutableName,
  listStrategies,
  readChainEnv,
  setStrategyActive,
  setStrategyChains,
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

/** Parse a comma-separated chains arg (ids or slugs) → chainIds. Empty when arg omitted/blank. */
export function parseChains(arg?: string): number[] {
  return (arg ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map(resolveChainId);
}

/** One-line mode label for a strategy. */
function modeLabel(chains?: number[]): string {
  return chains && chains.length > 0 ? `per-chain [${chains.join(", ")}]` : "cross-chain (executable-driven)";
}

/** `sailor strategy list [--json]` */
export async function strategyList(opts: { json?: boolean }): Promise<void> {
  const strategies = listStrategies();
  if (opts.json) {
    console.log(JSON.stringify(strategies, null, 2));
    return;
  }
  if (strategies.length === 0) {
    console.log("No strategies configured. Create one with `sailor strategy create <name> --sma <addr>` (the `agent` executable is the default).");
    return;
  }
  for (const s of strategies) {
    console.log(`${s.active ? "●" : "○"} ${s.name}  ${s.executable} → ${checksum(s.sma)}  (${modeLabel(s.chains)})`);
    if (s.description) console.log(`    ${s.description}`);
  }
}

/**
 * `sailor strategy create <name> --sma <addr> [--executable <name>] [--chains <ids>] [--description <text>]`
 * With `--chains` the executable is replayed once per chain; without it the strategy runs once and the
 * executable drives chains via `ctx.chain(id)`. `--executable` defaults to `agent`.
 */
export async function strategyCreate(
  name: string,
  opts: { sma?: string; executable?: string; chains?: string; description?: string; inactive?: boolean } = {},
): Promise<void> {
  if (!opts.sma) throw new Error("Missing --sma <address>.");
  const executable = opts.executable ?? DEFAULT_EXECUTABLE;
  if (!isValidExecutableName(executable)) {
    throw new Error(`Invalid executable name "${executable}" — use camelCase (e.g. agent, checkData).`);
  }
  const chains = parseChains(opts.chains);
  const s = createStrategy(name, {
    sma: checksum(opts.sma),
    executable,
    active: !opts.inactive,
    ...(chains.length > 0 ? { chains } : {}),
  });
  if (opts.description?.trim()) setStrategyDescription(s.name, opts.description);
  console.log(
    `Created strategy "${s.name}" (${s.active ? "active" : "inactive"}): ${s.executable} → ${checksum(s.sma)} (${modeLabel(s.chains)}).` +
      (s.active
        ? ` Deactivate with \`sailor strategy deactivate ${s.name}\`.`
        : ` Activate with \`sailor strategy activate ${s.name}\`.`),
  );
}

/** `sailor strategy activate|deactivate <name>` */
export async function strategySetActive(name: string, active: boolean): Promise<void> {
  const s = setStrategyActive(name, active);
  if (!s) throw new Error(`No strategy named "${name}".`);
  console.log(`Strategy "${s.name}" is now ${s.active ? "active" : "inactive"}.`);
}

/**
 * `sailor strategy set-chains <name> [--chains <ids> | --clear]`
 * Set the replay chain set, or `--clear` it to switch the strategy to executable-driven (cross-chain).
 */
export async function strategySetChains(name: string, opts: { chains?: string; clear?: boolean }): Promise<void> {
  if (opts.clear) {
    const s = setStrategyChains(name, null);
    if (!s) throw new Error(`No strategy named "${name}".`);
    console.log(`Strategy "${s.name}" now runs ${modeLabel(s.chains)}.`);
    return;
  }
  const chains = parseChains(opts.chains);
  if (chains.length === 0) throw new Error("Provide --chains <ids> or --clear (for executable-driven mode).");
  const s = setStrategyChains(name, chains);
  if (!s) throw new Error(`No strategy named "${name}".`);
  console.log(`Strategy "${s.name}" now runs ${modeLabel(s.chains)}.`);
}

/** `sailor strategy delete <name>` */
export async function strategyDelete(name: string): Promise<void> {
  if (!deleteStrategy(name)) throw new Error(`No strategy named "${name}".`);
  console.log(`Deleted strategy "${name}".`);
}

/** `sailor strategy new-executable <name>` — scaffold src/strategy/<name>.ts from a template. */
export async function strategyNewExecutable(name: string): Promise<void> {
  createStrategyExecutable(name);
  console.log(
    `Created src/strategy/${name}.ts. Configure it, then wire it up with ` +
      `\`sailor strategy create <name> --sma <addr> --executable ${name}\`.`,
  );
}

/** `sailor strategy env show <chain> [--json]` */
export async function strategyEnvShow(chainArg: string, opts: { json?: boolean } = {}): Promise<void> {
  const chainId = resolveChainId(chainArg);
  const env = readChainEnv(chainId);
  const slug = getChain(chainId).slug;
  if (opts.json) {
    console.log(JSON.stringify({ chainId, slug, env }, null, 2));
    return;
  }
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
