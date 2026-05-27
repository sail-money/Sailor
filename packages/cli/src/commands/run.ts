import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getChain } from "@sail/chains";
import { type Agent, type AgentContext, type Dispatch, SailorClient } from "@sail/sdk";
import { type Address, createPublicClient, createWalletClient, defineChain, http } from "viem";
import {
  appendActivity,
  checksum,
  closePrompts,
  nowIso,
  parseEnvFile,
  readJsonFile,
  sailPath,
} from "../lib/io.js";
import { keyExists, loadKeyring } from "../lib/keys.js";
import { clearAgentPid, writeAgentPid } from "../lib/process.js";
import type { StoredAccount, StoredMandate } from "../lib/state.js";

const DEFAULT_INTERVAL_SEC = 60;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal ERC-20 ABI fragment for reading a token balance. */
const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
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

/** Dynamically imports the agent from the current project (tsx/ts-node for .ts, or a built .js). */
async function loadAgent(): Promise<Agent> {
  const candidates = ["src/agent.ts", "src/agent.js", "dist/agent.js", "dist/src/agent.js"];
  for (const rel of candidates) {
    const abs = path.join(process.cwd(), rel);
    if (!fs.existsSync(abs)) continue;
    const mod = (await import(pathToFileURL(abs).href)) as {
      agent?: Agent;
      default?: Agent;
    };
    const agent = mod.agent ?? mod.default;
    if (!agent || typeof agent.tick !== "function") {
      throw new Error(`${rel} does not export an \`agent\` with a tick() function.`);
    }
    return agent;
  }
  throw new Error(
    "No agent found. Expected src/agent.ts (run under tsx) or a built dist/agent.js.",
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
export async function runCommand(opts: { once?: boolean }): Promise<void> {
  const once = opts.once === true;

  // ── Load required local state ──────────────────────────────────────────────
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (!account) {
    throw new Error('No account found at .sail/account.json.\nRun "sailor account create" first.');
  }
  const mandate = readJsonFile<StoredMandate>(sailPath("mandate.json"));
  if (!mandate) {
    throw new Error('No mandate found at .sail/mandate.json.\nRun "sailor mandate sign" first.');
  }

  const env = parseEnvFile(sailPath(".env.local"));
  const rpcUrl = env["RPC_URL"] ?? process.env["RPC_URL"];
  const chainIdRaw = env["CHAIN_ID"] ?? process.env["CHAIN_ID"];
  if (!rpcUrl || !chainIdRaw) {
    throw new Error(
      "RPC_URL and CHAIN_ID must be set in .sail/.env.local.\n" +
        "  RPC_URL=https://your-rpc-endpoint\n  CHAIN_ID=8453",
    );
  }
  const chainId = Number(chainIdRaw);
  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid CHAIN_ID: "${chainIdRaw}".`);
  }

  if (!keyExists("manager")) {
    throw new Error('No manager key found.\nRun "sailor keys generate" and choose "manager" first.');
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
    // chain not in @sail/chains registry — env override may still supply it
  }
  if (env["KERNEL_ADDRESS"]) kernel = checksum(env["KERNEL_ADDRESS"]);
  if (env["MANDATE_FACTORY"]) mandateFactory = checksum(env["MANDATE_FACTORY"]);
  if (!kernel) {
    throw new Error(
      `No SailKernel address for chain ${chainId}.\n` +
        "Configure the chain in @sail/chains or set KERNEL_ADDRESS in .sail/.env.local.",
    );
  }

  // ── Load the manager key (password asked once, then release stdin) ───────────
  const manager = await loadKeyring("manager");
  closePrompts();

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

  const intervalSec = (() => {
    const raw = env["SAILOR_INTERVAL"] ?? process.env["SAILOR_INTERVAL"];
    const n = raw === undefined ? DEFAULT_INTERVAL_SEC : Number(raw);
    return Number.isNaN(n) || n <= 0 ? DEFAULT_INTERVAL_SEC : n;
  })();

  const log = (msg: string): void => {
    console.log(`[agent] ${msg}`);
    appendActivity({ ts: nowIso(), type: "log", msg });
  };

  // Open data slot — seeded once from SAILOR_DATA (JSON file) if set, else {}.
  // The same object is passed every tick so agents can cache across ticks.
  const agentData = loadAgentData(env["SAILOR_DATA"] ?? process.env["SAILOR_DATA"]);

  // SMA balance reader: native ETH via getBalance, ERC-20 via balanceOf.
  const readBalance = async (token: Address | "native"): Promise<bigint> => {
    if (token === "native") {
      return publicClient.getBalance({ address: accountAddr });
    }
    return publicClient.readContract({
      address: token,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [accountAddr],
    });
  };

  // ── One tick: agent.tick → preview → execute → log ───────────────────────────
  async function runTick(): Promise<void> {
    appendActivity({ ts: nowIso(), type: "tick_start" });

    let blockNumber = 0n;
    try {
      blockNumber = await publicClient.getBlockNumber();
    } catch {
      // RPC unavailable — proceed with blockNumber 0; per-dispatch calls will surface the error
    }

    const ctx: AgentContext = {
      safe: accountAddr,
      account: accountAddr,
      chainId,
      blockNumber,
      timestamp: Math.floor(Date.now() / 1000),
      now: new Date(),
      client: readClient,
      manager,
      log,
      data: agentData,
      read: { balance: readBalance },
    };

    let dispatches: Dispatch[];
    try {
      dispatches = await agent.tick(ctx);
    } catch (err) {
      const reason = (err as Error).message;
      console.error(`tick error: ${reason}`);
      appendActivity({ ts: nowIso(), type: "error", reason });
      appendActivity({ ts: nowIso(), type: "tick_end" });
      return;
    }

    if (dispatches.length > 0) {
      // Dispatch carries no permission, so resolve it from the account's
      // on-chain registered permissions (first registered permission).
      let permission: Address | undefined;
      try {
        const perms = await readClient.mandate.list(accountAddr);
        permission = perms[0]?.permission;
      } catch (err) {
        console.error(`could not read registered permissions: ${(err as Error).message}`);
      }

      for (const dispatch of dispatches) {
        const [firstCall] = dispatch.calls;
        const target = firstCall?.target ?? "0x";
        try {
          if (dispatch.calls.length === 0) {
            appendActivity({ ts: nowIso(), type: "dispatch_denied", target, reason: "no calls" });
            continue;
          }
          if (!permission) {
            appendActivity({
              ts: nowIso(),
              type: "dispatch_denied",
              target,
              reason: "no registered permission",
            });
            console.log("denied: no registered permission");
            continue;
          }

          const preview = await execClient.dispatch.preview(accountAddr, permission, dispatch.calls);
          if (!preview.approved) {
            const reason = preview.reason ?? "denied";
            appendActivity({ ts: nowIso(), type: "dispatch_denied", permission, target, reason });
            console.log(`denied: ${reason}`);
            continue;
          }

          appendActivity({ ts: nowIso(), type: "dispatch_approved", permission, target });
          const result =
            dispatch.calls.length > 1
              ? await execClient.dispatch.batch(accountAddr, permission, dispatch.calls, manager)
              : await execClient.dispatch.single(
                  accountAddr,
                  permission,
                  firstCall as NonNullable<typeof firstCall>,
                  manager,
                );
          appendActivity({
            ts: nowIso(),
            type: "dispatch_executed",
            permission,
            target,
            txHash: result.txHash,
          });
          console.log(`executed: ${result.txHash}`);
        } catch (err) {
          // One failed dispatch must not stop the loop.
          const reason = (err as Error).message;
          console.error(`dispatch error: ${reason}`);
          appendActivity({ ts: nowIso(), type: "error", permission, target, reason });
        }
      }
    }

    appendActivity({ ts: nowIso(), type: "tick_end" });
  }

  // ── Header ────────────────────────────────────────────────────────────────────
  console.log("Sailor agent running");
  console.log(`Account: ${accountAddr}`);
  console.log(`Chain: ${chainName} (${chainId})`);
  console.log(once ? "Mode: single tick (--once)" : `Interval: ${intervalSec}s`);
  console.log("Press Ctrl+C to stop");
  console.log("");

  // ── PID file + clean shutdown ───────────────────────────────────────────────
  writeAgentPid();
  let stopping = false;
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
      await runTick();
      return;
    }
    while (!stopping) {
      await runTick();
      if (stopping) break;
      await sleep(intervalSec * 1000);
    }
  } finally {
    clearAgentPid();
  }
}
