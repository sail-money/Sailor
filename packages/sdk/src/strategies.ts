// Single owner of the on-disk strategy state under `.sail/strategies/strategies.json`.
//
// A **strategy** is one runnable unit the runner drives each tick: **one SMA + one executable**
// (a `src/strategy/<name>.ts` script), with an optional `chains` list. An SMA may have many
// strategies; one executable may back many strategies. When `chains` is present the runner replays
// the executable once per chain (each tick's default ctx bound to that chain); when it's absent the
// runner invokes the executable once with ctx bound to the SMA's primary deployed chain and the
// executable drives other chains via `ctx.chain(id)`.
//
// Storage mirrors the accounts.ts convention: a function module keyed off an overridable `sailDir`
// (default `<cwd>/.sail`) so the CLI, the UI server, and the signing daemon all write through one
// place. Names (strategy and executable) are unique — see the validation helpers.

import fs from "node:fs";
import path from "node:path";
import { getAddress } from "viem";
import { defaultSailDir, listAccounts, readActiveAccount } from "./accounts.js";
import { getChain } from "./chains.js";

/**
 * A stored strategy: one SMA + one executable. `chains` present → the runner replays the executable
 * once per listed chain (each a subset of the SMA's deployed set); `chains` absent → the runner runs
 * the executable once, default-bound to the SMA's primary chain, and it may reach any deployed chain
 * via `ctx.chain(id)`.
 */
export type StoredStrategy = {
  /** Unique, non-empty display name (also the `--strategy` selector). */
  name: string;
  /** Optional human description shown in the dashboard. */
  description?: string;
  /** When true, the strategy runs on every tick of the default `sailor run`. */
  active: boolean;
  /** SMA (checksummed) this strategy runs the executable against. */
  sma: string;
  /** Executable name → `src/strategy/<executable>.ts`. Reusable across strategies. */
  executable: string;
  /** Optional replay set — a subset of the SMA's deployed chains. Absent = executable-driven mode. */
  chains?: number[];
};

/** Current on-disk schema version. */
const STRATEGIES_VERSION = 2 as const;

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

/** The default executable a strategy runs — the classic `src/agent.ts` (named executables live at `src/strategy/<name>.ts`). */
export const DEFAULT_EXECUTABLE = "agent" as const;

const STRATEGY_NAME_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
/** Strategy names allow letters/digits only, starting with a letter (camelCase or PascalCase,
 *  e.g. `dcaDaily`, `Yield`) — no spaces or separators. The name is also the spec filename
 *  (`.sail/strategies/<name>.md`) and the `--strategy` selector. */
export function isValidStrategyName(name: string): boolean {
  return STRATEGY_NAME_RE.test(name);
}

/** Source body for a new `src/strategy/<name>.ts` executable. */
export function renderExecutableTemplate(name: string): string {
  if (!isValidExecutableName(name)) {
    throw new Error(`Invalid executable name "${name}" - use camelCase letters/digits only (e.g. checkData).`);
  }
  return `import type { Agent, AgentContext, Dispatch } from "@sail.money/sailor/sdk";

/**
 * Executable "${name}" - a strategy is one SMA + this executable.
 *
 * The runner calls tick() each interval. If the strategy pins a \`chains\` list, tick runs once per
 * chain with ctx bound to that chain; otherwise it runs once with ctx bound to the SMA's primary
 * deployed chain. Either way you can reach any chain the SMA is deployed on via ctx.chain(id).
 * Return an array of Dispatch intents; return [] to skip (no gas spent).
 */
export const agent: Agent = {
  name: "${name}",
  description: "Describe what ${name} does.",

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    ctx.log(\`${name} tick - chain \${ctx.chainId}, sma \${ctx.safe}\`);

    // ── Default / single chain ──────────────────────────────────────────────────
    // ctx is bound to the strategy's default chain. Per-chain env (.sail/env/<chain>.json) is on
    // ctx.env; on-chain reads via ctx.read / ctx.publicClient.
    //   const token = ctx.env.MORPHO_TOKEN_ADDR as \`0x\${string}\`;
    //   const balance = await ctx.read.balance(token);
    //   if (balance === 0n) return [];
    //   return [{ txHash: "0x", success: false, gasUsed: 0n, calls: [{ target: token, value: 0n, data: "0x" }] }];

    // ── Another chain, same SMA ─────────────────────────────────────────────────
    // ctx.chain(id) is a handle bound to this SMA on any chain it's deployed on; its dispatch()
    // tags the intent so the runner routes it there:
    //   const base = ctx.chain(8453);
    //   const bal = await base.read.balance(base.env.USDC as \`0x\${string}\`);
    //   return [base.dispatch({ calls: [{ target: base.env.ROUTER as \`0x\${string}\`, value: 0n, data: "0x" }] })];

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
  const raw = readJson<{ strategies?: StoredStrategy[] }>(strategiesPath(sailDir));
  return raw?.strategies ?? [];
}

function commit(strategies: StoredStrategy[], sailDir: string): void {
  writeJson(strategiesPath(sailDir), { version: STRATEGIES_VERSION, strategies });
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
 * One-time compatibility migration for projects created before execution strategies existed.
 *
 * Only a missing strategies file is migrated. An existing file with an empty/inactive list is an
 * intentional configuration and must be respected. Returns the created default strategy, or null
 * when no migration was needed/possible.
 */
export function migrateLegacyDefaultStrategy(
  sailDir: string = defaultSailDir(),
): StoredStrategy | null {
  if (fs.existsSync(strategiesPath(sailDir))) return null;
  const account = readActiveAccount(sailDir);
  if (!account) return null;
  return createStrategy(
    "default",
    {
      sma: account.safe,
      executable: DEFAULT_EXECUTABLE,
      chains: [account.chainId],
      active: true,
    },
    sailDir,
  );
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
 * Normalize + validate an SMA + optional chains for a strategy. Returns the checksummed SMA and the
 * chains filtered to the SMA's deployed set (or `undefined` when none were requested). Throws when
 * the executable name is not camelCase, the SMA is not a known account, or requested chains resolve
 * to none of the SMA's deployed chains.
 */
function validateStrategyTarget(
  executable: string,
  smaInput: string,
  chainsInput: number[] | undefined,
  sailDir: string,
): { sma: string; chains?: number[] } {
  if (!isValidExecutableName(executable)) {
    throw new Error(
      `Invalid executable name "${executable}" — use camelCase letters/digits only (e.g. agent, checkData).`,
    );
  }
  let sma: string;
  try {
    sma = getAddress(smaInput);
  } catch {
    throw new Error(`Invalid SMA address: ${smaInput}`);
  }
  const deployed = deployedChainsForSma(sma, sailDir);
  if (deployed.length === 0) {
    throw new Error(`SMA ${sma} is not a known account (create/import it first).`);
  }
  if (chainsInput && chainsInput.length > 0) {
    const chains = uniqNums(chainsInput).filter((c) => deployed.includes(c));
    if (chains.length === 0) {
      throw new Error(
        `None of the chains [${chainsInput.join(", ")}] are in ${sma}'s deployed set: ${deployed.join(", ")}.`,
      );
    }
    return { sma, chains };
  }
  return { sma };
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Create a new strategy (active by default): one SMA + one executable, optionally pinned to a
 * `chains` subset. Pass `active: false` to create it inactive. The executable defaults to `agent`
 * (`src/agent.ts` — named executables live at `src/strategy/<name>.ts`) when omitted. Validates the name is
 * unique and camelCase (it is also the spec filename and `--strategy` selector), the executable name
 * is camelCase, the SMA is a known account, and any `chains` intersect the SMA's deployed set (≥1).
 * Omitting `chains` stores no key (cross-chain mode). Throws on any violation.
 */
export function createStrategy(
  name: string,
  opts: { sma: string; executable?: string; chains?: number[]; active?: boolean },
  sailDir: string = defaultSailDir(),
): StoredStrategy {
  const clean = name.trim();
  if (!isValidStrategyName(clean)) {
    throw new Error(
      `Invalid strategy name "${clean}" — use camelCase or PascalCase with no spaces or separators (e.g. dcaDaily, Yield); it is the spec filename and --strategy selector.`,
    );
  }
  const executable = opts.executable ?? DEFAULT_EXECUTABLE;
  const { sma, chains } = validateStrategyTarget(executable, opts.sma, opts.chains, sailDir);
  const strategies = load(sailDir);
  if (strategies.some((s) => eqName(s.name, clean))) {
    throw new Error(`A strategy named "${clean}" already exists.`);
  }
  const strategy: StoredStrategy = { name: clean, active: opts.active ?? true, sma, executable };
  if (chains) strategy.chains = chains;
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

/**
 * Set (or clear, with `null`/`[]`) a strategy's `chains`. When chains are given they are filtered to
 * the SMA's deployed set (≥1, else throws). Clearing switches the strategy to executable-driven mode.
 * Returns the updated strategy, or null if unknown.
 */
export function setStrategyChains(name: string, chains: number[] | null, sailDir: string = defaultSailDir()): StoredStrategy | null {
  const strategies = load(sailDir);
  const s = strategies.find((x) => eqName(x.name, name));
  if (!s) return null;
  if (!chains || chains.length === 0) {
    delete s.chains;
  } else {
    const deployed = deployedChainsForSma(s.sma, sailDir);
    const filtered = uniqNums(chains).filter((c) => deployed.includes(c));
    if (filtered.length === 0) {
      throw new Error(
        `None of the chains [${chains.join(", ")}] are in ${s.sma}'s deployed set: ${deployed.join(", ")}.`,
      );
    }
    s.chains = filtered;
  }
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
