import type { EncryptedKeystore } from "@sail/sdk";
import {
  SAFE_V141,
  SailorClient,
  sailDeployments,
  safeProxyFactoryAbi,
  type SailChainId,
} from "@sail/sdk";
import { buildSmaAddressPrediction } from "./account.js";
import {
  http,
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  formatEther,
  getAddress,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { checkContractExists } from "../lib/contract-check.js";
import { readJsonFile, sailPath } from "../lib/io.js";
import { keyExists, resolveKeyPath } from "../lib/keys.js";
import { IPERMISSION_ABI } from "../lib/permission-resolver.js";
import { ProjectContext } from "../lib/project.js";
import type { StoredAccount } from "../lib/state.js";

// "Low gas" is chain-relative: an L1 dispatch can cost 100× an L2 one, so a
// balance that is comfortable on Base would be near-empty on Ethereum. A single
// flat threshold over-warns on L2 (a fraction of a cent of gas trips it) — so
// gate on how the chain prices gas, not on mainnet-vs-testnet. Chains that bill
// L1-style gas get the high bar (including Ethereum Sepolia, an L1 testnet);
// L2s — mainnet and testnet alike (Base, Base Sepolia, Arbitrum, Unichain) —
// get a much lower one.
const LOW_GAS_THRESHOLD_L1_WEI = 5_000_000_000_000_000n; // ~0.005 ETH — a few L1 dispatches
const LOW_GAS_THRESHOLD_L2_WEI = 200_000_000_000_000n; //  ~0.0002 ETH — many L2 dispatches

/** Chains that price gas like Ethereum L1 (mainnet + Sepolia); everything else is an L2. */
const L1_GAS_CHAINS = new Set<number>([1, 11155111]);

function lowGasThresholdWei(chainId: number): bigint {
  return L1_GAS_CHAINS.has(chainId) ? LOW_GAS_THRESHOLD_L1_WEI : LOW_GAS_THRESHOLD_L2_WEI;
}

type BalanceInfo = { address: Address; wei: string; eth: string; funded: boolean; low: boolean };

async function nativeBalance(
  pc: PublicClient,
  address: Address,
  chainId: number,
): Promise<BalanceInfo> {
  const wei = await pc.getBalance({ address });
  return {
    address,
    wei: wei.toString(),
    eth: formatEther(wei),
    funded: wei > 0n,
    low: wei > 0n && wei < lowGasThresholdWei(chainId),
  };
}

/** Read a keystore's address without decrypting it (for read-only reporting). */
function keystoreAddress(role: "manager" | "permissionSigner", safe?: string): Address | null {
  const ks = readJsonFile<EncryptedKeystore>(resolveKeyPath(role, safe));
  return ks?.address ? getAddress(`0x${ks.address.replace(/^0x/, "")}`) : null;
}

// A deliberately "unrelated" call: an unknown selector to a neutral target. A
// well-behaved permission must pass through (return true) for calls outside its
// own domain — on a conjunctive kernel, returning false here bricks EVERY dispatch.
const PROBE_TARGET = "0x000000000000000000000000000000000000dEaD" as Address;
const PROBE_SELECTOR = "0xffffffff" as const;
const PROBE_DATA = "0xffffffff" as const;

type PermCheck = { permission: Address; passesThrough: boolean | null; note?: string };

async function probePassThrough(
  pc: PublicClient,
  permission: Address,
  account: Address,
): Promise<PermCheck> {
  try {
    const ok = (await pc.readContract({
      address: permission,
      abi: IPERMISSION_ABI,
      functionName: "evaluate",
      args: [
        PROBE_DATA,
        {
          account,
          manager: account,
          submitter: account,
          target: PROBE_TARGET,
          selector: PROBE_SELECTOR,
          value: 0n,
          blockTimestamp: 0n,
          blockNumber: 0n,
          // Pass-through probes only run on conjunctive kernels, which predate
          // registrationEpoch — there is no live epoch to read, so probe with 0.
          configEpoch: 0n,
        },
      ],
    })) as boolean;
    return { permission, passesThrough: ok };
  } catch (err) {
    // A revert / gas overage is treated as `false` by the kernel — same effect.
    return {
      permission,
      passesThrough: false,
      note: `evaluate reverted (${(err as Error).message.split("\n")[0]})`,
    };
  }
}

/** True if an RPC error looks like rate-limiting (HTTP 429 / "too many requests"). */
function isRateLimit(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    (err as { status?: number } | null)?.status === 429
  );
}

/**
 * Report an RPC failure as a short, actionable message and exit — never let the
 * raw viem error (request body, ABI args, docs URL) reach the user. Tailors the
 * guidance to whether they're on a configured RPC or the rate-limited public
 * fallback (no RPC_URL set).
 */
function rpcFailure(
  err: unknown,
  ctx: { chainId: number; rpcUrl: string; usingDefaultRpc: boolean; json: boolean },
): never {
  const reason = isRateLimit(err)
    ? "rate-limited (HTTP 429)"
    : (err instanceof Error ? err.message.split("\n")[0] : String(err));
  const fix = ctx.usingDefaultRpc
    ? "No RPC_URL is configured, so doctor used the public fallback — which throttles aggressively. Set a dedicated endpoint in .sail/.env.local:\n  RPC_URL=https://your-endpoint"
    : "Check RPC_URL in .sail/.env.local (endpoint reachable, not rate-limited, serves this chain).";
  if (ctx.json) {
    console.log(
      JSON.stringify({ status: "error", error: "rpc_unreachable", reason, chainId: ctx.chainId }),
    );
  } else {
    console.error(`✗ Could not reach the RPC for chain ${ctx.chainId} — ${reason}.\n\n${fix}`);
  }
  process.exit(1);
}

/**
 * `sailor doctor` — read-only, gas-free preflight before dispatching:
 *  - detects the kernel's dispatch model (conjunctive vs selective),
 *  - lists the SMA's registered permissions,
 *  - on a conjunctive kernel, flags any permission that does NOT pass through
 *    unrelated calls (which would brick every dispatch).
 */
export async function doctor(options: { json?: boolean; account?: string } = {}): Promise<void> {
  const project = new ProjectContext();
  const chainId = project.chainId;
  const kernel = project.contracts.kernel;
  const configuredRpc = getRpcUrl(chainId);
  const rpcUrl = configuredRpc ?? getChainById(chainId).rpcUrls.default.http[0];
  const usingDefaultRpc = !configuredRpc;

  const client = new SailorClient({ chainId, rpcUrl, kernel });
  const pc = createPublicClient({ chain: getChainById(chainId), transport: http(rpcUrl) });

  // First on-chain contact. If the RPC is unreachable or rate-limited (common on
  // the public fallback when no RPC_URL is set), surface a one-line, actionable
  // message instead of dumping the raw viem error (request body, ABI, docs link).
  let caps: Awaited<ReturnType<typeof client.capabilities>>;
  try {
    caps = await client.capabilities();
  } catch (err) {
    rpcFailure(err, { chainId, rpcUrl, usingDefaultRpc, json: !!options.json });
  }

  // Resolve the SMA: --account flag, else .sail/account.json.
  const stored = readJsonFile<StoredAccount>(sailPath("account.json"));
  const safe = options.account
    ? getAddress(options.account)
    : stored?.safe
      ? getAddress(stored.safe)
      : null;

  let permissions: Address[] = [];
  let checks: PermCheck[] = [];
  // Lean contract-existence check: a registered permission address with no
  // bytecode (e.g. self-destructed, or a stale/wrong local record) would deny or
  // brick dispatches. This only asks "is there a contract here" — it does NOT
  // inspect the permission's internal target addresses (those are not generically
  // introspectable; see `sailor mandate simulate` for sample-call target checks).
  let permsNoCode: Address[] = [];
  if (safe) {
    let mandates: Awaited<ReturnType<typeof client.mandate.list>>;
    try {
      mandates = await client.mandate.list(safe);
    } catch (err) {
      rpcFailure(err, { chainId, rpcUrl, usingDefaultRpc, json: !!options.json });
    }
    permissions = mandates.map((m) => getAddress(m.permission));
    if (permissions.length > 0) {
      const codeChecks = await Promise.all(permissions.map((p) => checkContractExists(pc, p)));
      permsNoCode = codeChecks.filter((c) => !c.hasCode && !c.error).map((c) => c.address);
    }
    if (caps.dispatchModel === "conjunctive" && permissions.length > 0) {
      checks = await Promise.all(permissions.map((p) => probePassThrough(pc, p, safe)));
    }
  }

  const bricking = checks.filter((c) => c.passesThrough === false);
  const healthy = safe !== null && bricking.length === 0;

  // ── Live wallet / gas / RPC preflight (always, even pre-onboarding) ──────────
  // capabilities() already proved the RPC is reachable; verify it serves the
  // configured chain, and report owner + manager gas balances.
  const ownerAddr = stored?.owner ? getAddress(stored.owner) : project.getOwner();
  const managerAddr = stored?.manager
    ? getAddress(stored.manager)
    : keystoreAddress("manager", stored?.safe);

  let chainIdOnChain: number | null = null;
  try {
    chainIdOnChain = await pc.getChainId();
  } catch {
    // RPC hiccup on the id read — leave null; capabilities() above still succeeded.
  }
  const chainIdMatches = chainIdOnChain === null ? null : chainIdOnChain === chainId;

  // Passphrase readiness: a local agent keystore that nothing can unlock
  // non-interactively (SAIL_PASSPHRASE unset) is the #1 reason `sailor run` works
  // locally but the CI cron fails. Flag it here, before any gas is spent.
  const managerKeystorePresent = keyExists("manager", stored?.safe);
  const passphraseSet = Boolean(process.env.SAIL_PASSPHRASE);
  const passphraseGap = managerKeystorePresent && !passphraseSet;

  let ownerBal: BalanceInfo | null = null;
  let managerBal: BalanceInfo | null = null;
  try {
    if (ownerAddr) ownerBal = await nativeBalance(pc, ownerAddr, chainId);
    if (managerAddr) managerBal = await nativeBalance(pc, managerAddr, chainId);
  } catch {
    // Balance reads are best-effort; a failure shouldn't abort the preflight.
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          chainId,
          kernel,
          dispatchModel: caps.dispatchModel,
          dispatchTypehash: caps.dispatchTypehash,
          capabilitySource: caps.source,
          rpc: { chainIdOnChain, chainIdMatches },
          wallet: {
            owner: ownerAddr ? { address: ownerAddr, ...(ownerBal ?? {}) } : null,
            manager: managerAddr ? { address: managerAddr, ...(managerBal ?? {}) } : null,
          },
          passphrase: { keystorePresent: managerKeystorePresent, envSet: passphraseSet },
          account: safe,
          saltNonce: stored?.saltNonce ?? null,
          permissions,
          permissionsWithoutCode: permsNoCode,
          conjunctivePassThrough:
            caps.dispatchModel === "conjunctive"
              ? checks.map((c) => ({
                  permission: c.permission,
                  passesThrough: c.passesThrough,
                  note: c.note,
                }))
              : "n/a (selective kernel)",
          healthy,
        },
        null,
        2,
      ),
    );
    return;
  }

  // ── Plain-English summary (printed first, before technical details) ──────────
  // Only warn about bricking when multiple permissions are registered: a SINGLE
  // non-pass-through permission on a conjunctive kernel is expected behavior —
  // it restricts the SMA to exactly the calls it was designed for.
  const multiBricking = bricking.length > 0 && permissions.length > 1;

  if (!safe) {
    console.log("✗ Setup incomplete — no SMA found. Run \"sailor onboard --new-sma\" to deploy one.");
  } else if (permissions.length === 0) {
    console.log("✗ Setup incomplete — no permissions registered. Your agent cannot dispatch until at least one permission is attached.");
  } else if (multiBricking) {
    console.log(`✗ Setup issue — ${bricking.length} of ${permissions.length} permissions block unrelated calls (see below).`);
  } else {
    console.log(
      "✓ Everything looks good — your SMA is deployed, your permission is registered,\n" +
        "  and your agent is authorized to dispatch.",
    );
  }
  console.log("────────────────────────────────────────");
  console.log(`Chain:   ${chainId}`);
  console.log(`Kernel:  ${kernel}`);
  console.log(`  dispatch model:  ${caps.dispatchModel}  (detected via ${caps.source})`);
  console.log(`  DISPATCH_TYPEHASH: ${caps.dispatchTypehash}`);

  // ── Wallet & gas ────────────────────────────────────────────────────────────
  console.log("\nWallet & gas:");
  if (chainIdMatches === false) {
    console.log(
      `  ✗ RPC serves chain ${chainIdOnChain}, but the project is configured for ${chainId}. ` +
        "Fix RPC_URL in .sail/.env.local before doing anything.",
    );
  } else if (chainIdMatches === true) {
    console.log(`  ✓ RPC serves the configured chain (${chainId}).`);
  }
  const showBalance = (label: string, addr: Address | null, bal: BalanceInfo | null): void => {
    if (!addr) {
      console.log(`  ${label}: not set`);
      return;
    }
    if (!bal) {
      console.log(`  ${label}: ${addr}  (balance unavailable)`);
      return;
    }
    const flag = !bal.funded ? "✗ unfunded" : bal.low ? "⚠ low" : "✓";
    console.log(`  ${label}: ${addr}  ${bal.eth} ETH  ${flag}`);
  };
  showBalance("owner  ", ownerAddr, ownerBal);
  showBalance("manager", managerAddr, managerBal);
  if (managerBal && !managerBal.funded) {
    console.log(
      '  → The manager (agent) pays gas. Fund it before "sailor run" or dispatches fail.',
    );
  }
  if (passphraseGap) {
    console.log(
      "  ⚠ SAIL_PASSPHRASE is not set, but an agent keystore exists.\n" +
        '    "sailor run" will prompt interactively; CI and the scheduled cron will fail to unlock it.\n' +
        "    Add SAIL_PASSPHRASE to .sail/.env.local (the dashboard does this automatically when it creates the key).",
    );
  }

  if (!safe) {
    console.log("\nAccount: none found. Run \"sailor onboard --new-sma\", or pass --account <addr>.");
    console.log("Skipping permission checks.");
    return;
  }
  console.log(`Account: ${safe}`);

  // ── Multi-chain SMA addresses (shown when saltNonce is stored) ───────────────
  if (stored?.saltNonce != null) {
    const saltNonce = BigInt(stored.saltNonce);
    const MAINNET_CHAINS: SailChainId[] = [1, 8453, 42161, 10, 130, 56, 480, 999, 4326];
    try {
      const proxyCreationCode = (await pc.readContract({
        address: SAFE_V141.proxyFactory as Address,
        abi: safeProxyFactoryAbi,
        functionName: "proxyCreationCode",
      })) as Hex;
      const ownerAddr = stored.owner ? getAddress(stored.owner) : null;
      const managerAddr = stored.manager ? getAddress(stored.manager) : null;
      if (ownerAddr && managerAddr) {
        console.log(
          `\nMulti-chain addresses (salt ${saltNonce}, owner ${ownerAddr}, manager ${managerAddr}):`,
        );
        const CHAIN_NAMES: Record<number, string> = { 1: "Ethereum", 8453: "Base", 42161: "Arbitrum", 130: "Unichain" };
        const deployedChains = new Set([
          stored.chainId,
          ...(stored.deployedChains ?? []),
        ]);
        const predictions: string[] = [];
        for (const cid of MAINNET_CHAINS) {
          const dep = sailDeployments[cid];
          const { predicted } = buildSmaAddressPrediction(
            dep,
            ownerAddr,
            managerAddr,
            saltNonce,
            proxyCreationCode,
          );
          predictions.push(predicted.toLowerCase());
          // isPrimary: chain matches stored primary AND address matches — AND we are
          // not inspecting a different SMA via --account (safe !== stored.safe).
          const isPrimary =
            cid === stored.chainId &&
            predicted.toLowerCase() === stored.safe.toLowerCase() &&
            (safe == null || safe.toLowerCase() === stored.safe.toLowerCase());
          const isRecorded = deployedChains.has(cid);
          const label = isPrimary
            ? "deployed (this account)"
            : isRecorded
              ? `${predicted}  ✓ deployed (recorded)`
              : predicted;
          console.log(`  ${CHAIN_NAMES[cid].padEnd(12)} (${cid}):  ${label}`);
        }
        // With CREATE2 deterministic deployment (same kernel, safeModuleEnabler, and
        // standardFeePolicy on every chain), this set should always be size 1. If it is
        // ever >1, the same-address invariant has been broken — kept as a regression guard.
        if (new Set(predictions).size === 1) {
          console.log("  ✓ Same address on all chains — cross-chain SMA deployment is live.");
        } else {
          console.log('  ⚠  Addresses differ per chain. Run "sailor account predict" for details.');
        }
      }
    } catch {
      // Multi-chain section is best-effort — don't block the rest of doctor if it fails.
    }
  } else if (stored) {
    console.log(
      "\nMulti-chain addresses: saltNonce not stored (deployed before salt tracking).",
    );
    console.log("  To enable: re-deploy with sailor onboard --new-sma --salt 0");
  }

  if (permissions.length === 0) {
    console.log(
      "\n⚠ No permissions registered — every dispatch will be denied (NoPermissionsRegistered).",
    );
    console.log('  Register at least one with "sailor mandate attach".');
    return;
  }

  console.log(`\nRegistered permissions (${permissions.length}):`);
  if (permsNoCode.length > 0) {
    console.log(
      `\n⚠ ${permsNoCode.length} registered permission(s) have NO contract code on chain ${chainId} — ` +
        "dispatches naming them will fail. Verify the address (wrong chain?) or revoke:",
    );
    permsNoCode.forEach((p) => console.log(`    ${p}`));
  }
  if (caps.dispatchModel === "selective") {
    permissions.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log("\nEach dispatch names one permission, so pass-through is not required.");
    return;
  }

  // Conjunctive: report the pass-through probe per permission.
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const mark = c.passesThrough ? "✓ pass-through" : "✗ NOT pass-through";
    console.log(`  ${i + 1}. ${c.permission}  ${mark}${c.note ? `  (${c.note})` : ""}`);
  }

  if (multiBricking) {
    // Only warn when multiple permissions are present. A single non-pass-through
    // permission is correct — it restricts the SMA to its designed calls only.
    console.log(
      `\n✗ ${bricking.length} permission(s) return false for unrelated calls. On this ` +
        "kernel EVERY registered permission must approve EVERY call, so these BRICK all dispatches " +
        "(they surface as PermissionDenied). Revoke or replace them with pass-through versions:",
    );
    bricking.forEach((c) => console.log(`    ${c.permission}`));
  } else if (permissions.length > 1) {
    console.log("\n✓ All permissions pass through unrelated calls — dispatch will not be bricked.");
  }
  // Single permission: no pass-through note needed (correct by design)
  console.log(`\nProbe is heuristic: an unknown selector (${PROBE_SELECTOR}) to a neutral target (${PROBE_TARGET}).`);
}
