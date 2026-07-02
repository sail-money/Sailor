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
} from "@sail/sdk";
import { http, type Address, createPublicClient, createWalletClient, defineChain, getAddress } from "viem";
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
import { keyExists, loadManagerSigner } from "../lib/keys.js";
import {
  resolvePermissionForBatch,
  resolvePermissionForCall,
} from "../lib/permission-resolver.js";
import { clearAgentPid, writeAgentPid } from "../lib/process.js";
import type { StoredAccount, StoredMandate } from "../lib/state.js";

const DEFAULT_INTERVAL_SEC = 60;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runner-level dispatch annotation.
 *
 * Extends the SDK's `Dispatch` type with an optional `permission` override.
 * The core SDK `Dispatch` type is intentionally kept clean — this is a
 * runner-internal concern only.
 *
 * When an agent sets `permission`, the runner uses it directly and skips the
 * off-chain evaluate() probe. When absent (the default), the runner probes all
 * registered permissions automatically and routes to the correct one.
 *
 * Backward compatible: existing agents that never set `permission` continue to
 * work unchanged via the probe path.
 *
 * Example of how an agent CAN override (skip probe for a known permission):
 *   return [{ ...dispatch, permission: KNOWN_PERMISSION_ADDRESS }];
 */
type RunnerDispatch = Dispatch & { permission?: Address };

/** Minimal ERC-20 ABI fragments for read helpers. */
const ERC20_READ_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
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
 * Dynamically imports the agent from the current project.
 *
 * For .ts files: uses tsx's tsImport() which handles the .js→.ts resolution that
 * Node's native TypeScript support doesn't do. tsx must be installed in the
 * project or the CLI's node_modules.
 * For .js files: plain dynamic import().
 */
async function loadAgent(): Promise<Agent> {
  const candidates = ["src/agent.ts", "src/agent.js", "dist/agent.js", "dist/src/agent.js"];
  for (const rel of candidates) {
    const abs = path.join(process.cwd(), rel);
    if (!fs.existsSync(abs)) continue;

    let mod: { agent?: Agent; default?: Agent };
    if (abs.endsWith(".ts")) {
      // tsx resolves .js import specifiers to .ts source files — required for
      // TypeScript agents that use the standard .js extension convention.
      // Pass absUrl as both specifier and parentURL. The specifier must be a
      // file URL (not a bare path) so Windows paths like C:\... aren't
      // misread as a URL with scheme "c:". parentURL is only used to resolve
      // relative specifiers, so passing absUrl (an absolute URL) is safe.
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
    "No agent found. Expected src/agent.ts (loaded via tsx) or a built dist/agent.js.\n" +
      "If src/agent.ts exists, ensure tsx is installed: pnpm add tsx",
  );
}

/**
 * `sailor run [--once]` — the agent execution loop.
 *
 * Each tick calls agent.tick(ctx); for every returned Dispatch the runner
 * previews it against the kernel, executes approved ones, and records the
 * outcome to .sail/activity.jsonl. A denied or failing dispatch is logged and
 * skipped — it never stops the loop.
 */
export async function runCommand(opts: {
  once?: boolean;
  chain?: number;
  reason?: string;
}): Promise<void> {
  const once = opts.once === true;

  // ── Load required local state ──────────────────────────────────────────────
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (!account) {
    throw new Error('No account found at .sail/account.json.\nRun "sailor onboard --new-sma" first.');
  }
  const mandateRaw = readJsonFile<StoredMandate | StoredMandate[]>(sailPath("mandate.json"));
  const mandate = Array.isArray(mandateRaw) ? mandateRaw[0] : mandateRaw;
  if (!mandate) {
    throw new Error('No mandate found at .sail/mandate.json.\nRun "sailor mandate sign" first.');
  }

  const env = parseEnvFile(sailPath(".env.local"));

  // Inject .env.local values into process.env for anything not already set
  // by the shell. This lets operators store SAIL_PASSPHRASE in .env.local for
  // non-interactive use (CI, launchd, systemd) without having to export it in
  // the shell — useful since the file is already gitignored and keys-protected.
  // Values already set in the environment (e.g. CI secrets) take precedence.
  for (const [k, v] of Object.entries(env)) {
    if (v && !process.env[k]) process.env[k] = v;
  }

  // Observability label for WHY this run fired: --reason flag > SAIL_RUN_REASON
  // (shell or .env.local, injected above) > "manual". Recorded in the run header
  // and every tick_start event; it does NOT affect execution.
  const runReason = opts.reason ?? process.env.SAIL_RUN_REASON ?? "manual";

  // CHAIN_ID resolution order: --chain flag > shell env > .env.local > config.json chainId.
  const configChainId = readJsonFile<{ chainId?: number }>(sailPath("config.json"))?.chainId;
  const chainIdRaw = opts.chain != null
    ? String(opts.chain)
    : process.env.CHAIN_ID ?? env.CHAIN_ID ?? (configChainId != null ? String(configChainId) : undefined);
  if (!chainIdRaw) {
    throw new Error(
      "CHAIN_ID must be set in .sail/.env.local or .sail/config.json.\n" +
        "  CHAIN_ID=8453   (Base) or CHAIN_ID=42161   (Arbitrum)",
    );
  }
  const chainId = Number(chainIdRaw);
  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid CHAIN_ID: "${chainIdRaw}".`);
  }
  // RPC resolution: getRpcUrl checks named vars (BASE_RPC_URL, ARBITRUM_RPC_URL),
  // then RPC_URL_<chainId>, then generic RPC_URL — so per-chain keys always win.
  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    throw new Error(
      "RPC_URL must be set in .sail/.env.local.\n" +
        "  RPC_URL=https://your-rpc-endpoint  (or BASE_RPC_URL / RPC_URL_8453 for per-chain config)",
    );
  }

  // Validate the RPC URL to prevent SSRF attacks against internal network
  // endpoints (e.g., AWS IMDSv1 at 169.254.169.254) via a crafted .env.local.
  try {
    const parsed = new URL(rpcUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`RPC_URL must use http or https — got: ${parsed.protocol}`);
    }
    // Block RFC-1918, link-local, and loopback ranges (except explicit localhost
    // dev usage, which operators can allow by setting SAILOR_ALLOW_LOCAL_RPC=1).
    const blocked =
      /^(169\.254\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|::1$|fd[0-9a-f]{2}:)/i;
    if (blocked.test(parsed.hostname) && !process.env.SAILOR_ALLOW_LOCAL_RPC) {
      throw new Error(
        `RPC_URL hostname "${parsed.hostname}" is a private or link-local address. ` +
          "Set SAILOR_ALLOW_LOCAL_RPC=1 to allow local RPC endpoints (dev only).",
      );
    }
  } catch (e) {
    if ((e as Error).message.startsWith("RPC_URL")) throw e;
    throw new Error(`RPC_URL is not a valid URL: ${rpcUrl}`);
  }

  if (!keyExists("manager", account.safe)) {
    throw new Error(
      'No manager key found.\nRun "sailor keys generate" and choose "manager" first.',
    );
  }

  // ── Resolve kernel address (registry, overridable via env) ───────────────────
  let kernel: Address | undefined;
  let mandateFactory: Address | undefined;
  let chainName = `Chain ${chainId}`;
  try {
    const cfg = getChain(chainId);
    kernel = checksum(cfg.kernel);
    mandateFactory = checksum(cfg.mandateFactory);
    chainName = cfg.name;
  } catch {
    // chain not in the SDK chain registry — env override may still supply it
  }
  if (env.KERNEL_ADDRESS) kernel = checksum(env.KERNEL_ADDRESS);
  if (env.MANDATE_FACTORY) mandateFactory = checksum(env.MANDATE_FACTORY);
  if (!kernel) {
    throw new Error(
      `No SailKernel address for chain ${chainId}.\nConfigure the chain in the SDK chain registry or set KERNEL_ADDRESS in .sail/.env.local.`,
    );
  }

  // ── Load the manager key (SAIL_PASSPHRASE env skips interactive prompt) ──────
  const manager = await loadManagerSigner(account.safe);
  // Clear the passphrase from the process environment immediately after loading
  // the key. Agent code runs in the same process and can read process.env.
  delete process.env.SAIL_PASSPHRASE;
  closePrompts();
  const agentManager: ILocalKeyring = {
    address: manager.address,
    sign: manager.sign.bind(manager),
    signTyped: manager.signTyped.bind(manager),
  };

  // ── Build clients ────────────────────────────────────────────────────────────
  const accountAddr = checksum(account.safe);
  const chain = defineChain({
    id: chainId,
    name: chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account: manager.viemAccount,
    chain,
    transport: http(rpcUrl),
  });
  const readClient = new SailorClient({ rpcUrl, chainId, kernel, mandateFactory });
  const execClient = readClient.withSigner(walletClient);

  const agent = await loadAgent();

  // Detect the kernel's dispatch model once at startup. Conjunctive kernels have
  // no previewBatch, so the runner skips the preview step for them.
  let isConjunctive = false;
  try {
    const caps = await readClient.capabilities();
    isConjunctive = caps.dispatchModel === "conjunctive";
  } catch {
    // advisory — default to attempting preview (will throw and be caught per-dispatch)
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

  // Open data slot — seeded once from SAILOR_DATA (JSON file) if set, else {}.
  // The same object is passed every tick so agents can cache across ticks.
  // _publicClient: kept for one release so agents written against the old
  // undocumented key still work. Use ctx.publicClient instead.
  const agentData: Record<string, unknown> = {
    ...loadAgentData(process.env.SAILOR_DATA ?? env.SAILOR_DATA),
    _publicClient: publicClient,
  };

  // SMA balance reader: native ETH via getBalance, ERC-20 via balanceOf.
  const readBalance = async (token: Address | "native"): Promise<bigint> => {
    if (token === "native") {
      return publicClient.getBalance({ address: accountAddr });
    }
    return publicClient.readContract({
      address: token,
      abi: ERC20_READ_ABI,
      functionName: "balanceOf",
      args: [accountAddr],
    });
  };

  const readAllowance = (token: Address, owner: Address, spender: Address): Promise<bigint> =>
    publicClient.readContract({
      address: token,
      abi: ERC20_READ_ABI,
      functionName: "allowance",
      args: [owner, spender],
    });

  // Decimals are immutable — cache per token for the lifetime of this run.
  const decimalsCache = new Map<Address, number>();
  const readDecimals = async (token: Address): Promise<number> => {
    const key = getAddress(token);
    const cached = decimalsCache.get(key);
    if (cached !== undefined) return cached;
    const d = await publicClient.readContract({
      address: token,
      abi: ERC20_READ_ABI,
      functionName: "decimals",
    });
    decimalsCache.set(key, d);
    return d;
  };

  // ── One tick: agent.tick → preview → execute → log ───────────────────────────
  async function runTick(): Promise<void> {
    appendActivity({ ts: nowIso(), actor: "agent", type: "tick_start", chainId, reason: runReason });

    // Fetch the current block once per tick. Real block number + timestamp are used
    // in the off-chain evaluate() probe so time- or block-gated permissions get
    // accurate context and don't produce false negatives.
    let blockInfo = { number: 0n, timestamp: 0n };
    try {
      const block = await publicClient.getBlock();
      blockInfo = {
        number:    block.number    ?? 0n,
        timestamp: block.timestamp ?? 0n,
      };
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
      // Expose a constrained client to agent code: dispatch and strategy namespaces
      // use the exec client (wallet attached) so agents can sign dispatches, but
      // fees, principal, account, mandate, and session use the read-only client
      // (no wallet) so agent code cannot call fees.collect(), account.create(),
      // or other privileged write operations that bypass the dispatch gate and
      // are authorized solely by msg.sender == manager key.
      client: Object.assign(Object.create(readClient) as typeof readClient, {
        dispatch: execClient.dispatch,
        strategy: execClient.strategy,
      }),
      publicClient,
      manager: agentManager,
      log,
      data: agentData,
      read: {
        balance: readBalance,
        allowance: readAllowance,
        decimals: readDecimals,
      },
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

    // ── Per-tick setup for permission resolution ────────────────────────────────
    // Fetch registered permissions once per tick (one eth_call). Registration
    // order is preserved — first-by-registration-order wins when two permissions
    // both accept a call (intentional, deterministic behaviour).
    let registeredPermissions: Address[] = [];
    try {
      const perms = await readClient.mandate.list(accountAddr);
      registeredPermissions = perms.map((m) => m.permission);
    } catch (err) {
      console.error(`could not read registered permissions: ${(err as Error).message}`);
    }

    // ── Dispatch loop ───────────────────────────────────────────────────────────
    let tickExecuted = 0;
    let tickReverted = 0;
    let tickSkipped  = 0;

    for (const rawDispatch of dispatches) {
      // Cast to RunnerDispatch so agents can optionally annotate with a
      // `permission` override without the core SDK type needing to change.
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

        // ── Resolve the authorising permission ────────────────────────────────
        //
        // PRIMARY PATH — off-chain evaluate() probe: iterate each registered
        //   permission in registration order, call evaluate(txData, ctx) via
        //   eth_call, use the first that returns true. Requires zero protocol
        //   knowledge from the agent; the runner finds the correct permission
        //   automatically.
        //
        // OVERRIDE — if the agent set `dispatch.permission`, use it directly and
        //   skip the probe. This is an optimisation/escape hatch, not the
        //   recommended path — probe-primary is the default everyone gets.
        //
        // Registration-order first-match for overlapping permissions is
        // intentional: deterministic, documented, and semantically equivalent
        // since the kernel's selective model accepts any registered permission
        // that approves the call.
        let permission: Address | undefined;

        if (dispatch.permission) {
          // Agent-supplied explicit override — skip probe.
          permission = dispatch.permission;
        } else if (dispatch.calls.length > 1) {
          // Batch dispatch: find a batch-aware permission that accepts the whole
          // call sequence. Uses kernel.previewBatch (eth_call) per candidate.
          permission = await resolvePermissionForBatch({
            publicClient,
            kernel: kernel!, // narrowed: runCommand validates kernel before runTick runs
            account:               accountAddr,
            calls:                 dispatch.calls,
            registeredPermissions,
          });
        } else {
          // Single-call dispatch: find a permission whose evaluate() accepts it.
          permission = await resolvePermissionForCall({
            publicClient,
            kernel: kernel!, // narrowed: runCommand validates kernel before runTick runs
            account:               accountAddr,
            manager:               agentManager.address,
            call:                  firstCall as NonNullable<typeof firstCall>,
            registeredPermissions,
            blockInfo,
          });
        }

        // ── No matching permission → skip, do NOT kill the tick ───────────────
        if (!permission) {
          const selector =
            firstCall?.data && firstCall.data.length >= 10
              ? firstCall.data.slice(0, 10)
              : "0x";
          appendActivity({
            ts:     nowIso(),
            actor:  "agent",
            type:   "dispatch_denied",
            target,
            reason: "no_permission_match",
          });
          console.log(
            `skipped: no registered permission authorizes call to ${target} (selector ${selector})`,
          );
          // Phase 4 hook: sailor status / dashboard can surface no_permission_match
          // entries from activity.jsonl to make dropped calls visible in the UI.
          tickSkipped++;
          continue;
        }

        // ── Preview (batch only, selective kernel) ────────────────────────────
        // Conjunctive kernels have no previewBatch. For batch dispatches on
        // selective kernels, previewBatch validates the full call sequence before
        // submitting. Single-call dispatches skip preview — previewBatch would
        // spuriously deny valid IPermission contracts (PermissionNotBatchAware).
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

        // ── Execute ───────────────────────────────────────────────────────────
        appendActivity({ ts: nowIso(), actor: "agent", type: "dispatch_approved", permission, target });
        const result =
          dispatch.calls.length > 1
            ? await execClient.dispatch.batch(accountAddr, permission, dispatch.calls, manager)
            : await execClient.dispatch.single(
                accountAddr,
                permission,
                firstCall as NonNullable<typeof firstCall>,
                manager,
              );

        // On conjunctive kernels each dispatch is a separate on-chain tx and
        // nonces are consumed sequentially. dispatch.single already awaits the
        // receipt internally and bumps its nonce cache, but on a load-balanced
        // RPC the nonce view can lag. Waiting here guarantees the on-chain nonce
        // is definitively consumed before the next dispatch is signed, preventing
        // "replacement transaction underpriced" errors between sequential intents.
        // Selective kernels use dispatchBatch (handled above) so this is skipped.
        if (isConjunctive && result.txHash) {
          try {
            await publicClient.waitForTransactionReceipt({ hash: result.txHash, timeout: 30_000 });
            // Brief pause for RPC nonce propagation on load-balanced endpoints.
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch {
            // receipt already confirmed by dispatch.single — this is belt-and-suspenders
          }
        }

        if (!result.success) {
          appendActivity({ ts: nowIso(), actor: "agent", type: "dispatch_reverted", permission, target, txHash: result.txHash, gasUsed: String(result.gasUsed) });
          console.error(`reverted: ${result.txHash}  (gas used: ${result.gasUsed})`);
          tickReverted++;
        } else {
          appendActivity({ ts: nowIso(), actor: "agent", type: "dispatch_executed", permission, target, txHash: result.txHash });
          console.log(`executed: ${result.txHash}`);
          tickExecuted++;
        }

      } catch (err) {
        // One failed dispatch must not stop the loop.
        // enrichKernelRevert (called inside dispatch.single/batch) already decodes
        // kernel error selectors (InvalidManagerSignature, PermissionDenied, etc.)
        // into human-readable messages, so err.message surfaces the root cause.
        const reason = (err as Error).message;
        console.error(`dispatch error: ${reason}`);
        appendActivity({ ts: nowIso(), actor: "agent", type: "error", permission: (dispatch as RunnerDispatch).permission, target, reason });
        tickSkipped++;
      }
    }

    // ── Tick summary ──────────────────────────────────────────────────────────
    if (dispatches.length > 0) {
      const parts = [`${tickExecuted} executed`];
      if (tickReverted > 0) parts.push(`${tickReverted} reverted`);
      if (tickSkipped > 0) parts.push(`${tickSkipped} skipped`);
      console.log(`tick complete: ${parts.join(", ")}`);
    }

    appendActivity({ ts: nowIso(), actor: "agent", type: "tick_end", chainId });
  }

  // ── Header ────────────────────────────────────────────────────────────────────
  console.log("Sailor agent running");
  console.log(`Account: ${accountAddr}`);
  console.log(`Chain: ${chainName} (${chainId})`);
  console.log(once ? "Mode: single tick (--once)" : `Interval: ${intervalSec}s`);
  console.log(`Reason: ${runReason}`);
  console.log("Press Ctrl+C to stop");
  console.log("");

  // ── PID file + clean shutdown ───────────────────────────────────────────────
  writeAgentPid(chainId);
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    console.log("\nStopping agent…");
    clearAgentPid(chainId);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // ── Run ──────────────────────────────────────────────────────────────────────
  try {
    if (once) {
      await runTick();
      return;
    }
    while (!stopping) {
      await runTick();
      if (stopping) break;
      await sleep(intervalSec * 1000);
    }
  } finally {
    clearAgentPid(chainId);
  }
}
