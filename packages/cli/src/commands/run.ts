import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Agent,
  type AgentContext,
  type Dispatch,
  type ILocalKeyring,
  SailorClient,
  getChain,
  getDefaultRpcUrl,
} from "@sail/sdk";
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
import { decodeTokenMove, formatTokenAmount, isUnlimitedAmount } from "../lib/dispatch-value.js";
import { keyExists, loadManagerSigner } from "../lib/keys.js";
import {
  resolvePermissionForBatch,
  resolvePermissionForCall,
} from "../lib/permission-resolver.js";
import { clearAgentPid, writeAgentPid } from "../lib/process.js";
import { readExecutableAccount, setExecutableAccount } from "@sail/sdk/accounts";
import {
  type StoredStrategy,
  type StrategyStep,
  ensureDefaultStrategy,
  getStrategy,
  readActiveStrategies,
  readChainEnv,
} from "@sail/sdk/strategies";
import type { StoredMandate } from "../lib/state.js";

const DEFAULT_INTERVAL_SEC = 60;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The manager signer loaded for one SMA (its address + signing fns + viem account). */
type Signer = Awaited<ReturnType<typeof loadManagerSigner>>;

/**
 * Runner-level dispatch annotation.
 *
 * Extends the SDK's `Dispatch` type with an optional `permission` override. When an agent sets
 * `permission`, the runner uses it directly and skips the off-chain evaluate() probe. Backward
 * compatible: agents that never set it keep working via the probe path.
 */
type RunnerDispatch = Dispatch & { permission?: Address };

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
 * Resolution order: `src/strategy/<name>.ts|.js` (and built `dist/strategy/<name>.js`), then — for
 * the default `agent` name — the legacy `src/agent.ts` candidates, so existing projects keep
 * working. `.ts` files load via tsx's tsImport(); `.js` via plain dynamic import().
 */
async function loadExecutable(name: string): Promise<Agent> {
  const perName = [
    `src/strategy/${name}.ts`,
    `src/strategy/${name}.js`,
    `dist/strategy/${name}.js`,
    `dist/src/strategy/${name}.js`,
  ];
  const legacy = name === "agent" ? ["src/agent.ts", "src/agent.js", "dist/agent.js", "dist/src/agent.js"] : [];
  for (const rel of [...perName, ...legacy]) {
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
    `No executable "${name}" found. Expected src/strategy/${name}.ts` +
      (name === "agent" ? " (or the legacy src/agent.ts)" : "") +
      ". Ensure tsx is installed: pnpm add tsx",
  );
}

/**
 * Validate an RPC URL to prevent SSRF against internal endpoints (e.g. AWS IMDS at
 * 169.254.169.254) via a crafted .env.local. Throws on a bad/blocked URL.
 */
function assertSafeRpcUrl(rpcUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error(`RPC_URL is not a valid URL: ${rpcUrl}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`RPC_URL must use http or https — got: ${parsed.protocol}`);
  }
  const blocked =
    /^(169\.254\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|::1$|fd[0-9a-f]{2}:)/i;
  if (blocked.test(parsed.hostname) && !process.env.SAILOR_ALLOW_LOCAL_RPC) {
    throw new Error(
      `RPC_URL hostname "${parsed.hostname}" is a private or link-local address. ` +
        "Set SAILOR_ALLOW_LOCAL_RPC=1 to allow local RPC endpoints (dev only).",
    );
  }
}

/**
 * `sailor run [--once]` — the strategy execution loop.
 *
 * Each tick runs every active strategy (or the one named by `--strategy`). A strategy's pipeline
 * runs its steps in `sequential` order or in `parallel`; each step runs its executable against its
 * SMA across each of its chains. For every returned Dispatch the runner resolves the authorising
 * permission, previews it, executes approved ones, and records the outcome to .sail/activity.jsonl.
 * A denied or failing dispatch is logged and skipped — it never stops the loop. The chain comes
 * solely from the strategy; `CHAIN_ID` is no longer read.
 */
export async function runCommand(opts: {
  once?: boolean;
  strategy?: string;
  reason?: string;
  sma?: string;
}): Promise<void> {
  const once = opts.once === true;

  // --sma persists which SMA is the executable one — used only to seed the Default strategy below.
  if (opts.sma) setExecutableAccount(checksum(opts.sma));

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

  // ── Resolve which strategies to run ─────────────────────────────────────────
  let strategies: StoredStrategy[];
  if (opts.strategy) {
    const s = getStrategy(opts.strategy);
    if (!s) throw new Error(`No strategy named "${opts.strategy}". List them with \`sailor strategy list\`.`);
    strategies = [s];
  } else {
    strategies = readActiveStrategies();
    if (strategies.length === 0) {
      // Back-compat: no strategies configured → synthesize (and persist) the Default from the
      // executable/first SMA on its first deployed chain.
      const seeded = ensureDefaultStrategy(readExecutableAccount());
      if (!seeded) {
        throw new Error('No SMA to run. Create one (`sailor onboard --new-sma`) or pass --sma <address>.');
      }
      strategies = [seeded];
    }
  }

  const steps = strategies.flatMap((s) => s.pipeline.steps);
  if (steps.length === 0) {
    throw new Error(
      "No steps to run. Add one with `sailor strategy add-step` (or activate a configured strategy).",
    );
  }

  const intervalSec = (() => {
    const raw = process.env.SAILOR_INTERVAL ?? env.SAILOR_INTERVAL;
    const n = raw === undefined ? DEFAULT_INTERVAL_SEC : Number(raw);
    return Number.isNaN(n) || n <= 0 ? DEFAULT_INTERVAL_SEC : n;
  })();

  const log = (msg: string): void => {
    console.log(`[agent] ${msg}`);
    appendActivity({ ts: nowIso(), actor: "agent", type: "log", msg });
  };

  // ── Load a manager signer per distinct SMA (up front, so the passphrase can be scrubbed) ─────
  const distinctSmas = [...new Set(steps.map((s) => checksum(s.sma)))];
  const signers = new Map<string, Signer>();
  for (const safe of distinctSmas) {
    if (!keyExists("manager", safe)) {
      throw new Error(
        `No manager key for SMA ${safe}.\nRun "sailor keys generate" (agent wallet) for it first.`,
      );
    }
    signers.set(safe, await loadManagerSigner(safe));
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
      console.error(`skip ${accountAddr}: no manager signer loaded`);
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
    // RPC_URL in .sail/.env.local for production). ponytail: public default is fine for dev/first-run.
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

    const chain = defineChain({
      id: chainId,
      name: chainName,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
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

  // ── One tick: executable.tick → preview → execute → log, for one (SMA, chain) ───────────────
  async function runTick(rt: ChainRuntime, agent: Agent, envForChain: Record<string, string>): Promise<void> {
    const { accountAddr, chainId, kernel, publicClient, readClient, execClient, isConjunctive, signer, agentManager } = rt;
    appendActivity({ ts: nowIso(), actor: "agent", type: "tick_start", chainId, reason: runReason });

    let blockInfo = { number: 0n, timestamp: 0n };
    try {
      const block = await publicClient.getBlock();
      blockInfo = { number: block.number ?? 0n, timestamp: block.timestamp ?? 0n };
    } catch {
      // RPC unavailable — proceed with zeros; per-dispatch calls will surface the error
    }
    const blockNumber = blockInfo.number;

    const ctx: AgentContext = {
      safe: accountAddr,
      account: accountAddr,
      chainId,
      blockNumber,
      timestamp: Math.floor(Date.now() / 1000),
      now: new Date(),
      // Constrained client: dispatch/strategy use the exec client (wallet attached); everything else
      // uses the read-only client so agent code can't call privileged writes.
      client: Object.assign(Object.create(readClient) as typeof readClient, {
        dispatch: execClient.dispatch,
        strategy: execClient.strategy,
      }),
      publicClient,
      manager: agentManager,
      log,
      data: rt.data,
      env: envForChain,
      read: { balance: rt.readBalance, allowance: rt.readAllowance, decimals: rt.readDecimals },
    };

    let dispatches: Dispatch[];
    try {
      dispatches = await agent.tick(ctx);
    } catch (err) {
      const reason = (err as Error).message;
      console.error(`tick error: ${reason}`);
      appendActivity({ ts: nowIso(), actor: "agent", type: "error", reason, chainId });
      appendActivity({ ts: nowIso(), actor: "agent", type: "tick_end", chainId });
      return;
    }

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
          appendActivity({ ts: nowIso(), actor: "agent", type: "dispatch_denied", target, reason: "no calls" });
          tickSkipped++;
          continue;
        }
        if (registeredPermissions.length === 0) {
          appendActivity({ ts: nowIso(), actor: "agent", type: "dispatch_denied", target, reason: "no_registered_permissions" });
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
          appendActivity({ ts: nowIso(), actor: "agent", type: "dispatch_denied", target, reason: "no_permission_match" });
          console.log(`skipped: no registered permission authorizes call to ${target} (selector ${selector})`);
          tickSkipped++;
          continue;
        }

        if (!isConjunctive && dispatch.calls.length > 1) {
          const preview = await execClient.dispatch.preview(accountAddr, permission, dispatch.calls);
          if (!preview.approved) {
            const reason = preview.reason ?? "denied";
            appendActivity({ ts: nowIso(), actor: "agent", type: "dispatch_denied", permission, target, reason });
            console.log(`denied: ${reason}`);
            tickSkipped++;
            continue;
          }
        }

        const dispatchValue = await rt.describeDispatchValue(dispatch.calls);
        appendActivity({ ts: nowIso(), actor: "agent", type: "dispatch_approved", permission, target, ...dispatchValue });
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
          appendActivity({ ts: nowIso(), actor: "agent", type: "dispatch_reverted", permission, target, txHash: result.txHash, gasUsed: String(result.gasUsed), ...dispatchValue });
          console.error(`reverted: ${result.txHash}  (gas used: ${result.gasUsed})`);
          tickReverted++;
        } else {
          appendActivity({ ts: nowIso(), actor: "agent", type: "dispatch_executed", permission, target, txHash: result.txHash, ...dispatchValue });
          console.log(`executed: ${result.txHash}`);
          tickExecuted++;
        }
      } catch (err) {
        const reason = (err as Error).message;
        console.error(`dispatch error: ${reason}`);
        appendActivity({ ts: nowIso(), actor: "agent", type: "error", permission: (dispatch as RunnerDispatch).permission, target, reason });
        tickSkipped++;
      }
    }

    if (dispatches.length > 0) {
      const parts = [`${tickExecuted} executed`];
      if (tickReverted > 0) parts.push(`${tickReverted} reverted`);
      if (tickSkipped > 0) parts.push(`${tickSkipped} skipped`);
      console.log(`tick complete [${rt.chainName} · ${accountAddr.slice(0, 8)}…]: ${parts.join(", ")}`);
    }

    appendActivity({ ts: nowIso(), actor: "agent", type: "tick_end", chainId });
  }

  // Run one step (executable) across its chains, sequentially (nonce safety per SMA/chain).
  const runStep = async (step: StrategyStep): Promise<void> => {
    const agent = await loadExecutableFor(step.executable);
    for (const chainId of step.chains) {
      const rt = await getRuntime(step.sma, chainId);
      if (!rt) continue; // unrunnable (SMA, chain) already logged
      await runTick(rt, agent, readChainEnv(chainId));
    }
  };

  const runStrategy = async (strategy: StoredStrategy): Promise<void> => {
    const stps = strategy.pipeline.steps;
    if (strategy.pipeline.type === "parallel") {
      await Promise.all(stps.map((s) => runStep(s).catch((e) => console.error(`step error: ${(e as Error).message}`))));
    } else {
      for (const s of stps) {
        try {
          await runStep(s);
        } catch (e) {
          console.error(`step error: ${(e as Error).message}`);
        }
      }
    }
  };

  let stopping = false;

  const runCycle = async (): Promise<void> => {
    for (const strategy of strategies) {
      if (stopping) break;
      await runStrategy(strategy);
    }
  };

  // ── Header ────────────────────────────────────────────────────────────────────
  console.log("Sailor agent running");
  for (const s of strategies) {
    const stepDesc = s.pipeline.steps
      .map((st) => `${st.executable}@${checksum(st.sma).slice(0, 8)}…[${st.chains.join(",")}]`)
      .join(", ");
    console.log(`Strategy: ${s.name} (${s.pipeline.type}) → ${stepDesc || "(no steps)"}`);
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
      await runCycle();
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
