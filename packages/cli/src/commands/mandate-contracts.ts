/**
 * sailor mandate deploy | attach | templates | list
 *
 * Deploy and attach brand-new mandate (permission) contracts the agent has
 * authored and compiled with Foundry.
 *
 *   sailor mandate deploy --contract MyMandate --args '["0xToken"]' --attach --sma 0x...
 *   sailor mandate attach --address 0xMandate --sma 0xSafe
 *
 * Deployment is a contract-creation transaction signed by the owner in the
 * browser signing UI (the agent never holds the owner key). Mandates are fully
 * configured by their constructor at deploy time, so a single deploy + a single
 * attach signature is all that's required.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SailKernelAbi, getSailDeployment } from "@sail/sdk";
import {
  http,
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  isAddress,
  publicActions,
  recoverTypedDataAddress,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { appendActivity, nowIso } from "../lib/io.js";
import { type DeployedMandate, MandateStore } from "../lib/mandates.js";
import { emit } from "../lib/output.js";
import { ProjectContext, loadManagerSigner } from "../lib/project.js";
import { type SigningChannel, createSigningChannel } from "../signing/client.js";
import { attachMandate } from "./onboard.js";

export interface DeployOptions {
  artifact?: string;
  contract?: string;
  out: string;
  name?: string;
  args?: string;
  build?: boolean;
  attach?: boolean;
  sma?: string;
  json?: boolean;
}

export interface AttachOptions {
  address: string;
  sma: string;
  label?: string;
  json?: boolean;
}

export interface RevokeOptions {
  address?: string;
  sma: string;
  all?: boolean;
  json?: boolean;
}

// The deployed kernels (selective model) revoke via a batch call the owner
// authorizes off-chain and the agent submits. These fragments aren't in the
// SDK's SailKernelAbi, so we carry the minimal shapes here, matching the
// on-chain REVOKE_PERMISSIONS_TYPEHASH.
const REVOKE_PERMISSIONS_ABI = [
  {
    type: "function",
    name: "revokePermissions",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "permissions", type: "address[]" },
      { name: "deadline", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "signerNonces",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const REVOKE_PERMISSIONS_TYPES = {
  RevokePermissions: [
    { name: "account", type: "address" },
    { name: "permissions", type: "address[]" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

function requireProject(): ProjectContext {
  if (!ProjectContext.exists()) {
    console.log('No Sailor project found. Run "sailor init" first.');
    process.exit(1);
  }
  return new ProjectContext();
}

function fail(err: unknown, json = false): never {
  const msg = err instanceof Error ? err.message : String(err);
  emit(json, () => console.error(`\nMandate command failed: ${msg}`), {
    status: "error",
    error: msg,
  });
  process.exit(1);
}

function publicClientFor(project: ProjectContext): PublicClient {
  return createPublicClient({
    chain: getChainById(project.chainId),
    transport: http(getRpcUrl(project.chainId)),
  }).extend(publicActions) as PublicClient;
}

// ── deploy ───────────────────────────────────────────────────────────────────

export async function mandateDeploy(options: DeployOptions): Promise<void> {
  const project = requireProject();
  const channel = await createSigningChannel(process.cwd());
  try {
    await channel.start();
    await runDeploy(project, channel, options);
  } catch (err) {
    fail(err, options.json);
  } finally {
    channel.stop();
  }
}

async function runDeploy(
  project: ProjectContext,
  channel: SigningChannel,
  options: DeployOptions,
): Promise<void> {
  const json = !!options.json;
  const say = (fn: () => void) => {
    if (!json) fn();
  };

  if (options.attach && !options.sma) throw new Error("--attach requires --sma <address>");
  if (options.sma && !isAddress(options.sma)) {
    throw new Error(`Invalid --sma address: ${options.sma}`);
  }

  if (project.chainId !== 8453) {
    say(() =>
      console.warn(
        `\n⚠  Testnet mode: deploying mandate on chain ${project.chainId}, not Base mainnet (8453).\n   Set chainId to 8453 in .sail/config.json for production.\n`,
      ),
    );
  }

  const { abi, bytecode, contractName, artifactPath } = resolveArtifact(options);
  const args = coerceConstructorArgs(abi, options.args);
  const deployData = encodeDeployData({ abi, bytecode, args });

  const chainId = project.chainId;
  const publicClient = publicClientFor(project);

  say(() => {
    console.log(
      `\n→ Signing station:\n  Open ${channel.url} in your browser and connect your wallet\n`,
    );
    console.log(`Pushing deploy request for "${contractName}"…`);
  });

  const response = await channel.requestSignature({
    type: "transaction",
    kind: "deploy-mandate",
    title: `Deploy "${contractName}" permission contract`,
    description: `Deploy a new ${contractName} permission contract from your wallet. You pay gas; the contract is created with the parameters baked into its constructor.`,
    chainId,
    // No `to` — this is a contract-creation transaction.
    data: deployData,
    details: [
      { label: "Contract", value: contractName },
      { label: "Constructor args", value: options.args ? options.args : "(none)" },
    ],
  });

  if (response.status === "rejected") {
    throw new Error(`User rejected permission deployment: ${response.reason ?? "no reason given"}`);
  }
  if (response.status !== "signed") {
    throw new Error(`Expected a signed transaction, got: ${response.status}`);
  }

  say(() => console.log("Waiting for deployment confirmation…"));
  const receipt = await publicClient.waitForTransactionReceipt({ hash: response.txHash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error("Deployment transaction failed or produced no contract address");
  }

  const deployed = receipt.contractAddress;
  say(() => console.log("✓", `Permission deployed at ${deployed}`));

  const record: DeployedMandate = {
    name: options.name ?? contractName,
    address: deployed,
    txHash: response.txHash,
    chainId,
    artifactPath,
    constructorArgs: parseArgsRaw(options.args),
    deployedAt: new Date().toISOString(),
  };
  const store = new MandateStore();
  store.add(record);
  say(() => console.log("Tracked in .sail/state/mandates.json"));

  // Owner-paid contract creation: the owner signed/paid for this deploy tx
  // (the signing server logged the approval); here we record the confirmed
  // outcome, enriched with the address the receipt revealed.
  appendActivity({
    ts: nowIso(),
    actor: "owner",
    type: "mandate_deployed",
    name: record.name,
    address: deployed,
    txHash: response.txHash,
    chainId,
  });

  let attachTxHash: Hex | undefined;
  if (options.attach && options.sma) {
    attachTxHash = await attachToSma(
      project,
      channel,
      publicClient,
      options.sma as Address,
      deployed,
      record.name,
      json,
    );
    store.recordAttachment(deployed, { sma: options.sma as Address, txHash: attachTxHash });
  } else {
    say(() =>
      console.log(
        `\nRegister it later with: sailor mandate attach --address ${deployed} --sma <SMA>`,
      ),
    );
  }

  emit(json, () => {}, {
    status: "ok",
    mandate: { name: record.name, address: deployed, txHash: response.txHash, chainId },
    attached: options.attach ? { sma: options.sma, txHash: attachTxHash } : null,
  });
}

// ── attach ─────────────────────────────────────────────────────────────────

export async function mandateAttach(options: AttachOptions): Promise<void> {
  const project = requireProject();
  const channel = await createSigningChannel(process.cwd());
  try {
    await channel.start();
    await runAttach(project, channel, options);
  } catch (err) {
    fail(err, options.json);
  } finally {
    channel.stop();
  }
}

async function runAttach(
  project: ProjectContext,
  channel: SigningChannel,
  options: AttachOptions,
): Promise<void> {
  const json = !!options.json;
  if (!isAddress(options.sma)) throw new Error(`Invalid --sma address: ${options.sma}`);

  const store = new MandateStore();
  const tracked = store.find(options.address);
  const mandateAddress = tracked?.address ?? (options.address as Address);
  if (!isAddress(mandateAddress)) {
    throw new Error(
      `--address must be a deployed mandate address or a tracked name: ${options.address}`,
    );
  }
  const label = options.label ?? tracked?.name ?? "mandate";

  const publicClient = publicClientFor(project);

  if (!json) {
    console.log(
      `\n→ Signing station:\n  Open ${channel.url} in your browser and connect your wallet\n`,
    );
  }

  const txHash = await attachToSma(
    project,
    channel,
    publicClient,
    options.sma as Address,
    mandateAddress,
    label,
    json,
  );
  if (tracked) store.recordAttachment(mandateAddress, { sma: options.sma as Address, txHash });

  emit(json, () => {}, {
    status: "ok",
    attached: { sma: options.sma, mandate: mandateAddress, txHash },
  });
}

// ── revoke ───────────────────────────────────────────────────────────────────

export async function mandateRevoke(options: RevokeOptions): Promise<void> {
  const project = requireProject();
  const channel = await createSigningChannel(process.cwd());
  try {
    await channel.start();
    await runRevoke(project, channel, options);
  } catch (err) {
    fail(err, options.json);
  } finally {
    channel.stop();
  }
}

/**
 * Revoke one or more permissions from an SMA. The owner authorizes the removal
 * with an EIP-712 RevokePermissions signature in the browser; the agent
 * (manager) submits kernel.revokePermissions and pays gas. Each removed
 * permission is recorded to the activity log so Recent Activity reflects it.
 */
async function runRevoke(
  project: ProjectContext,
  channel: SigningChannel,
  options: RevokeOptions,
): Promise<void> {
  const json = !!options.json;
  const say = (fn: () => void) => {
    if (!json) fn();
  };
  if (!isAddress(options.sma)) throw new Error(`Invalid --sma address: ${options.sma}`);
  if (!options.all && !options.address) {
    throw new Error("Provide --address <permission> (or a tracked name), or --all");
  }

  const sma = options.sma as Address;
  const kernel = project.contracts.kernel;
  const publicClient = publicClientFor(project);

  // Resolve which permissions to revoke against the kernel's live set.
  const onchain = (await publicClient.readContract({
    address: kernel,
    abi: SailKernelAbi,
    functionName: "getPermissions",
    args: [sma],
  })) as Address[];
  if (onchain.length === 0) throw new Error(`No permissions registered on ${sma}.`);

  const store = new MandateStore();
  let targets: Address[];
  if (options.all) {
    targets = onchain;
  } else {
    const tracked = store.find(options.address as string);
    const wanted = (tracked?.address ?? options.address) as string;
    if (!isAddress(wanted)) {
      throw new Error(`--address must be a permission address or a tracked name: ${options.address}`);
    }
    const match = onchain.find((p) => p.toLowerCase() === wanted.toLowerCase());
    if (!match) {
      throw new Error(`${wanted} is not in the SMA's current permission set; nothing to revoke.`);
    }
    targets = [match];
  }

  const nameFor = (addr: Address): string | undefined => store.find(addr)?.name;

  const nonce = (await publicClient.readContract({
    address: kernel,
    abi: REVOKE_PERMISSIONS_ABI,
    functionName: "signerNonces",
    args: [sma],
  })) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  say(() => {
    console.log(`\nRevoking ${targets.length} permission(s) from ${sma}:`);
    for (const p of targets) console.log(`  ${nameFor(p) ?? p}  ${p}`);
    console.log(
      `\n→ Signing station:\n  Open ${channel.url} in your browser and connect your Owner wallet\n`,
    );
  });

  const response = await channel.requestSignature({
    type: "typed-data",
    kind: "revoke-permissions",
    title: targets.length === 1 ? `Revoke "${nameFor(targets[0]) ?? targets[0]}"` : `Revoke ${targets.length} permissions`,
    description:
      "Authorize removing the listed permission(s) from your SMA. The agent submits the on-chain transaction.",
    chainId: project.chainId,
    details: [
      { label: "SMA", value: sma },
      ...targets.map((p, i) => ({ label: `[${i}] ${nameFor(p) ?? "permission"}`, value: p })),
      { label: "Signer nonce", value: nonce.toString() },
    ],
    typedData: {
      domain: { name: "SailKernel", version: "1", chainId: project.chainId, verifyingContract: kernel },
      types: REVOKE_PERMISSIONS_TYPES as unknown as Record<string, { name: string; type: string }[]>,
      primaryType: "RevokePermissions",
      message: { account: sma, permissions: targets, nonce: nonce.toString(), deadline: deadline.toString() },
    },
  });

  if (response.status === "rejected") {
    throw new Error(`User rejected revocation: ${response.reason ?? "no reason given"}`);
  }
  if (response.status !== "signature") {
    throw new Error(`Expected EIP-712 signature response, got: ${response.status}`);
  }

  // Security guard: verify the browser signature was made by the on-chain mandate
  // signer — NOT by the agent wallet. Read permissionSigner from kernel.configs().
  try {
    const kCfg = (await publicClient.readContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "configs",
      args: [sma],
    })) as [Address, Address, Address, boolean];
    const expectedPermissionSigner = kCfg[0];

    const recoveredSigner = await recoverTypedDataAddress({
      domain: { name: "SailKernel", version: "1", chainId: project.chainId, verifyingContract: kernel },
      types: REVOKE_PERMISSIONS_TYPES,
      primaryType: "RevokePermissions",
      message: { account: sma, permissions: targets, nonce, deadline },
      signature: response.signature,
    });

    if (recoveredSigner.toLowerCase() !== expectedPermissionSigner.toLowerCase()) {
      throw new Error(
        `Security: RevokePermissions was signed by ${recoveredSigner} but the on-chain mandate signer is ${expectedPermissionSigner}.\n` +
          "Connect the owner wallet (mandate signer) in the browser — the agent wallet must never sign permission revocations.",
      );
    }
  } catch (err) {
    // Re-throw security errors; ignore recovery failures (e.g. unsupported sig format).
    if ((err as Error).message.startsWith("Security:")) throw err;
  }

  const agentSigner = await loadManagerSigner();
  const walletClient = createWalletClient({
    account: agentSigner.viemAccount,
    chain: getChainById(project.chainId),
    transport: http(getRpcUrl(project.chainId)),
  });

  say(() => console.log("Submitting kernel.revokePermissions (agent pays gas)…"));
  const txHash = await walletClient.writeContract({
    address: kernel,
    abi: REVOKE_PERMISSIONS_ABI,
    functionName: "revokePermissions",
    args: [sma, targets, deadline, response.signature],
  });

  say(() => console.log("Waiting for confirmation…"));
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`revokePermissions reverted (tx ${txHash})`);
  }
  say(() => console.log("✓", `Revoked ${targets.length} permission(s) — tx ${txHash}`));

  // The agent (manager) submitted and paid; the owner's authorization signature
  // was logged separately by the signing server (revoke-permissions → owner_signed).
  for (const permission of targets) {
    appendActivity({
      ts: nowIso(),
      actor: "agent",
      type: "permission_revoked",
      permission,
      name: nameFor(permission),
      sma,
      txHash,
      chainId: project.chainId,
    });
  }

  emit(json, () => {}, {
    status: "ok",
    revoked: targets,
    txHash,
  });
}

/** Verify the Safe is registered, read its permission signer, then run attach. */
async function attachToSma(
  project: ProjectContext,
  channel: SigningChannel,
  publicClient: PublicClient,
  sma: Address,
  mandate: Address,
  label: string,
  json = false,
): Promise<Hex> {
  const say = (fn: () => void) => {
    if (!json) fn();
  };
  const agentSigner = await loadManagerSigner();

  const registered = await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "registered",
    args: [sma],
  });
  if (!registered) {
    throw new Error(`SMA ${sma} is not registered with SailKernel; cannot register a permission.`);
  }

  const kernelConfig = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "configs",
    args: [sma],
  })) as [Address, Address, Address, boolean];
  const permissionSigner = kernelConfig[0];

  const txHash = await attachMandate(
    project,
    channel,
    publicClient,
    agentSigner,
    sma,
    permissionSigner,
    { address: mandate, label },
    { json },
  );

  const attached = await pollForPermission(publicClient, project.contracts.kernel, sma, mandate);
  say(() => {
    if (!attached) {
      console.log("⚠  Permission not yet visible in the permission set — verify on-chain.");
    } else {
      console.log("✓", `Permission present in getPermissions(${sma})`);
    }
  });
  return txHash;
}

async function pollForPermission(
  publicClient: PublicClient,
  kernel: Address,
  account: Address,
  permission: Address,
  attempts = 6,
): Promise<boolean> {
  const needle = permission.toLowerCase();
  for (let i = 0; i < attempts; i++) {
    const perms = (await publicClient.readContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "getPermissions",
      args: [account],
    })) as Address[];
    if (perms.some((p) => p.toLowerCase() === needle)) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// ── templates / list ───────────────────────────────────────────────────────

/**
 * `sailor mandate templates` — Sailor does not ship a blessed library of
 * permission contracts. This points users at the custom-mandate scaffold so they
 * author, review, and deploy their OWN IPermission contracts. Any addresses
 * shown are community-deployed and unaudited — informational only.
 */
export function mandateTemplates(options: { json?: boolean }): void {
  const project = requireProject();
  const chainId = project.chainId;

  // Community-deployed standalone permission addresses on the active chain.
  // Informational only — NOT audited or endorsed by Sail.
  let community: Array<{ key: string; address: string }> = [];
  try {
    const standalone = getSailDeployment(chainId).standaloneTemplates ?? {};
    community = Object.entries(standalone).map(([key, address]) => ({
      key,
      address: String(address),
    }));
  } catch {
    community = [];
  }

  emit(
    options.json,
    () => {
      console.log("Author your own permission contract (recommended):");
      console.log("  1. Copy templates/custom-mandate/mandates/AllowlistTargetMandate.sol as a starting point");
      console.log("  2. Implement IPermission.evaluate(txData, ctx) with your policy logic");
      console.log("  3. forge build");
      console.log("  4. sailor mandate deploy --contract <Name> --attach --sma <yourSMA>");
      console.log("\n  See templates/custom-mandate/README.md for the full guide.");

      if (community.length > 0) {
        console.log(
          "\nCommunity-deployed permission contracts (informational — NOT audited or\n" +
            "endorsed by Sail; review the source before registering any of them):",
        );
        for (const c of community) {
          console.log(`  ${c.key}`);
          console.log(`    ${c.address}`);
        }
      }
    },
    { chainId, community },
  );
}

export function mandateContractsList(): void {
  const store = new MandateStore();
  const mandates = store.list();
  if (mandates.length === 0) {
    console.log('No permission contracts deployed yet. Use "sailor mandate deploy".');
    return;
  }
  for (const m of mandates) {
    console.log(m.name, `(chain ${m.chainId})`);
    console.log("  Address: ", m.address);
    console.log("  Deployed:", m.deployedAt);
    if (m.attachments?.length) {
      console.log("  Registered on:", m.attachments.map((a) => a.sma).join(", "));
    }
  }
}

// ── artifact + args helpers ──────────────────────────────────────────────────

function resolveArtifact(options: DeployOptions): {
  abi: Abi;
  bytecode: Hex;
  contractName: string;
  artifactPath: string;
} {
  let artifactPath = options.artifact;
  let contractName = options.contract ?? options.name ?? "";

  if (!artifactPath) {
    if (!options.contract) throw new Error("Provide --artifact <path> or --contract <name>");
    artifactPath = join(options.out, `${options.contract}.sol`, `${options.contract}.json`);
  }

  // Prevent path traversal: resolve and assert the path stays within cwd.
  const resolved = resolve(artifactPath);
  const projectRoot = resolve(process.cwd());
  if (!resolved.startsWith(projectRoot + "/") && resolved !== projectRoot) {
    throw new Error(
      `Artifact path must be inside the project directory.\nResolved: ${resolved}`,
    );
  }
  artifactPath = resolved;

  if (options.build) runForgeBuild();

  if (!existsSync(artifactPath)) {
    ensureForgeHint();
    throw new Error(
      `Artifact not found: ${artifactPath}\nCompile your mandate first (e.g. \`forge build\`), or pass --build.`,
    );
  }

  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const abi = artifact.abi as Abi;
  const bytecodeRaw = artifact.bytecode?.object ?? artifact.bytecode;
  if (!bytecodeRaw || typeof bytecodeRaw !== "string") {
    throw new Error(`No creation bytecode found in artifact: ${artifactPath}`);
  }
  const bytecode = (bytecodeRaw.startsWith("0x") ? bytecodeRaw : `0x${bytecodeRaw}`) as Hex;

  if (!contractName) {
    const m = artifactPath.match(/([^/\\]+)\.json$/);
    contractName = m ? m[1] : "Mandate";
  }

  return { abi, bytecode, contractName, artifactPath };
}

function parseArgsRaw(argsJson?: string): string[] | undefined {
  if (!argsJson) return undefined;
  try {
    const parsed = JSON.parse(argsJson);
    return Array.isArray(parsed) ? parsed.map((v) => JSON.stringify(v)) : undefined;
  } catch {
    return undefined;
  }
}

function coerceConstructorArgs(abi: Abi, argsJson?: string): readonly unknown[] {
  const ctor = abi.find((x) => x.type === "constructor") as { inputs: AbiParameter[] } | undefined;
  const inputs = ctor?.inputs ?? [];

  if (inputs.length === 0) {
    if (argsJson && JSON.parse(argsJson).length > 0) {
      throw new Error("Constructor takes no arguments but --args were provided");
    }
    return [];
  }

  if (!argsJson) {
    throw new Error(
      `Constructor expects ${inputs.length} argument(s); pass them with --args as a JSON array`,
    );
  }

  const raw = JSON.parse(argsJson);
  if (!Array.isArray(raw) || raw.length !== inputs.length) {
    throw new Error(
      `--args must be a JSON array of ${inputs.length} element(s) matching the constructor`,
    );
  }

  return inputs.map((input, i) => coerceValue(raw[i], input.type));
}

function coerceValue(value: unknown, type: string): unknown {
  if (type.endsWith("[]")) {
    const base = type.slice(0, -2);
    const arr = Array.isArray(value) ? value : JSON.parse(String(value));
    return arr.map((v: unknown) => coerceValue(v, base));
  }
  if (type.startsWith("uint") || type.startsWith("int")) {
    return BigInt(value as string | number);
  }
  if (type === "bool") {
    return value === true || value === "true";
  }
  return value;
}

// ── Foundry helpers ──────────────────────────────────────────────────────────

function forgeAvailable(): boolean {
  const r = spawnSync("forge", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function ensureForgeHint(): void {
  if (!forgeAvailable()) {
    console.log(
      "\nFoundry (forge) was not found on your PATH.\n" +
        "Install it with:\n" +
        "  curl -L https://foundry.paradigm.xyz | bash && foundryup\n",
    );
  }
}

function runForgeBuild(): void {
  if (!forgeAvailable()) {
    ensureForgeHint();
    throw new Error("Cannot run `forge build` — Foundry is not installed.");
  }
  console.log("Running forge build…");
  const r = spawnSync("forge", ["build"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("forge build failed");
}
