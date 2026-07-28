// Single owner of the on-disk strategy state under `.sail/strategies/strategies.json`.
//
// A **strategy** is one execution pipeline the runner drives each tick. Each strategy holds an
// ordered `pipeline` of **steps**; every step binds a named **executable** (a `src/strategy/<name>.ts`
// script) to an SMA and a set of chains. `pipeline.type` decides whether the steps run in
// `sequential` order or in `parallel`. `active` strategies run by default; `sailor run --strategy`
// selects one.
//
// Storage mirrors the accounts.ts convention: a function module keyed off an overridable `sailDir`
// (default `<cwd>/.sail`) so the CLI, the UI server, and the signing daemon all write through one
// place. Names (strategy and executable) are unique — see the validation helpers.

import fs from "node:fs";
import path from "node:path";
import { getAddress } from "viem";
import { getChain } from "./chains.js";
import { defaultSailDir, listAccounts, readActiveAccount, type AccountRecord } from "./accounts.js";

export type PipelineType = "sequential" | "parallel";

/** One executable bound to an SMA + chains within a strategy's pipeline. */
export type StrategyStep = {
  /** Executable name → `src/strategy/<executable>.ts`. Reusable across strategies. */
  executable: string;
  /** SMA (checksummed) this step runs the executable against. */
  sma: string;
  /** Chains to run on — a subset of the SMA's deployed set, at least one. */
  chains: number[];
};

export type Pipeline = {
  type: PipelineType;
  steps: StrategyStep[];
};

export type StoredStrategy = {
  /** Unique, non-empty display name (also the `--strategy` selector). */
  name: string;
  /** Optional human description shown in the dashboard. */
  description?: string;
  /** When true, the strategy runs on every tick of the default `sailor run`. */
  active: boolean;
  pipeline: Pipeline;
};

type StrategiesFile = { version: 1; strategies: StoredStrategy[] };

const strategiesPath = (sailDir: string): string =>
  path.join(sailDir, "strategies", "strategies.json");
const envPath = (sailDir: string, slug: string): string =>
  path.join(sailDir, "env", `${slug}.json`);
const executablePath = (projectRoot: string, name: string): string =>
  path.join(projectRoot, "src", "strategy", `${name}.ts`);

const EXECUTABLE_RE = /^[a-z][a-zA-Z0-9]*$/;
/** Executable names must be camelCase with no separators (e.g. `agent`, `checkData`). */
export function isValidExecutableName(name: string): boolean {
  return EXECUTABLE_RE.test(name);
}

/** Source body for a new `src/strategy/<name>.ts` executable. */
export function renderExecutableTemplate(name: string): string {
  if (!isValidExecutableName(name)) {
    throw new Error(`Invalid executable name "${name}" - use camelCase letters/digits only (e.g. checkData).`);
  }
  return `import type { Agent, AgentContext, Dispatch } from "@sail.money/sailor/sdk";

/**
 * Executable "${name}" - one runnable step in a strategy pipeline.
 *
 * The runner calls tick() each interval for every (SMA, chain) this executable is bound to.
 * Return an array of Dispatch intents; return [] to skip. Per-chain env values configured in
 * .sail/env/<chain>.json are available on ctx.env (e.g. ctx.env.MORPHO_TOKEN_ADDR).
 */
export const agent: Agent = {
  name: "${name}",
  description: "Describe what ${name} does.",

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    ctx.log(\`${name} tick - chain \${ctx.chainId}, sma \${ctx.safe}\`);

    // TODO: implement. Read on-chain state, decide, return intent dispatches.
    // const token = ctx.env.MORPHO_TOKEN_ADDR;
    // const balance = await ctx.read.balance(token as \`0x\${string}\`);

    return [];
  },
};
`;
}

/**
 * Scaffold `src/strategy/<name>.ts` under a project root.
 * Returns the absolute file path written. Throws on invalid names or collisions.
 */
export function createStrategyExecutable(name: string, projectRoot: string = process.cwd()): string {
  if (!isValidExecutableName(name)) {
    throw new Error(`Invalid executable name "${name}" - use camelCase letters/digits only (e.g. checkData).`);
  }
  const file = executablePath(projectRoot, name);
  if (fs.existsSync(file)) throw new Error(`Executable "${name}" already exists at src/strategy/${name}.ts.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderExecutableTemplate(name));
  return file;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Dedupe positive ints across sources, preserving first-seen order. */
function uniqNums(...sources: unknown[]): number[] {
  const out: number[] = [];
  for (const s of sources) {
    for (const v of Array.isArray(s) ? s : [s]) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

const eqName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function load(sailDir: string): StoredStrategy[] {
  const parsed = readJson<StrategiesFile>(strategiesPath(sailDir));
  return parsed?.strategies ?? [];
}

function commit(strategies: StoredStrategy[], sailDir: string): void {
  writeJson(strategiesPath(sailDir), { version: 1, strategies });
}

/** The full deployed-chain set for an SMA (primary `chainId` is implicit). Empty if unknown. */
export function deployedChainsForSma(safe: string, sailDir: string = defaultSailDir()): number[] {
  const acct = listAccounts(sailDir).find((a) => a.safe.toLowerCase() === safe.toLowerCase());
  if (!acct) return [];
  return uniqNums(acct.chainId, acct.deployedChains);
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function listStrategies(sailDir: string = defaultSailDir()): StoredStrategy[] {
  return load(sailDir);
}

export function getStrategy(name: string, sailDir: string = defaultSailDir()): StoredStrategy | undefined {
  return load(sailDir).find((s) => eqName(s.name, name));
}

export function readActiveStrategies(sailDir: string = defaultSailDir()): StoredStrategy[] {
  return load(sailDir).filter((s) => s.active);
}

/**
 * Per-chain env map for `ctx.env`, read from `.sail/env/<chain-slug>.json`. Values are coerced to
 * strings. Returns `{}` when the chain is unknown or no env file exists.
 */
export function readChainEnv(chainId: number, sailDir: string = defaultSailDir()): Record<string, string> {
  let slug: string;
  try {
    slug = getChain(chainId).slug;
  } catch {
    return {};
  }
  const raw = readJson<Record<string, unknown>>(envPath(sailDir, slug));
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v != null) out[k] = String(v);
  }
  return out;
}

/**
 * Replace `.sail/env/<slug>.json` with `values` (keys trimmed, non-empty; values coerced to string).
 * Throws for an unknown chain. Returns the written map.
 */
export function writeChainEnv(chainId: number, values: Record<string, unknown>, sailDir: string = defaultSailDir()): Record<string, string> {
  const slug = getChain(chainId).slug;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    const key = String(k).trim();
    if (key) out[key] = String(v ?? "");
  }
  writeJson(envPath(sailDir, slug), out);
  return out;
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Normalize + validate a step: executable name camelCase, SMA is a known account, and every chain
 * is in that SMA's deployed set (≥1). Returns the cleaned step or throws with a human-readable
 * reason. `sma` is checksummed; `chains` are filtered to the deployed set and deduped.
 */
export function validateStep(step: StrategyStep, sailDir: string = defaultSailDir()): StrategyStep {
  if (!isValidExecutableName(step.executable)) {
    throw new Error(
      `Invalid executable name "${step.executable}" — use camelCase letters/digits only (e.g. agent, checkData).`,
    );
  }
  let sma: string;
  try {
    sma = getAddress(step.sma);
  } catch {
    throw new Error(`Invalid SMA address: ${step.sma}`);
  }
  const deployed = deployedChainsForSma(sma, sailDir);
  if (deployed.length === 0) {
    throw new Error(`SMA ${sma} is not a known account (create/import it first).`);
  }
  const chains = uniqNums(step.chains).filter((c) => deployed.includes(c));
  if (chains.length === 0) {
    throw new Error(
      `Step for ${sma} has no valid chains. Choose from the SMA's deployed chains: ${deployed.join(", ")}.`,
    );
  }
  return { executable: step.executable, sma, chains };
}

// ── Writes ────────────────────────────────────────────────────────────────────

/** Create a new, empty, inactive strategy. Throws if the name is blank or already used. */
export function createStrategy(name: string, sailDir: string = defaultSailDir()): StoredStrategy {
  const clean = name.trim();
  if (!clean) throw new Error("Strategy name must not be empty.");
  const strategies = load(sailDir);
  if (strategies.some((s) => eqName(s.name, clean))) {
    throw new Error(`A strategy named "${clean}" already exists.`);
  }
  const strategy: StoredStrategy = { name: clean, active: false, pipeline: { type: "sequential", steps: [] } };
  strategies.push(strategy);
  commit(strategies, sailDir);
  return strategy;
}

/** Set (or clear, with "") a strategy's description. Returns it, or null if unknown. */
export function setStrategyDescription(name: string, description: string, sailDir: string = defaultSailDir()): StoredStrategy | null {
  const strategies = load(sailDir);
  const s = strategies.find((x) => eqName(x.name, name));
  if (!s) return null;
  if (description.trim()) s.description = description.trim();
  else delete s.description;
  commit(strategies, sailDir);
  return s;
}

/** Toggle a strategy's active flag. Returns the updated strategy, or null if unknown. */
export function setStrategyActive(name: string, active: boolean, sailDir: string = defaultSailDir()): StoredStrategy | null {
  const strategies = load(sailDir);
  const s = strategies.find((x) => eqName(x.name, name));
  if (!s) return null;
  s.active = active;
  commit(strategies, sailDir);
  return s;
}

export function setPipelineType(name: string, type: PipelineType, sailDir: string = defaultSailDir()): StoredStrategy | null {
  const strategies = load(sailDir);
  const s = strategies.find((x) => eqName(x.name, name));
  if (!s) return null;
  s.pipeline.type = type;
  commit(strategies, sailDir);
  return s;
}

export function renameStrategy(oldName: string, newName: string, sailDir: string = defaultSailDir()): StoredStrategy | null {
  const clean = newName.trim();
  if (!clean) throw new Error("Strategy name must not be empty.");
  const strategies = load(sailDir);
  const s = strategies.find((x) => eqName(x.name, oldName));
  if (!s) return null;
  if (strategies.some((x) => x !== s && eqName(x.name, clean))) {
    throw new Error(`A strategy named "${clean}" already exists.`);
  }
  s.name = clean;
  commit(strategies, sailDir);
  return s;
}

export function deleteStrategy(name: string, sailDir: string = defaultSailDir()): boolean {
  const strategies = load(sailDir);
  const next = strategies.filter((s) => !eqName(s.name, name));
  if (next.length === strategies.length) return false;
  commit(next, sailDir);
  return true;
}

/** Append a validated step to a strategy's pipeline. Throws on unknown strategy or invalid step. */
export function addStep(name: string, step: StrategyStep, sailDir: string = defaultSailDir()): StoredStrategy {
  const strategies = load(sailDir);
  const s = strategies.find((x) => eqName(x.name, name));
  if (!s) throw new Error(`No strategy named "${name}".`);
  s.pipeline.steps.push(validateStep(step, sailDir));
  commit(strategies, sailDir);
  return s;
}

/** Replace the step at `index` (0-based) with a validated one. Preserves order. Throws on bad input. */
export function updateStep(name: string, index: number, step: StrategyStep, sailDir: string = defaultSailDir()): StoredStrategy {
  const strategies = load(sailDir);
  const s = strategies.find((x) => eqName(x.name, name));
  if (!s) throw new Error(`No strategy named "${name}".`);
  if (index < 0 || index >= s.pipeline.steps.length) throw new Error(`No step at index ${index}.`);
  s.pipeline.steps[index] = validateStep(step, sailDir);
  commit(strategies, sailDir);
  return s;
}

/** Remove the step at `index` (0-based) from a strategy. Returns the strategy, or null if unknown. */
export function removeStep(name: string, index: number, sailDir: string = defaultSailDir()): StoredStrategy | null {
  const strategies = load(sailDir);
  const s = strategies.find((x) => eqName(x.name, name));
  if (!s) return null;
  if (index >= 0 && index < s.pipeline.steps.length) s.pipeline.steps.splice(index, 1);
  commit(strategies, sailDir);
  return s;
}

/**
 * Seed the Default strategy when no strategies exist yet — the back-compat path so a brand-new SMA
 * runs `src/agent.ts` on its primary chain with zero config. No-op when any strategy already exists.
 * Returns the Default strategy (existing or freshly created), or null if `account` is missing.
 */
export function ensureDefaultStrategy(
  account: AccountRecord | null = readActiveAccount(),
  sailDir: string = defaultSailDir(),
): StoredStrategy | null {
  if (!account) return null;
  const strategies = load(sailDir);
  if (strategies.length > 0) {
    return strategies.find((s) => eqName(s.name, "Default")) ?? strategies[0];
  }
  const chains = deployedChainsForSma(account.safe, sailDir);
  const firstChain = chains[0] ?? account.chainId;
  const strategy: StoredStrategy = {
    name: "Default",
    active: true,
    pipeline: { type: "sequential", steps: [{ executable: "agent", sma: getAddress(account.safe), chains: [firstChain] }] },
  };
  commit([strategy], sailDir);
  return strategy;
}
