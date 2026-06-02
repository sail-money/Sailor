import type { EncryptedKeystore } from "@sail/sdk";
import { SailorClient } from "@sail/sdk";
import {
  http,
  type Address,
  type PublicClient,
  createPublicClient,
  formatEther,
  getAddress,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { readJsonFile, sailPath } from "../lib/io.js";
import { resolveKeyPath } from "../lib/keys.js";
import { ProjectContext } from "../lib/project.js";
import type { StoredAccount } from "../lib/state.js";

/** Native balance, considered enough to submit a few dispatches, in wei (~0.0005 ETH). */
const LOW_GAS_THRESHOLD_WEI = 500_000_000_000_000n;

type BalanceInfo = { address: Address; wei: string; eth: string; funded: boolean; low: boolean };

async function nativeBalance(pc: PublicClient, address: Address): Promise<BalanceInfo> {
  const wei = await pc.getBalance({ address });
  return {
    address,
    wei: wei.toString(),
    eth: formatEther(wei),
    funded: wei > 0n,
    low: wei > 0n && wei < LOW_GAS_THRESHOLD_WEI,
  };
}

/** Read a keystore's address without decrypting it (for read-only reporting). */
function keystoreAddress(role: "manager" | "permissionSigner", safe?: string): Address | null {
  const ks = readJsonFile<EncryptedKeystore>(resolveKeyPath(role, safe));
  return ks?.address ? getAddress(`0x${ks.address.replace(/^0x/, "")}`) : null;
}

/**
 * Minimal IPermission ABI for the read-only pass-through probe. The Context tuple
 * mirrors SailProtocol's `Context` struct field order exactly.
 */
const IPERMISSION_ABI = [
  {
    type: "function",
    name: "evaluate",
    stateMutability: "view",
    inputs: [
      { name: "txData", type: "bytes" },
      {
        name: "ctx",
        type: "tuple",
        components: [
          { name: "account", type: "address" },
          { name: "manager", type: "address" },
          { name: "submitter", type: "address" },
          { name: "target", type: "address" },
          { name: "selector", type: "bytes4" },
          { name: "value", type: "uint256" },
          { name: "blockTimestamp", type: "uint256" },
          { name: "blockNumber", type: "uint256" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

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
  const rpcUrl = getRpcUrl(chainId) ?? getChainById(chainId).rpcUrls.default.http[0];

  const client = new SailorClient({ chainId, rpcUrl, kernel });
  const pc = createPublicClient({ chain: getChainById(chainId), transport: http(rpcUrl) });

  const caps = await client.capabilities();

  // Resolve the SMA: --account flag, else .sail/account.json.
  const stored = readJsonFile<StoredAccount>(sailPath("account.json"));
  const safe = options.account
    ? getAddress(options.account)
    : stored?.safe
      ? getAddress(stored.safe)
      : null;

  let permissions: Address[] = [];
  let checks: PermCheck[] = [];
  if (safe) {
    const mandates = await client.mandate.list(safe);
    permissions = mandates.map((m) => getAddress(m.permission));
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

  let ownerBal: BalanceInfo | null = null;
  let managerBal: BalanceInfo | null = null;
  try {
    if (ownerAddr) ownerBal = await nativeBalance(pc, ownerAddr);
    if (managerAddr) managerBal = await nativeBalance(pc, managerAddr);
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
          account: safe,
          permissions,
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

  console.log("Sailor doctor");
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

  if (!safe) {
    console.log('\nAccount: none found. Run "sailor account create", or pass --account <addr>.');
    console.log("Skipping permission checks.");
    return;
  }
  console.log(`Account: ${safe}`);

  if (permissions.length === 0) {
    console.log(
      "\n⚠ No permissions registered — every dispatch will be denied (NoPermissionsRegistered).",
    );
    console.log('  Register at least one with "sailor mandate attach".');
    return;
  }

  console.log(`\nRegistered permissions (${permissions.length}):`);
  if (caps.dispatchModel === "selective") {
    permissions.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log(
      "\nSelective kernel — each dispatch names one permission, so pass-through is not required.",
    );
    return;
  }

  // Conjunctive: report the pass-through probe per permission.
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const mark = c.passesThrough ? "✓ pass-through" : "✗ NOT pass-through";
    console.log(`  ${i + 1}. ${c.permission}  ${mark}${c.note ? `  (${c.note})` : ""}`);
  }

  if (bricking.length > 0) {
    console.log(
      `\n✗ ${bricking.length} permission(s) return false for unrelated calls. On this conjunctive ` +
        "kernel EVERY registered permission must approve EVERY call, so these BRICK all dispatches " +
        "(they surface as PermissionDenied). Revoke or replace them with pass-through versions:",
    );
    bricking.forEach((c) => console.log(`    ${c.permission}`));
  } else {
    console.log(
      "\n✓ All permissions pass through unrelated calls — dispatch will not be bricked by a non-pass-through permission.",
    );
  }
  console.log(
    `\nProbe is heuristic: an unknown selector (${PROBE_SELECTOR}) to a neutral target (${PROBE_TARGET}).`,
  );
}
