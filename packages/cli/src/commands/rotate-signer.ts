/**
 * sailor account rotate-signer
 *
 * Rotate the SMA's delegated signer (the kernel `manager` / "agent wallet") —
 * the recovery path for when the agent keystore password is lost, or simply to
 * hand the agent role to a fresh key.
 *
 * The kernel's `setManager(newManager)` is gated by `msg.sender == account`, so
 * unlike createAccount/dispatch it cannot be sent from the owner's EOA directly:
 * it must be wrapped in a `Safe.execTransaction`. Sailor SMAs are 1-of-1 Safes,
 * so the owner submits that tx from their own wallet and authorises it with a
 * pre-validated signature (no separate Safe-tx signing round-trip) — see
 * buildSetManagerExecTransaction in @sail/sdk.
 *
 * Rotation clears every attached mandate on-chain (fail-closed). With
 * re-attach enabled (the default), the previously-registered mandates are
 * re-approved in one batched RegisterPermissions signature so they rebind to the
 * new signer. Because the freshly generated agent wallet starts unfunded, the
 * re-attach submission can fail for lack of gas; in that case the rotation has
 * already succeeded and `--reattach-only` resumes the re-approval once the new
 * agent wallet is funded.
 */

import { mkdirSync, rmSync } from "node:fs";
import {
  SailKernelAbi,
  buildRegisterPermissionsBatchTypedData,
  buildSetManagerExecTransaction,
  estimatePermissionFee,
  LocalKeyring as Keyring,
} from "@sail/sdk";
import {
  http,
  type Address,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  isAddress,
  parseEventLogs,
  publicActions,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import {
  appendActivity,
  checksum,
  confirm,
  fileExists,
  nowIso,
  promptHidden,
  readJsonFile,
  sailPath,
  writeJsonFile,
} from "../lib/io.js";
import { keyPath, loadManagerSigner, managerKeystorePath } from "../lib/keys.js";
import { emit } from "../lib/output.js";
import { ProjectContext } from "../lib/project.js";
import { type SigningChannel, createSigningChannel } from "../signing/client.js";
import type { StoredAccount } from "../lib/state.js";
import { projectPort } from "../lib/packagePaths.js";

export interface RotateSignerOptions {
  sma?: string;
  /** Rotate to an existing agent-wallet address instead of generating one. */
  to?: string;
  /** Generate a fresh local agent wallet (default when --to is omitted). */
  generate?: boolean;
  /** Skip re-approving the previously-attached mandates after rotation. */
  skipReattach?: boolean;
  /** Skip the rotation itself; only re-approve mandates (resume after funding). */
  reattachOnly?: boolean;
  /** List known agent wallets for this SMA without rotating. */
  list?: boolean;
  json?: boolean;
}

type PendingReattach = {
  safe: Address;
  manager: Address;
  permissions: Address[];
  chainId: number;
};

const PENDING_REATTACH_FILE = ["state", "pending-reattach.json"] as const;

export async function rotateSigner(options: RotateSignerOptions): Promise<void> {
  if (!ProjectContext.exists()) {
    emit(options.json, () => console.log('No Sailor project found. Run "sailor init" first.'), {
      status: "error",
      error: "no-project",
    });
    process.exit(1);
  }

  const project = new ProjectContext();
  const channel = await createSigningChannel(process.cwd());
  try {
    await channel.start();
    const result = await runRotateSigner(project, channel, options);
    emit(options.json, () => printSummary(result), { status: "ok", ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(options.json, () => console.error(`\nRotation failed: ${msg}`), {
      status: "error",
      error: msg,
    });
    process.exit(1);
  } finally {
    channel.stop();
  }
}

interface RotateResult {
  sma: Address;
  oldManager: Address | null;
  newManager: Address;
  rotated: boolean;
  reattached: Address[];
  reattachDeferred: boolean;
}

async function runRotateSigner(
  project: ProjectContext,
  channel: SigningChannel,
  options: RotateSignerOptions,
): Promise<RotateResult> {
  const json = !!options.json;
  const say = (fn: () => void) => {
    if (!json) fn();
  };

  const account = resolveAccount(options);
  const smaAddress = account.safe;
  const owner = account.owner;

  // ── List known managers ──────────────────────────────────────────────────────
  if (options.list) {
    const stored = readJsonFile<StoredAccount>(sailPath("account.json"));
    const managers: string[] = stored?.managers ?? (stored?.manager ? [stored.manager] : []);
    const active = stored?.manager ?? "";
    if (json) {
      console.log(JSON.stringify({ managers, active }));
    } else {
      console.log("\nKnown agent wallets for this SMA:");
      if (managers.length === 0) {
        console.log("  (none recorded)");
      } else {
        for (const m of managers) {
          const hasKey = readJsonFile<unknown>(managerKeystorePath(m)) !== null;
          const marker = m.toLowerCase() === active.toLowerCase() ? "* " : "  ";
          console.log(`${marker}${m}${hasKey ? " (keystore stored)" : ""}`);
        }
        console.log("\n* = active");
      }
    }
    return {
      sma: smaAddress,
      oldManager: null,
      newManager: active as Address,
      rotated: false,
      reattached: [],
      reattachDeferred: false,
    };
  }

  const publicClient = createPublicClient({
    chain: getChainById(project.chainId),
    transport: http(getRpcUrl(project.chainId)),
  }).extend(publicActions) as PublicClient;

  // ── Resume path: re-attach only ─────────────────────────────────────────────
  if (options.reattachOnly) {
    const pending = readJsonFile<PendingReattach>(sailPath(...PENDING_REATTACH_FILE));
    if (!pending?.safe || pending.safe.toLowerCase() !== smaAddress.toLowerCase()) {
      throw new Error(
        "No pending re-attach found for this SMA. Run rotation first (without --reattach-only).",
      );
    }
    if (pending.permissions.length === 0) {
      clearPending();
      return {
        sma: smaAddress,
        oldManager: null,
        newManager: pending.manager,
        rotated: false,
        reattached: [],
        reattachDeferred: false,
      };
    }
    const reattached = await reattachMandates(
      project,
      channel,
      publicClient,
      smaAddress,
      account.permissionSigner,
      pending.permissions,
      say,
    );
    clearPending();
    return {
      sma: smaAddress,
      oldManager: null,
      newManager: pending.manager,
      rotated: false,
      reattached,
      reattachDeferred: false,
    };
  }

  // ── Read current on-chain state ─────────────────────────────────────────────
  const config = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "configs",
    args: [smaAddress],
  })) as [Address, Address, Address, boolean];
  const [permissionSigner, oldManager] = config;

  const currentPermissions = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "getPermissions",
    args: [smaAddress],
  })) as Address[];

  // ── Resolve the new manager (agent wallet) ──────────────────────────────────
  const newManager = await resolveNewManager(options, oldManager, json, say);
  if (newManager.toLowerCase() === oldManager.toLowerCase()) {
    throw new Error(
      `New agent wallet (${newManager}) is the same as the current one — nothing to rotate.`,
    );
  }

  say(() => {
    console.log(`\nSMA:            ${smaAddress}`);
    console.log(`Owner:          ${owner}`);
    console.log(`Current signer: ${oldManager}`);
    console.log(`New signer:     ${newManager}`);
    if (currentPermissions.length > 0) {
      console.log(
        `\n⚠  Rotation clears all ${currentPermissions.length} attached mandate(s) on-chain.` +
          (options.skipReattach
            ? "\n   --skip-reattach set: they will NOT be re-approved automatically."
            : "\n   They will be re-approved (re-bound to the new signer) after rotation."),
      );
    }
    console.log(
      `\n→ Open the Sailor dashboard to approve signing requests:\n  http://localhost:${projectPort(process.cwd())}/#/station\n`,
    );
  });

  // ── Build + submit the Safe.execTransaction(setManager) ─────────────────────
  const { to, data } = buildSetManagerExecTransaction({
    safe: smaAddress,
    kernel: project.contracts.kernel,
    newManager,
    owner,
  });

  say(() => console.log("Pushing rotation signing request…"));
  const response = await channel.requestSignature({
    type: "transaction",
    kind: "set-delegate",
    title: "Rotate agent wallet",
    description:
      "Rotate this SMA's delegated signer via the Safe. This clears all attached mandates; " +
      "they are re-approved afterward so they bind to the new signer.",
    chainId: project.chainId,
    to,
    data,
    details: [
      { label: "SMA", value: smaAddress },
      { label: "Current agent wallet", value: oldManager },
      { label: "New agent wallet", value: newManager },
      { label: "Mandates cleared", value: String(currentPermissions.length) },
    ],
  });

  if (response.status === "rejected") {
    throw new Error(`Owner rejected the rotation: ${response.reason ?? "no reason given"}`);
  }
  if (response.status !== "signed") {
    throw new Error(`Expected a transaction response, got: ${response.status}`);
  }

  say(() => console.log("Waiting for transaction confirmation…"));
  const receipt = await publicClient.waitForTransactionReceipt({ hash: response.txHash });
  if (receipt.status !== "success") {
    throw new Error(`setManager reverted (tx ${response.txHash})`);
  }
  const changed = parseEventLogs({ abi: SailKernelAbi, logs: receipt.logs }).find(
    (l) => l.eventName === "ManagerChanged",
  );
  if (!changed) {
    throw new Error(
      "ManagerChanged event not found in the receipt — the rotation may not have applied.",
    );
  }

  say(() => console.log("✓", `Agent wallet rotated to ${newManager}`));
  appendActivity({
    ts: nowIso(),
    actor: "owner",
    type: "signer_rotated",
    sma: smaAddress,
    oldManager,
    newManager,
    txHash: response.txHash,
    chainId: project.chainId,
  });

  // Persist the new manager in account.json + the multi-SMA list.
  persistManager(smaAddress, newManager);

  // ── Re-attach the previously-registered mandates ────────────────────────────
  if (options.skipReattach || currentPermissions.length === 0) {
    return {
      sma: smaAddress,
      oldManager,
      newManager,
      rotated: true,
      reattached: [],
      reattachDeferred: false,
    };
  }

  // Stash what must be re-approved so `--reattach-only` can resume if the
  // re-attach submission fails (e.g. the fresh agent wallet has no gas yet).
  writePending({
    safe: smaAddress,
    manager: newManager,
    permissions: currentPermissions,
    chainId: project.chainId,
  });

  try {
    const reattached = await reattachMandates(
      project,
      channel,
      publicClient,
      smaAddress,
      permissionSigner,
      currentPermissions,
      say,
    );
    clearPending();
    return { sma: smaAddress, oldManager, newManager, rotated: true, reattached, reattachDeferred: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    say(() =>
      console.warn(
        `\n⚠  Rotation succeeded, but re-approval did not complete: ${msg}\n` +
          `   The new agent wallet (${newManager}) likely needs gas. Fund it, then run:\n` +
          "     sailor account rotate-signer --reattach-only\n",
      ),
    );
    return {
      sma: smaAddress,
      oldManager,
      newManager,
      rotated: true,
      reattached: [],
      reattachDeferred: true,
    };
  }
}

/**
 * Re-approve a set of mandates in one batched RegisterPermissions signature: the
 * owner (permission signer) signs in the browser, then the local agent wallet
 * submits kernel.registerPermissions with the summed registration fee.
 */
async function reattachMandates(
  project: ProjectContext,
  channel: SigningChannel,
  publicClient: PublicClient,
  smaAddress: Address,
  permissionSigner: Address,
  permissions: Address[],
  say: (fn: () => void) => void,
): Promise<Address[]> {
  const nonce = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "signerNonces",
    args: [smaAddress],
  })) as bigint;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const typedData = buildRegisterPermissionsBatchTypedData({
    chainId: project.chainId,
    kernel: project.contracts.kernel,
    account: smaAddress,
    permissions,
    nonce,
    deadline,
  });

  say(() =>
    console.log(
      `\nRe-approving ${permissions.length} mandate(s) — the mandate signer (${permissionSigner}) signs in the browser…`,
    ),
  );
  const response = await channel.requestSignature({
    type: "typed-data",
    kind: "register-permission",
    title: "Re-approve mandates",
    description:
      "Re-approve the previously-attached mandates so they bind to the rotated agent wallet. " +
      "The agent submits the registration transaction.",
    chainId: project.chainId,
    details: [
      { label: "SMA", value: smaAddress },
      { label: "Mandates", value: String(permissions.length) },
      { label: "Mandate signer", value: permissionSigner },
    ],
    typedData,
  });

  if (response.status === "rejected") {
    throw new Error(`Owner rejected re-approval: ${response.reason ?? "no reason given"}`);
  }
  if (response.status !== "signature") {
    throw new Error(`Expected an EIP-712 signature response, got: ${response.status}`);
  }

  // Sum the exact per-permission fees (0 on the zero-fee Base/Base-Sepolia deploys).
  let fee = 0n;
  for (const permission of permissions) {
    fee += await estimatePermissionFee(publicClient, project.contracts.governance, permission);
  }

  const agentSigner = await loadManagerSigner();
  const chain = getChainById(project.chainId);
  const walletClient = createWalletClient({
    account: agentSigner.viemAccount,
    chain,
    transport: http(getRpcUrl(project.chainId)),
  });

  const registerData = encodeFunctionData({
    abi: SailKernelAbi,
    functionName: "registerPermissions",
    args: [smaAddress, permissions, deadline, response.signature],
  });

  say(() => console.log(`Submitting re-approval (agent pays gas; fee ${fee} wei)…`));
  const txHash = await walletClient.sendTransaction({
    to: project.contracts.kernel,
    data: registerData,
    value: fee,
    account: agentSigner.viemAccount,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`registerPermissions reverted (tx ${txHash})`);
  }

  say(() => console.log("✓", `${permissions.length} mandate(s) re-approved`));
  appendActivity({
    ts: nowIso(),
    actor: "agent",
    type: "mandates_reattached",
    sma: smaAddress,
    permissions,
    txHash,
    chainId: project.chainId,
  });
  return permissions;
}

/** An account.json record with addresses normalised to checksummed `Address`. */
type ResolvedAccount = {
  safe: Address;
  owner: Address;
  permissionSigner: Address;
  manager: Address;
  chainId: number;
};

function normalizeAccount(stored: StoredAccount): ResolvedAccount {
  return {
    safe: getAddress(stored.safe),
    owner: getAddress(stored.owner),
    permissionSigner: getAddress(stored.permissionSigner),
    manager: getAddress(stored.manager),
    chainId: stored.chainId,
  };
}

/** Resolve the SMA to operate on: --sma, else the active account.json. */
function resolveAccount(options: RotateSignerOptions): ResolvedAccount {
  const stored = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (options.sma) {
    if (!isAddress(options.sma, { strict: false })) {
      throw new Error(`Invalid --sma address: ${options.sma}`);
    }
    if (stored && stored.safe.toLowerCase() === options.sma.toLowerCase()) {
      return normalizeAccount(stored);
    }
    throw new Error(
      `--sma ${options.sma} is not the active SMA. Switch to it in the dashboard first, ` +
        "or run rotation from its project.",
    );
  }
  if (!stored?.safe) {
    throw new Error('No active SMA found. Run "sailor onboard" first, or pass --sma <address>.');
  }
  return normalizeAccount(stored);
}

/** Determine the new agent-wallet address — generate one locally, or use --to. */
async function resolveNewManager(
  options: RotateSignerOptions,
  oldManager: Address,
  json: boolean,
  say: (fn: () => void) => void,
): Promise<Address> {
  if (options.to) {
    if (!isAddress(options.to, { strict: false })) {
      throw new Error(`Invalid --to address: ${options.to}`);
    }
    const to = getAddress(options.to);
    // If we have a stored keystore for this manager address, promote it to the
    // active slot so the new manager (not the old one) pays gas going forward.
    const storedKeystorePath = managerKeystorePath(to);
    const storedKeystore = readJsonFile<unknown>(storedKeystorePath);
    if (storedKeystore) {
      const activeTarget = keyPath("manager");
      writeJsonFile(activeTarget, storedKeystore);
      say(() =>
        console.log(
          `\nRotating to ${to}. Promoted stored keystore → .sail/keys/manager.json.`,
        ),
      );
    } else {
      say(() =>
        console.log(
          `\nRotating to existing address ${to}. No local keystore found for this address —\n` +
            "ensure the agent that signs dispatches holds this key.",
        ),
      );
    }
    return to;
  }

  // Generate a fresh agent wallet and replace the active keystore. Back up any
  // existing one first — the old key may still be needed for an in-flight tx.
  if (json) {
    throw new Error("Pass --to <address> in --json mode (key generation is interactive).");
  }
  const password = await promptHidden("Set a password to encrypt the new agent wallet");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const confirmation = await promptHidden("Confirm password");
  if (password !== confirmation) throw new Error("Passwords do not match.");

  const target = keyPath("manager");
  if (fileExists(target)) {
    const backup = `${target}.${Date.now()}.bak`;
    const existing = readJsonFile<unknown>(target);
    if (existing) writeJsonFile(backup, existing);
    say(() => console.log(`  Backed up the old agent keystore → ${backup}`));
  }

  const keyring = Keyring.generate();
  const keystore = await keyring.exportKeystore(password);
  writeJsonFile(target, keystore);

  // Persist a copy under the manager-specific path so future `--to <addr>`
  // rotations back to this key can promote it without re-entering the password.
  const perManagerPath = managerKeystorePath(keyring.address);
  mkdirSync(sailPath("keys", "managers"), { recursive: true });
  writeJsonFile(perManagerPath, keystore);

  say(() =>
    console.log(
      `  New agent wallet: ${checksum(keyring.address)} (keystore at .sail/keys/manager.json)`,
    ),
  );
  return keyring.address as Address;
}

/** Persist the rotated manager into account.json and the multi-SMA list. */
function persistManager(safe: Address, manager: Address): void {
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (account && account.safe.toLowerCase() === safe.toLowerCase()) {
    const managers = addToManagerList(account.managers, account.manager, manager);
    writeJsonFile(sailPath("account.json"), { ...account, manager: checksum(manager), managers });
  }
  const listPath = sailPath("state", "accounts.json");
  const list = readJsonFile<Array<StoredAccount & { name?: string; addedAt?: string | null }>>(
    listPath,
  );
  if (Array.isArray(list)) {
    const idx = list.findIndex((a) => a.safe.toLowerCase() === safe.toLowerCase());
    if (idx !== -1) {
      const entry = list[idx];
      const managers = addToManagerList(entry.managers, entry.manager, manager);
      list[idx] = { ...entry, manager: checksum(manager), managers };
      writeJsonFile(listPath, list);
    }
  }
}

/** Returns a deduplicated managers list that includes both the old and new manager. */
function addToManagerList(
  existing: string[] | undefined,
  current: string,
  next: Address,
): string[] {
  const all = [...(existing ?? [current]), checksum(next)];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const a of all) {
    const lower = a.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      deduped.push(checksum(a));
    }
  }
  return deduped;
}

function writePending(pending: PendingReattach): void {
  writeJsonFile(sailPath(...PENDING_REATTACH_FILE), pending);
}

function clearPending(): void {
  try {
    rmSync(sailPath(...PENDING_REATTACH_FILE), { force: true });
  } catch {
    /* best-effort */
  }
}

function printSummary(r: RotateResult): void {
  console.log(`\n${"─".repeat(56)}`);
  if (r.rotated) {
    console.log("✓ Agent wallet rotated");
    console.log(`  SMA:        ${r.sma}`);
    if (r.oldManager) console.log(`  Old signer: ${r.oldManager}`);
    console.log(`  New signer: ${r.newManager}`);
  } else {
    console.log("✓ Mandate re-approval complete");
    console.log(`  SMA:    ${r.sma}`);
  }
  if (r.reattached.length > 0) {
    console.log(`  Re-approved mandates: ${r.reattached.length}`);
    for (const p of r.reattached) console.log("    -", p);
  } else if (r.reattachDeferred) {
    console.log("  Mandates: NOT re-approved (re-attach deferred — see warning above)");
  }
  console.log("─".repeat(56));
}
