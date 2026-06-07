/**
 * sailor scan
 *
 * Gather the full on-chain + local context for the project owner and persist it
 * to .sail/state/context.json, so an agent has one place to read instead of
 * re-querying every run:
 *
 *   - owner (from saved state, or --owner)
 *   - Safes owned by the owner (Gnosis Safe Transaction Service)
 *   - per-Safe: is it a Sail SMA? manager, permissionSigner, session, mandates
 *   - local signing keys (manager / permissionSigner)
 */

import type { EncryptedKeystore } from "@sail/sdk";
import { SailKernelAbi, discoverSafesForOwner } from "@sail/sdk";
import {
  http,
  type Address,
  type PublicClient,
  createPublicClient,
  getAddress,
  isAddress,
  publicActions,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { readJsonFile, sailPath, writeJsonFile } from "../lib/io.js";
import { ROLES, keyPath } from "../lib/keys.js";
import { emit } from "../lib/output.js";
import { ProjectContext } from "../lib/project.js";

type SmaContext = {
  address: Address;
  registered: boolean;
  manager?: Address;
  permissionSigner?: Address;
  sessionActive?: boolean;
  mandates?: Address[];
  error?: string;
};

type ProjectScan = {
  owner: Address;
  chainId: number;
  scannedAt: string;
  smas: SmaContext[];
  keys: Array<{ role: string; address: Address }>;
};

function localKeys(): Array<{ role: string; address: Address }> {
  const out: Array<{ role: string; address: Address }> = [];
  for (const role of ROLES) {
    const ks = readJsonFile<EncryptedKeystore>(keyPath(role));
    if (ks?.address) out.push({ role, address: getAddress(`0x${ks.address.replace(/^0x/, "")}`) });
  }
  return out;
}

export async function scan(options: { owner?: string; json?: boolean }): Promise<void> {
  if (!ProjectContext.exists()) {
    emit(options.json, () => console.log('No Sailor project found. Run "sailor init" first.'), {
      status: "error",
      error: "no-project",
    });
    process.exit(1);
  }
  const project = new ProjectContext();

  const rawOwner = (options.owner ?? project.getOwner() ?? undefined) as string | undefined;
  if (!rawOwner || !isAddress(rawOwner, { strict: false })) {
    emit(
      options.json,
      () =>
        console.log(
          'No owner to scan. Connect one with "sailor owner connect" or pass --owner <address>.',
        ),
      { status: "error", error: "no-owner" },
    );
    process.exit(1);
  }
  const owner = getAddress(rawOwner);

  const chainId = project.chainId;
  const kernel = project.contracts.kernel;
  const publicClient = createPublicClient({
    chain: getChainById(chainId),
    transport: http(getRpcUrl(chainId)),
  }).extend(publicActions) as PublicClient;

  if (!options.json) console.log(`Scanning owner ${owner} on chain ${chainId}…`);

  let safes: Address[] = [];
  let discoveryError: string | undefined;
  try {
    safes = await discoverSafesForOwner(owner, chainId);
  } catch (err) {
    discoveryError = err instanceof Error ? err.message : String(err);
  }

  const smas: SmaContext[] = [];
  for (const address of safes) {
    try {
      const registered = (await publicClient.readContract({
        address: kernel,
        abi: SailKernelAbi,
        functionName: "registered",
        args: [address],
      })) as boolean;

      if (!registered) {
        smas.push({ address, registered: false });
        continue;
      }

      const [config, mandates] = await Promise.all([
        publicClient.readContract({
          address: kernel,
          abi: SailKernelAbi,
          functionName: "configs",
          args: [address],
        }) as Promise<[Address, Address, Address, boolean]>,
        publicClient.readContract({
          address: kernel,
          abi: SailKernelAbi,
          functionName: "getPermissions",
          args: [address],
        }) as Promise<Address[]>,
      ]);

      const [permissionSigner, manager, , sessionActive] = config;
      smas.push({ address, registered: true, manager, permissionSigner, sessionActive, mandates });
    } catch (err) {
      smas.push({
        address,
        registered: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const scanResult: ProjectScan = {
    owner,
    chainId,
    scannedAt: new Date().toISOString(),
    smas,
    keys: localKeys(),
  };

  const contextPath = sailPath("state", "context.json");
  writeJsonFile(contextPath, scanResult);

  emit(
    options.json,
    () => {
      if (discoveryError) console.log(`⚠ Safe discovery failed: ${discoveryError}`);
      const registeredCount = smas.filter((s) => s.registered).length;
      console.log("✓", `${safes.length} Safe(s) — ${registeredCount} registered as Sail SMA(s)`);
      for (const s of smas) {
        if (s.registered) {
          console.log(
            `  • ${s.address}  [${s.sessionActive ? "active" : "paused"}]  mandates: ${s.mandates?.length ?? 0}`,
          );
        } else {
          console.log(`  • ${s.address}  (not a Sail SMA)`);
        }
      }
      console.log("✓", `${scanResult.keys.length} local key(s)`);
      console.log(`Saved context → ${contextPath}`);
      if (safes.length === 0 && !discoveryError) {
        console.log(
          "\nOwner has no SMAs yet. Next: decide a strategy, then create an SMA and register a permission.",
        );
      }
    },
    { status: "ok", context: scanResult, contextPath, discoveryError },
  );
}
