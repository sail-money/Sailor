import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Agent,
  type AgentContext,
  type ChainHandle,
  type Dispatch,
  type ILocalKeyring,
  SailorClient,
  getChain,
  getDefaultRpcUrl,
  getNativeCurrencySymbol,
} from "@sail/sdk";
import {
  type StoredStrategy,
  deployedChainsForSma,
  getStrategy,
  isValidExecutableName,
  migrateLegacyDefaultStrategy,
  readActiveStrategies,
  readChainEnv,
} from "@sail/sdk/strategies";
import { http, type Address, type Hex, createPublicClient, createWalletClient, defineChain, getAddress } from "viem";
import {
  appendActivity,
  checksum,
  closePrompts,
  nowIso,
  parseEnvFile,
  readJsonFile,
  sailPath,
} from "../lib/io.js";
import { getRpcUrl } from "../lib/chain.js";
import { assertSafeRpcUrl } from "../lib/rpc-guard.js";
import { decodeTokenMove, formatTokenAmount, isUnlimitedAmount } from "../lib/dispatch-value.js";
import { keyExists, loadManagerSigner } from "../lib/keys.js";
import {
  resolvePermissionForBatch,
  resolvePermissionForCall,
} from "../lib/permission-resolver.js";
import { clearAgentPid, writeAgentPid } from "../lib/process.js";
import type { StoredMandate } from "../lib/state.js";

const DEFAULT_INTERVAL_SEC = 60;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The manager signer loaded for one SMA (its address + signing fns + viem account). */
type Signer = Awaited<ReturnType<typeof loadManagerSigner>>;

/**
 * Runner-level dispatch annotation.
 *
 * Extends the SDK's `Dispatch` type with an optional `permission` override and a `chainId` routing
 * tag. When an agent sets `permission`, the runner uses it directly and skips the off-chain
 * evaluate() probe. `chainId` (set by `ctx.chain(id).dispatch`) tells the runner which chain to
 * execute the intent on; an untagged intent defaults to the tick's default chain.
 */
type RunnerDispatch = Dispatch & { permission?: Address; chainId?: number };

export type StrategyRunFailure = { strategy: string; error: Error };

/** Build an activity record that cannot be misattributed to the UI-selected SMA. */
export function runtimeActivityEvent(
  event: Record<string, unknown>,
  safe: Address,
  chainId: number,
  strategy: string,
): Record<string, unknown> {
  return { ...event, safe, chainId, strategy };
}

/** Reject a dispatch whose chain tag is outside this run's allowed set. */
export function assertDispatchChainAllowed(chainId: number, allowed: number[], sma: string): void {
  if (!allowed.includes(chainId)) {
    throw new Error(
      `Dispatch tagged for chain ${chainId}, which is outside SMA ${sma}'s runnable set: ${allowed.join(", ")}.`,
    );
  }
}

/** Make scheduled/one-shot callers observe fatal strategy failures via a non-zero exit. */
export function assertNoStrategyFailures(failures: StrategyRunFailure[]): void {
  if (failures.length === 0) return;
  const detail = failures.map(({ strategy, error }) => `${strategy}: ${error.message}`).join("; ");
  throw new AggregateError(
    failures.map(({ error }) => error),
    `${failures.length} strategy execution(s) failed — ${detail}`,
  );
}

/** Minimal ERC-20 ABI fragments for read helpers. */
const ERC20_READ_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

/** Loads the agent data slot from SAILOR_DATA (a JSON file path), or {} . */
function loadAgentData(filePath: string | undefined): Record<string, unknown> {
  if (!filePath) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Dynamically imports an executable by name from the current project.
 *
 * The default `agent` executable keeps the classic `src/agent.ts` path (so existing projects run
 * unchanged); named/custom executables resolve from `src/strategy/<name>.ts` (and built
 * `dist/strategy/<name>.js`). `.ts` files load via tsx's tsImport(); `.js` via plain dynamic import().
 */
async function loadExecutable(name: string): Promise<Agent> {
  if (!isValidExecutableName(name)) {
    throw new Error(`Invalid executable name "${name}" in strategies.json — use camelCase letters/digits only.`);
  }
  const candidates =
    name === "agent"
      ? ["src/agent.ts", "src/agent.js", "dist/agent.js", "dist/src/agent.js"]
      : [
          `src/strategy/${name}.ts`,
          `src/strategy/${name}.js`,
          `dist/strategy/${name}.js`,
          `dist/src/strategy/${name}.js`,
        ];
  for (const rel of candidates) {
    const abs = path.join(process.cwd(), rel);
    if (!fs.existsSync(abs)) continue;

    let mod: { agent?: Agent; default?: Agent };
    if (abs.endsWith(".ts")) {
      // tsx resolves .js import specifiers to .ts source files. The specifier must be a file URL
      // (not a bare path) so Windows paths like C:\... aren't misread as a URL with scheme "c:".
      const { tsImport } = await import("tsx/esm/api");
      const absUrl = pathToFileURL(abs).href;
      mod = (await tsImport(absUrl, absUrl)) as typeof mod;
    } else {
      mod = (await import(pathToFileURL(abs).href)) as typeof mod;
    }

    const agent = mod.agent ?? mod.default;
    if (!agent || typeof agent.tick !== "function") {
      throw new Error(`${rel} does not export an \`agent\` with a tick() function.`);
    }
    return agent;
  }
  throw new Error(
    `No executable "${name}" found. Expected ` +
      (name === "agent" ? "src/agent.ts" : `src/strategy/${name}.ts`) +
      ". Ensure tsx is installed: pnpm add tsx",
  );
}

/**
 * `sailor run [--once]` — the strategy execution loop.
 *
 * Each tick runs every active strategy (or the one named by `--strategy`). A strategy is one SMA +
 * one executable: with a `chains` list the executable is replayed once per chain; without one it
 * runs once, default-bound to the SMA's primary deployed chain, and may drive other chains via
 * `ctx.chain(id)`. Returned Dispatch intents are grouped by their chain tag; for each the runner
 * resolves the authorising permission, previews it, executes approved ones, and records the outcome
 * to .sail/activity.jsonl. A denied or failing dispatch is logged and skipped — it never stops the
 * loop. The chain comes solely from the strategy; `CHAIN_ID` is no longer read.
 */
export async function runCommand(opts: {
  once?: boolean;
  strategy?: string;
  reason?: string;
  sma?: string;
  chains?: number[];
}): Promise<void> {
  const once = opts.once === true;

  // A mandate must exist somewhere in the project before running (permissions are read on-chain
  // per SMA per tick; this is just the "you haven't signed anything yet" gate).
  const mandateRaw = readJsonFile<StoredMandate | StoredMandate[]>(sailPath("mandate.json"));
  const mandate = Array.isArray(mandateRaw) ? mandateRaw[0] : mandateRaw;
  if (!mandate) {
    throw new Error('No mandate found at .sail/mandate.json.\nRun "sailor mandate sign" first.');
  }

  const env = parseEnvFile(sailPath(".env.local"));
  // Inject shared .env.local values into process.env for anything not already set by the shell
  // (e.g. SAIL_PASSPHRASE for headless use). Per-chain values live in .sail/env/<slug>.json and
  // reach executables via ctx.env, NOT process.env.
  for (const [k, v] of Object.entries(env)) {
    if (v && !process.env[k]) process.env[k] = v;
  }

  const runReason = opts.reason ?? process.env.SAIL_RUN_REASON ?? "manual";

  const migrated = migrateLegacyDefaultStrategy();
  if (migrated) {
    console.warn(
      `Migrated legacy agent execution to strategy "${migrated.name}" ` +
        `for SMA ${checksum(migrated.sma)} on chain ${migrated.chains?.[0]}.`,
    );
  }

  // ── Resolve which strategies to run ─────────────────────────────────────────
  let strategies: StoredStrategy[];
  if (opts.strategy) {
    const s = getStrategy(opts.strategy);
    if (!s) throw new Error(`No strategy named "${opts.strategy}". List them with \`sailor strategy list\`.`);
    strategies = [s];
  } else {
    strategies = readActiveStrategies();
    if (strategies.length === 0) {
      throw new Error(
        "No active strategies. Create one with the sailor-strategy skill, or run " +
          "`sailor strategy create <name> --sma <address>` (the `agent` executable is the default).",
      );
    }
  }

  // Optional run-time filters (do NOT change stored config): restrict to a specific SMA and/or
  // chains. The `--sma` filter drops non-matching strategies here; the `--chains` filter narrows the
  // deployed/replay set each strategy runs on (applied per strategy in `runStrategy`). With no
  // filter, every chosen strategy runs on its full chain set.
  const smaFilter = opts.sma ? checksum(opts.sma) : null;
  const chainFilter = opts.chains && opts.chains.length > 0 ? new Set(opts.chains) : null;
  if (smaFilter) {
    strategies = strategies.filter((s) => checksum(s.sma) === smaFilter);
  }

  // The chains a strategy would run on under the current filters: for a per-chain strategy
  // (`chains` set), `chains` ∩ (deployed ∩ filter); for a cross-chain strategy (no `chains`), the
  // whole deployed set ∩ filter (it runs once, default-bound to the first). Empty ⇒ nothing to run.
  const runnableChainsFor = (s: StoredStrategy): number[] => {
    const deployed = deployedChainsForSma(checksum(s.sma));
    const allowed = chainFilter ? deployed.filter((c) => chainFilter.has(c)) : deployed;
    if (allowed.length === 0) return [];
    if (s.chains && s.chains.length > 0) return s.chains.filter((c) => allowed.includes(c));
    return allowed;
  };

  strategies = strategies.filter((s) => runnableChainsFor(s).length > 0);
  if (strategies.length === 0) {
    const filterMsg =
      smaFilter || chainFilter
        ? `No active strategy matches the filter (${[smaFilter && `sma ${smaFilter}`, chainFilter && `chains ${[...chainFilter].join(",")}`].filter(Boolean).join(", ")}).`
        : "No strategy to run. Create one with `sailor strategy create` (or activate a configured strategy).";
    throw new Error(filterMsg);
  }

  const intervalSec = (() => {
    const raw = process.env.SAILOR_INTERVAL ?? env.SAILOR_INTERVAL;
    const n = raw === undefined ? DEFAULT_INTERVAL_SEC : Number(raw);
    return Number.isNaN(n) || n <= 0 ? DEFAULT_INTERVAL_SEC : n;
  })();

  // ── Load a manager signer per distinct SMA (up front, so the passphrase can be scrubbed) ─────
  const distinctSmas = [...new Set(strategies.map((s) => checksum(s.sma)))];
  const signers = new Map<string, Signer>();
  for (const safe of distinctSmas) {
    if (!keyExists("manager", safe)) {
      console.error(`Skipping SMA ${safe}: no Agent wallet key. Run "sailor keys generate" for it first.`);
      continue;
    }
    signers.set(safe, await loadManagerSigner(safe));
  }
  strategies = strategies.filter((s) => signers.has(checksum(s.sma)));
  if (strategies.length === 0) {
    throw new Error('No strategy has an Agent wallet key. Run "sailor keys generate" first.');
  }
  // Scrub the passphrase now that every key is loaded — executable code runs in this process.
  delete process.env.SAIL_PASSPHRASE;
  closePrompts();
  const agentManagerFor = new Map<string, ILocalKeyring>();
  for (const [safe, m] of signers) {
    agentManagerFor.set(safe, { address: m.address, sign: m.sign.bind(m), signTyped: m.signTyped.bind(m) });
  }

  // Cache executables by name (import once) and runtimes by `${safe}:${chainId}` (build clients once).
  const executableCache = new Map<string, Agent>();
  const loadExecutableFor = async (name: string): Promise<Agent> => {
    const cached = executableCache.get(name);
    if (cached) return cached;
    const agent = await loadExecutable(name);
    executableCache.set(name, agent);
    return agent;
  };

  type ChainRuntime = NonNullable<Awaited<ReturnType<typeof buildRuntime>>>;
  const runtimeCache = new Map<string, ChainRuntime | null>();

  const recordActivity = (
    rt: Pick<ChainRuntime, "accountAddr" | "chainId">,
    strategy: string,
    event: Record<string, unknown>,
  ): void => {
    appendActivity(runtimeActivityEvent(event, rt.accountAddr, rt.chainId, strategy));
  };

  /**
   * Build (or return null for) the per-(SMA, chain) runtime: RPC, kernel, clients, capability
   * detection, data slot, and read helpers. Returns null when the chain can't run (missing/invalid
   * RPC or an unresolvable kernel) so one misconfigured (SMA, chain) never aborts the others.
   */
  const buildRuntime = async (safe: string, chainId: number) => {
    const accountAddr = checksum(safe);
    const signer = signers.get(accountAddr);
    const agentManager = agentManagerFor.get(accountAddr);
    if (!signer || !agentManager) {
      console.error(`skip ${accountAddr}: no Agent wallet signer loaded`);
      return null;
    }

    let kernel: Address | undefined;
    let mandateFactory: Address | undefined;
    let chainName = `Chain ${chainId}`;
    try {
      const cfg = getChain(chainId);
      kernel = checksum(cfg.kernel);
      mandateFactory = checksum(cfg.mandateFactory);
      chainName = cfg.name;
    } catch {
      // chain not in the SDK registry — env override may still supply the kernel
    }
    if (env.KERNEL_ADDRESS) kernel = checksum(env.KERNEL_ADDRESS);
    if (env.MANDATE_FACTORY) mandateFactory = checksum(env.MANDATE_FACTORY);
    if (!kernel) {
      console.error(`skip chain ${chainId}: no SailKernel address (not in registry, no KERNEL_ADDRESS).`);
      return null;
    }

    // Configured RPC wins; else the chain registry's public default (rate-limited — set your own
    // RPC_URL in .sail/.env.local for production). The public default is fine for dev/first-run.
    const rpcUrl = getRpcUrl(chainId) ?? getDefaultRpcUrl(chainId);
    if (!rpcUrl) {
      console.error(`skip chain ${chainId} (${chainName}): no RPC configured and no registry default.`);
      return null;
    }
    try {
      assertSafeRpcUrl(rpcUrl);
    } catch (e) {
      console.error(`skip chain ${chainId} (${chainName}): ${(e as Error).message}`);
      return null;
    }

    const nativeSymbol = getNativeCurrencySymbol(chainId);
    const chain = defineChain({
      id: chainId,
      name: chainName,
      nativeCurrency: { name: nativeSymbol, symbol: nativeSymbol, decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account: signer.viemAccount, chain, transport: http(rpcUrl) });
    const readClient = new SailorClient({ rpcUrl, chainId, kernel, mandateFactory });
    const execClient = readClient.withSigner(walletClient);

    let isConjunctive = false;
    try {
      const caps = await readClient.capabilities();
      isConjunctive = caps.dispatchModel === "conjunctive";
    } catch {
      // advisory — default to attempting preview (throws are caught per-dispatch)
    }

    const data: Record<string, unknown> = {
      ...loadAgentData(process.env.SAILOR_DATA ?? env.SAILOR_DATA),
      _publicClient: publicClient,
    };

    const readBalance = async (token: Address | "native"): Promise<bigint> =>
      token === "native"
        ? publicClient.getBalance({ address: accountAddr })
        : publicClient.readContract({ address: token, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [accountAddr] });

    const readAllowance = (token: Address, owner: Address, spender: Address): Promise<bigint> =>
      publicClient.readContract({ address: token, abi: ERC20_READ_ABI, functionName: "allowance", args: [owner, spender] });

    const decimalsCache = new Map<Address, number>();
    const readDecimals = async (token: Address): Promise<number> => {
      const key = getAddress(token);
      const cached = decimalsCache.get(key);
      if (cached !== undefined) return cached;
      const d = await publicClient.readContract({ address: token, abi: ERC20_READ_ABI, functionName: "decimals" });
      decimalsCache.set(key, d);
      return d;
    };

    const symbolCache = new Map<Address, string | undefined>();
    const readSymbol = async (token: Address): Promise<string | undefined> => {
      const key = getAddress(token);
      if (symbolCache.has(key)) return symbolCache.get(key);
      let sym: string | undefined;
      try {
        sym = (await publicClient.readContract({ address: token, abi: ERC20_READ_ABI, functionName: "symbol" })) as string;
      } catch {
        sym = undefined;
      }
      symbolCache.set(key, sym);
      return sym;
    };

    const describeDispatchValue = async (
      calls: readonly { target: Address; data: Hex; value?: bigint }[],
    ): Promise<Record<string, unknown>> => {
      for (const c of calls) {
        const move = decodeTokenMove(c.data);
        if (!move) continue;
        let decimals: number;
        try {
          decimals = await readDecimals(c.target);
        } catch {
          continue;
        }
        return {
          amount: move.amount.toString(),
          amountFormatted: formatTokenAmount(move.amount, decimals),
          token: getAddress(c.target),
          tokenSymbol: await readSymbol(c.target),
          tokenDecimals: decimals,
          amountKind: move.fn === "approve" ? "allowance" : "transfer",
          ...(isUnlimitedAmount(move.amount) ? { unlimited: true } : {}),
        };
      }
      const nativeCall = calls.find((c) => (c.value ?? 0n) > 0n);
      if (nativeCall) {
        const value = nativeCall.value ?? 0n;
        return { amount: value.toString(), amountFormatted: formatTokenAmount(value, 18), tokenSymbol: chain.nativeCurrency.symbol, tokenDecimals: 18, amountKind: "native" };
      }
      return {};
    };

    return {
      accountAddr,
      chainId,
      chainName,
      kernel,
      chain,
      publicClient,
      readClient,
      execClient,
      isConjunctive,
      signer,
      agentManager,
      data,
      readBalance,
      readAllowance,
      readDecimals,
      describeDispatchValue,
    };
  };

  const getRuntime = async (safe: string, chainId: number): Promise<ChainRuntime | null> => {
    const key = `${checksum(safe)}:${chainId}`;
    if (runtimeCache.has(key)) return runtimeCache.get(key) ?? null;
    const rt = await buildRuntime(safe, chainId);
    runtimeCache.set(key, rt);
    return rt;
  };

  type BlockInfo = { number: bigint; timestamp: bigint };

  // Fetch the current block for a runtime; null when the RPC is unavailable — callers must skip
  // rather than evaluate permissions against a fabricated zero block/timestamp.
  const getBlockInfo = async (rt: ChainRuntime): Promise<BlockInfo | null> => {
    try {
      const block = await rt.publicClient.getBlock();
      return { number: block.number ?? 0n, timestamp: block.timestamp ?? 0n };
    } catch (e) {
      console.error(`skip chain ${rt.chainId}: block read failed: ${(e as Error).message}`);
      return null;
    }
  };

  /**
   * Resolve → preview → execute → log a runtime's dispatches, then a one-line per-chain summary.
   * Failures are swallowed and the loop continues — a denied/reverted/erroring dispatch never stops
   * the run.
   */
  const executeDispatches = async (
    rt: ChainRuntime,
    dispatches: Dispatch[],
    blockInfo: BlockInfo,
    strategy: string,
  ): Promise<void> => {
    const { accountAddr, kernel, publicClient, readClient, execClient, isConjunctive, signer, agentManager } = rt;

    let registeredPermissions: Address[] = [];
    try {
      const perms = await readClient.mandate.list(accountAddr);
      registeredPermissions = perms.map((m) => m.permission);
    } catch (err) {
      console.error(`could not read registered permissions: ${(err as Error).message}`);
    }

    let tickExecuted = 0;
    let tickReverted = 0;
    let tickSkipped = 0;

    for (const rawDispatch of dispatches) {
      const dispatch = rawDispatch as RunnerDispatch;
      const [firstCall] = dispatch.calls;
      const target = firstCall?.target ?? ("0x" as Address);

      try {
        if (dispatch.calls.length === 0) {
          recordActivity(rt, strategy, { ts: nowIso(), actor: "agent", type: "dispatch_denied", target, reason: "no calls" });
          tickSkipped++;
          continue;
        }
        if (registeredPermissions.length === 0) {
          recordActivity(rt, strategy, { ts: nowIso(), actor: "agent", type: "dispatch_denied", target, reason: "no_registered_permissions" });
          console.log("skipped: no permissions registered on this SMA — run `sailor mandate sign` first");
          tickSkipped++;
          continue;
        }

        let permission: Address | undefined;
        if (dispatch.permission) {
          permission = dispatch.permission;
        } else if (dispatch.calls.length > 1) {
          permission = await resolvePermissionForBatch({
            publicClient,
            kernel,
            account: accountAddr,
            calls: dispatch.calls,
            registeredPermissions,
          });
        } else {
          permission = await resolvePermissionForCall({
            publicClient,
            kernel,
            account: accountAddr,
            manager: agentManager.address,
            call: firstCall as NonNullable<typeof firstCall>,
            registeredPermissions,
            blockInfo,
          });
        }

        if (!permission) {
          const selector = firstCall?.data && firstCall.data.length >= 10 ? firstCall.data.slice(0, 10) : "0x";
          recordActivity(rt, strategy, { ts: nowIso(), actor: "agent", type: "dispatch_denied", target, reason: "no_permission_match" });
          console.log(`skipped: no registered permission authorizes call to ${target} (selector ${selector})`);
          tickSkipped++;
          continue;
        }

        if (!isConjunctive && dispatch.calls.length > 1) {
          const preview = await execClient.dispatch.preview(accountAddr, permission, dispatch.calls);
          if (!preview.approved) {
            const reason = preview.reason ?? "denied";
            recordActivity(rt, strategy, { ts: nowIso(), actor: "agent", type: "dispatch_denied", permission, target, reason });
            console.log(`denied: ${reason}`);
            tickSkipped++;
            continue;
          }
        }

        const dispatchValue = await rt.describeDispatchValue(dispatch.calls);
        recordActivity(rt, strategy, { ts: nowIso(), actor: "agent", type: "dispatch_approved", permission, target, ...dispatchValue });
        const result =
          dispatch.calls.length > 1
            ? await execClient.dispatch.batch(accountAddr, permission, dispatch.calls, signer)
            : await execClient.dispatch.single(accountAddr, permission, firstCall as NonNullable<typeof firstCall>, signer);

        if (isConjunctive && result.txHash) {
          try {
            await publicClient.waitForTransactionReceipt({ hash: result.txHash, timeout: 30_000 });
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch {
            // receipt already confirmed by dispatch.single — belt-and-suspenders
          }
        }

        if (!result.success) {
          recordActivity(rt, strategy, { ts: nowIso(), actor: "agent", type: "dispatch_reverted", permission, target, txHash: result.txHash, gasUsed: String(result.gasUsed), ...dispatchValue });
          console.error(`reverted: ${result.txHash}  (gas used: ${result.gasUsed})`);
          tickReverted++;
        } else {
          recordActivity(rt, strategy, { ts: nowIso(), actor: "agent", type: "dispatch_executed", permission, target, txHash: result.txHash, ...dispatchValue });
          console.log(`executed: ${result.txHash}`);
          tickExecuted++;
        }
      } catch (err) {
        const reason = (err as Error).message;
        console.error(`dispatch error: ${reason}`);
        recordActivity(rt, strategy, { ts: nowIso(), actor: "agent", type: "error", permission: (dispatch as RunnerDispatch).permission, target, reason });
        tickSkipped++;
      }
    }

    if (dispatches.length > 0) {
      const parts = [`${tickExecuted} executed`];
      if (tickReverted > 0) parts.push(`${tickReverted} reverted`);
      if (tickSkipped > 0) parts.push(`${tickSkipped} skipped`);
      console.log(`tick complete [${rt.chainName} · ${accountAddr.slice(0, 8)}…]: ${parts.join(", ")}`);
    }
  };

  let stopping = false;

  // The SMA client, constrained so agent code can dispatch/strategy-swap but not call privileged
  // writes (dispatch/strategy use the exec client; everything else the read-only client).
  const constrainedClient = (rt: ChainRuntime) =>
    Object.assign(Object.create(rt.readClient) as typeof rt.readClient, {
      dispatch: rt.execClient.dispatch,
      strategy: rt.execClient.strategy,
    });

  // A per-chain handle (ctx.chain(id)). `dispatch()` only TAGS the intent with this handle's chain;
  // the runner routes + executes it later, so no on-chain write happens here.
  const handleForRuntime = (rt: ChainRuntime): ChainHandle => ({
    chainId: rt.chainId,
    publicClient: rt.publicClient,
    client: constrainedClient(rt),
    env: readChainEnv(rt.chainId),
    read: { balance: rt.readBalance, allowance: rt.readAllowance, decimals: rt.readDecimals },
    dispatch: (intent) => ({
      txHash: "0x",
      success: false,
      gasUsed: 0n,
      calls: intent.calls,
      ...(intent.permission ? { permission: intent.permission } : {}),
      chainId: rt.chainId,
    }),
  });

  /**
   * Build the ONE AgentContext shape for a tick: top-level fields bind to `defaultChainId`, and
   * `ctx.chain(id)` reaches any chain in `allowed` (the SMA's deployed set, narrowed by --chains).
   * Runtimes for `allowed` are pre-built (and cached) so `ctx.chain(id)` returns synchronously.
   * Returns null when the default chain's runtime can't be built (already logged).
   */
  const makeCtx = async (
    sma: string,
    defaultChainId: number,
    allowed: number[],
    strategy: string,
  ): Promise<{ ctx: AgentContext; runtime: ChainRuntime } | null> => {
    const defaultRt = await getRuntime(sma, defaultChainId);
    if (!defaultRt) return null;

    const chainRuntimes = new Map<number, ChainRuntime>([[defaultChainId, defaultRt]]);
    for (const id of allowed) {
      if (chainRuntimes.has(id)) continue;
      const rt = await getRuntime(sma, id);
      if (rt) chainRuntimes.set(id, rt);
    }

    const blockInfo = await getBlockInfo(defaultRt);
    if (!blockInfo) return null; // block read failed — already logged; don't evaluate against a fabricated block

    const chain = (chainId: number): ChainHandle => {
      if (!allowed.includes(chainId)) {
        throw new Error(
          `ctx.chain(${chainId}): SMA ${sma} is not deployed on chain ${chainId} (or it's outside the run filter). Available: ${allowed.join(", ")}.`,
        );
      }
      const rt = chainRuntimes.get(chainId);
      if (!rt) throw new Error(`ctx.chain(${chainId}): runtime unavailable (no RPC/kernel/signer for ${sma}).`);
      return handleForRuntime(rt);
    };

    const ctx: AgentContext = {
      safe: defaultRt.accountAddr,
      account: defaultRt.accountAddr,
      chainId: defaultRt.chainId,
      blockNumber: blockInfo.number,
      timestamp: Math.floor(Date.now() / 1000),
      now: new Date(),
      client: constrainedClient(defaultRt),
      publicClient: defaultRt.publicClient,
      manager: defaultRt.agentManager,
      log: (msg: string): void => {
        console.log(`[agent] ${msg}`);
        recordActivity(defaultRt, strategy, { ts: nowIso(), actor: "agent", type: "log", msg });
      },
      data: defaultRt.data,
      env: readChainEnv(defaultRt.chainId),
      read: { balance: defaultRt.readBalance, allowance: defaultRt.readAllowance, decimals: defaultRt.readDecimals },
      chain,
    };
    return { ctx, runtime: defaultRt };
  };

  // Log a thrown tick against its real runtime, then propagate it so --once can fail. The daemon's
  // cycle boundary catches the error and continues with the remaining strategies.
  const invokeTick = async (
    agent: Agent,
    ctx: AgentContext,
    rt: ChainRuntime,
    strategy: string,
  ): Promise<Dispatch[]> => {
    try {
      return await agent.tick(ctx);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const reason = error.message;
      console.error(`tick error: ${reason}`);
      recordActivity(rt, strategy, { ts: nowIso(), actor: "agent", type: "error", reason });
      throw error;
    }
  };

  // Group returned dispatches by their chain tag (untagged → `defaultChain`) and execute each group
  // on its chain, sequentially per chain (nonce safety).
  const routeAndExecute = async (
    sma: string,
    dispatches: Dispatch[],
    defaultChain: number,
    allowed: number[],
    strategy: string,
  ): Promise<void> => {
    const groups = new Map<number, Dispatch[]>();
    for (const d of dispatches as RunnerDispatch[]) {
      const chainId = d.chainId ?? defaultChain;
      assertDispatchChainAllowed(chainId, allowed, sma);
      const group = groups.get(chainId) ?? [];
      group.push(d);
      groups.set(chainId, group);
    }
    for (const [chainId, group] of groups) {
      const rt = await getRuntime(sma, chainId);
      if (!rt) throw new Error(`Runtime unavailable for SMA ${sma} on chain ${chainId}.`);
      const blockInfo = await getBlockInfo(rt);
      if (!blockInfo) throw new Error(`Block read failed for SMA ${sma} on chain ${chainId}.`);
      await executeDispatches(rt, group, blockInfo, strategy);
    }
  };

  // One tick on one default chain: build ctx, run tick, route + execute, bookended with activity events.
  const runOnChain = async (
    agent: Agent,
    sma: string,
    defaultChain: number,
    allowed: number[],
    strategy: string,
  ): Promise<void> => {
    const built = await makeCtx(sma, defaultChain, allowed, strategy);
    if (!built) throw new Error(`Runtime unavailable for SMA ${sma} on chain ${defaultChain}.`);
    const { ctx, runtime } = built;
    recordActivity(runtime, strategy, { ts: nowIso(), actor: "agent", type: "tick_start", reason: runReason });
    try {
      const dispatches = await invokeTick(agent, ctx, runtime, strategy);
      await routeAndExecute(sma, dispatches, defaultChain, allowed, strategy);
    } finally {
      recordActivity(runtime, strategy, { ts: nowIso(), actor: "agent", type: "tick_end" });
    }
  };

  /**
   * Run one strategy. Per-chain (`chains` set) → replay the executable once per listed chain,
   * each tick's default ctx bound to that chain. Cross-chain (no `chains`) → run once, default-bound
   * to the SMA's first deployed chain, letting the executable reach others via `ctx.chain(id)`.
   */
  const runStrategy = async (strategy: StoredStrategy): Promise<void> => {
    const sma = checksum(strategy.sma);
    const agent = await loadExecutableFor(strategy.executable);
    const deployed = deployedChainsForSma(sma);
    const allowed = chainFilter ? deployed.filter((c) => chainFilter.has(c)) : deployed;
    if (allowed.length === 0) return;

    if (strategy.chains && strategy.chains.length > 0) {
      const failures: Error[] = [];
      for (const chainId of strategy.chains) {
        if (stopping) break;
        if (!allowed.includes(chainId)) continue; // outside the --chains filter
        try {
          await runOnChain(agent, sma, chainId, allowed, strategy.name);
        } catch (err) {
          failures.push(err instanceof Error ? err : new Error(String(err)));
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} chain execution(s) failed for ${strategy.name}`);
      }
    } else {
      await runOnChain(agent, sma, allowed[0], allowed, strategy.name);
    }
  };

  const runCycle = async (): Promise<StrategyRunFailure[]> => {
    const failures: StrategyRunFailure[] = [];
    for (const strategy of strategies) {
      if (stopping) break;
      try {
        await runStrategy(strategy);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        failures.push({ strategy: strategy.name, error });
        console.error(`strategy error [${strategy.name}]: ${error.message}`);
      }
    }
    return failures;
  };

  // ── Header ────────────────────────────────────────────────────────────────────
  console.log("Sailor agent running");
  for (const s of strategies) {
    const mode = s.chains && s.chains.length > 0 ? `per-chain [${s.chains.join(",")}]` : "cross-chain (executable-driven)";
    console.log(`Strategy: ${s.name} → ${s.executable} @ ${checksum(s.sma).slice(0, 8)}… (${mode})`);
  }
  console.log(once ? "Mode: single tick (--once)" : `Interval: ${intervalSec}s`);
  console.log(`Reason: ${runReason}`);
  console.log("Press Ctrl+C to stop");
  console.log("");

  // ── PID + clean shutdown (one agent.pid for the process) ────────────────────
  writeAgentPid();
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    console.log("\nStopping agent…");
    clearAgentPid();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // ── Run ──────────────────────────────────────────────────────────────────────
  try {
    if (once) {
      assertNoStrategyFailures(await runCycle());
      return;
    }
    while (!stopping) {
      await runCycle();
      if (stopping) break;
      await sleep(intervalSec * 1000);
    }
  } finally {
    clearAgentPid();
  }
}
