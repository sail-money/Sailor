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
import { join, resolve, sep } from "node:path";
import {
  REGISTER_PERMISSION_TYPES,
  REGISTER_PERMISSION_TYPES_NO_DEADLINE,
  SailKernelAbi,
  buildRegisterPermissionTypedData,
  buildRegisterPermissionsBatchTypedData,
  detectKernelCapabilities,
  estimatePermissionFee,
  getSailDeployment,
  sailKernelDomain,
} from "@sail/sdk";
import {
  http,
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
  type PublicClient,
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  isAddress,
  keccak256,
  maxUint256,
  publicActions,
  recoverTypedDataAddress,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { appendActivity, nowIso } from "../lib/io.js";
import { type DeployedMandate, MandateStore } from "../lib/mandates.js";
import { emit } from "../lib/output.js";
import { ProjectContext, loadManagerSigner } from "../lib/project.js";
import { type SigningChannel, createSigningChannel, signingPageUrl } from "../signing/client.js";
import { attachMandate } from "./onboard.js";
import { projectPort } from "../lib/packagePaths.js";

export interface DeployOptions {
  artifact?: string;
  contract?: string;
  out: string;
  name?: string;
  args?: string;
  argsFile?: string;
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

export interface UpdateOptions {
  address: string;
  name?: string;
  sourcePath?: string;
  artifactPath?: string;
  json?: boolean;
}

export interface RevokeOptions {
  address?: string;
  sma: string;
  all?: boolean;
  json?: boolean;
}

export interface DeployCloneOptions {
  template: string;
  sma: string;
  tokens?: string;
  spenders?: string;
  max?: string;
  label?: string;
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

/**
 * Tell the operator where to approve the request — BEFORE the long blocking wait
 * on the signature. In human mode this prints the dashboard station URL. In
 * --json mode it emits a single `waiting_for_signature` record up front. The
 * write happens before requestSignature() is awaited, so stdout drains as the
 * event loop yields into the wait — scripted/redirected callers see the URL
 * instead of nothing while the command blocks for minutes.
 */
function announceSigningUrl(json: boolean): void {
  const url = signingPageUrl(undefined, projectPort(process.cwd()));
  if (json) {
    process.stdout.write(`${JSON.stringify({ status: "waiting_for_signature", url })}\n`);
  } else {
    console.log(`\n→ Open the Sailor dashboard to approve signing requests:\n  ${url}\n`);
  }
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
  if (options.sma && !isAddress(options.sma, { strict: false })) {
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
  let argsJson: string | undefined;
  if (options.argsFile) {
    const argsFilePath = resolve(options.argsFile);
    try {
      argsJson = readFileSync(argsFilePath, "utf8").trim();
    } catch {
      throw new Error(`Cannot read --args-file: ${argsFilePath}`);
    }
  } else {
    argsJson = options.args;
  }
  const args = coerceConstructorArgs(abi, argsJson);
  const deployData = encodeDeployData({ abi, bytecode, args });

  const chainId = project.chainId;
  const publicClient = publicClientFor(project);

  announceSigningUrl(json);
  say(() => console.log(`Pushing deploy request for "${contractName}"…`));

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
      {
        label: options.argsFile ? "Constructor args (from file)" : "Constructor args",
        value: argsJson ? argsJson : "(none)",
      },
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
  const stored = store.add(record);
  say(() => console.log("Tracked in .sail/state/mandates.json" + (stored.name !== record.name ? ` as "${stored.name}"` : "")));

  // Owner-paid contract creation: the owner signed/paid for this deploy tx
  // (the signing server logged the approval); here we record the confirmed
  // outcome, enriched with the address the receipt revealed.
  appendActivity({
    ts: nowIso(),
    actor: "owner",
    type: "mandate_deployed",
    name: stored.name,
    address: deployed,
    txHash: response.txHash,
    chainId,
  });

  let attachTxHash: Hex | undefined;
  if (options.attach && options.sma) {
    const sma = getAddress(options.sma);
    attachTxHash = await attachToSma(
      project,
      channel,
      publicClient,
      sma,
      deployed,
      stored.name,
      json,
    );
    store.recordAttachment(deployed, { sma, txHash: attachTxHash });
  } else {
    say(() =>
      console.log(
        `\nRegister it later with: sailor mandate attach --address ${deployed} --sma <SMA>`,
      ),
    );
  }

  emit(json, () => {}, {
    status: "ok",
    mandate: { name: stored.name, address: deployed, txHash: response.txHash, chainId },
    attached: options.attach ? { sma: getAddress(options.sma!), txHash: attachTxHash } : null,
  });
}

// ── deploy-clone ─────────────────────────────────────────────────────────────
//
// Standalone (single-account) templates — boundedApprove, boundedSwap, etc. —
// are EIP-1167 clones of a published logic contract. Each account gets its own
// clone, deployed and registered in ONE transaction via
// PermissionFactory.deployAndAttach(account, impl, salt, initData, deadline, sig).
//
// Authorization mirrors `attachMandate`: the owner (mandate signer) signs the
// kernel RegisterPermission EIP-712 in the browser signing station — for the
// clone's *predicted* address, since the clone does not exist until the tx
// lands — and the agent submits deployAndAttach (paying gas). No new dashboard
// signing event is needed: the owner only ever signs the existing
// `register-permission` request.

const CLONE_INIT_PREFIX = "0x3d602d80600a3d3981f3363d3d373d3d3d363d73" as const;
const CLONE_INIT_SUFFIX = "0x5af43d82803e903d91602b57fd5bf3" as const;

const PERMISSION_FACTORY_ABI = [
  {
    type: "function",
    name: "deployAndAttach",
    stateMutability: "payable",
    inputs: [
      { name: "account", type: "address" },
      { name: "impl", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "initData", type: "bytes" },
      { name: "kernelDeadline", type: "uint256" },
      { name: "kernelSig", type: "bytes" },
    ],
    outputs: [{ name: "clone", type: "address" }],
  },
] as const;

/**
 * Per-template `initialize(...)` descriptor. `buildInitData` ABI-encodes the
 * initialize call the factory invokes on the fresh clone; `describe` renders the
 * human-readable bounds shown in the signing UI. Add an entry here to support a
 * new standalone clone template.
 */
type CloneInitParams = {
  permissionSigner: Address;
  tokens: Address[];
  spenders: Address[];
  max: bigint;
};
type CloneTemplateSpec = {
  label: string;
  buildInitData: (p: CloneInitParams) => Hex;
  describe: (p: CloneInitParams) => Array<{ label: string; value: string }>;
};

const CLONE_TEMPLATES: Record<string, CloneTemplateSpec> = {
  boundedApprove: {
    label: "Bounded Approve",
    buildInitData: (p) =>
      encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "initialize",
            stateMutability: "nonpayable",
            inputs: [
              { name: "allowedTokens", type: "address[]" },
              { name: "allowedSpenders", type: "address[]" },
              { name: "_maxAmountPerTx", type: "uint256" },
              { name: "_permissionSigner", type: "address" },
            ],
            outputs: [],
          },
        ] as const,
        functionName: "initialize",
        args: [p.tokens, p.spenders, p.max, p.permissionSigner],
      }),
    describe: (p) => [
      { label: "Allowed tokens", value: p.tokens.join(", ") },
      { label: "Allowed spenders", value: p.spenders.join(", ") },
      {
        label: "Max approval / tx",
        value: p.max === maxUint256 ? "unlimited (uint256 max)" : p.max.toString(),
      },
    ],
  },
};

/**
 * Compute an EIP-1167 clone's CREATE2 address off-chain, matching
 * MandateFactory: the raw salt is namespaced by the submitter (msg.sender of
 * deployAndAttach) as keccak256(abi.encode(submitter, salt)).
 */
function predictCloneAddress(
  impl: Address,
  factory: Address,
  submitter: Address,
  salt: Hex,
): Address {
  const namespacedSalt = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [submitter, salt]),
  );
  const initCode = concatHex([CLONE_INIT_PREFIX, impl, CLONE_INIT_SUFFIX]);
  return getCreate2Address({
    from: factory,
    salt: namespacedSalt,
    bytecodeHash: keccak256(initCode),
  });
}

function parseAddressList(csv: string | undefined, flag: string): Address[] {
  if (!csv) throw new Error(`${flag} is required (comma-separated address list)`);
  const list = csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) throw new Error(`${flag} is empty`);
  for (const a of list) {
    if (!isAddress(a, { strict: false })) throw new Error(`${flag} contains an invalid address: ${a}`);
  }
  return list.map((a) => getAddress(a));
}

export async function mandateDeployClone(options: DeployCloneOptions): Promise<void> {
  const project = requireProject();
  // Availability gate FIRST — before any signing server is spawned or gas spent.
  // No standalone clone templates are deployed against the current kernel on any
  // chain (standaloneTemplates is empty for all six). Erroring here, ahead of
  // createSigningChannel, also avoids leaving an orphaned ephemeral signing
  // server bound to a port for a command that cannot proceed.
  const templateMap = project.deployment.standaloneTemplates ?? {};
  if (Object.keys(templateMap).length === 0) {
    fail(
      new Error(
        `deploy-clone is unavailable on chain ${project.chainId}: no clone templates are ` +
          `deployed against this kernel (${project.deployment.kernel}) yet. ` +
          `Deploy your permission directly with \`sailor mandate deploy\` instead.`,
      ),
      options.json,
    );
  }
  const channel = await createSigningChannel(process.cwd());
  try {
    await channel.start();
    await runDeployClone(project, channel, options);
  } catch (err) {
    fail(err, options.json);
  } finally {
    channel.stop();
  }
}

async function runDeployClone(
  project: ProjectContext,
  channel: SigningChannel,
  options: DeployCloneOptions,
): Promise<void> {
  const json = !!options.json;
  const say = (fn: () => void) => {
    if (!json) fn();
  };

  if (!isAddress(options.sma, { strict: false })) throw new Error(`Invalid --sma address: ${options.sma}`);
  const sma = getAddress(options.sma);

  const spec = CLONE_TEMPLATES[options.template];
  if (!spec) {
    throw new Error(
      `Unsupported clone template "${options.template}". Supported: ${Object.keys(CLONE_TEMPLATES).join(", ")}`,
    );
  }

  // Guard: if no standalone templates have been deployed on this chain at all, give a
  // clear actionable error before any signing or gas is consumed.
  const templateMap = project.deployment.standaloneTemplates ?? {};
  if (Object.keys(templateMap).length === 0) {
    throw new Error(
      `No clone templates are available on chain ${project.chainId} yet — ` +
        `templates are pending redeployment against the new kernel (${project.deployment.kernel}). ` +
        `Deploy your permission directly with \`sailor mandate deploy\` instead.`,
    );
  }

  const impl = project.deployment.standaloneTemplates?.[options.template] as Address | undefined;
  if (!impl || !isAddress(impl, { strict: false })) {
    throw new Error(
      `No "${options.template}" standalone template is bundled for chain ${project.chainId}.`,
    );
  }

  const chain = getChainById(project.chainId);
  const publicClient = publicClientFor(project);
  const agentSigner = await loadManagerSigner();

  // SMA must be registered; read the on-chain mandate signer (the owner that
  // must sign in the browser, and the permissionSigner baked into the clone).
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

  const initParams: CloneInitParams = {
    permissionSigner,
    tokens: parseAddressList(options.tokens, "--tokens"),
    spenders: parseAddressList(options.spenders, "--spenders"),
    max: options.max ? BigInt(options.max) : maxUint256,
  };
  const initData = spec.buildInitData(initParams);

  // Deterministic-but-unique salt per (account, impl): namespaced by the
  // submitter inside the factory. The agent submits, so predict with the agent
  // address as msg.sender.
  const submitter = agentSigner.address as Address;
  const salt = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [sma, impl, BigInt(Math.floor(Date.now() / 1000))],
    ),
  );
  const clone = predictCloneAddress(impl, project.contracts.mandateFactory, submitter, salt);

  say(() => {
    console.log(`\n${spec.label} clone (${options.template})`);
    console.log(`  logic impl:      ${impl}`);
    console.log(`  predicted clone: ${clone}`);
    console.log(`  SMA:             ${sma}`);
    for (const d of spec.describe(initParams)) console.log(`  ${d.label}: ${d.value}`);
  });
  announceSigningUrl(json);

  // Owner signs RegisterPermission for the PREDICTED clone address.
  const nonce = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "signerNonces",
    args: [sma],
  })) as bigint;

  let registerPermissionHasDeadline = false;
  try {
    const caps = await detectKernelCapabilities(publicClient, project.contracts.kernel, {
      chainId: project.chainId,
    });
    registerPermissionHasDeadline = caps.registerPermissionHasDeadline;
  } catch {
    // advisory — proceed with noDeadline fallback
  }
  const deadline = registerPermissionHasDeadline
    ? BigInt(Math.floor(Date.now() / 1000) + 300)
    : undefined;

  const typedData = buildRegisterPermissionTypedData({
    chainId: project.chainId,
    kernel: project.contracts.kernel,
    account: sma,
    permission: clone,
    nonce,
    hasDeadline: registerPermissionHasDeadline,
    deadline,
  });

  const label = options.label ?? `${spec.label} (${options.template})`;
  say(() =>
    console.log(
      `Pushing signing request — the mandate signer (${permissionSigner}) must sign in the browser.`,
    ),
  );
  const response = await channel.requestSignature({
    type: "typed-data",
    kind: "register-permission",
    title: `Authorize "${label}"`,
    description: `Sign to authorize a new ${spec.label} permission on your SMA. The agent deploys and registers it in one transaction.`,
    chainId: project.chainId,
    details: [
      { label: "SMA", value: sma },
      { label: "Permission (predicted)", value: clone },
      { label: "Template", value: options.template },
      { label: "Mandate signer", value: permissionSigner },
      ...spec.describe(initParams),
    ],
    typedData,
  });

  if (response.status === "rejected") {
    throw new Error(`User rejected authorization: ${response.reason ?? "no reason given"}`);
  }
  if (response.status !== "signature") {
    throw new Error(`Expected EIP-712 signature response, got: ${response.status}`);
  }
  const signature = response.signature;

  // Security guard: the signature must come from the on-chain mandate signer.
  try {
    const recoveredSigner = await recoverTypedDataAddress({
      domain: sailKernelDomain({ chainId: project.chainId, kernel: project.contracts.kernel }),
      types: registerPermissionHasDeadline
        ? REGISTER_PERMISSION_TYPES
        : REGISTER_PERMISSION_TYPES_NO_DEADLINE,
      primaryType: "RegisterPermission",
      message: registerPermissionHasDeadline
        ? { account: sma, permission: clone, nonce, deadline: deadline! }
        : { account: sma, permission: clone, nonce },
      signature,
    });
    if (recoveredSigner.toLowerCase() !== permissionSigner.toLowerCase()) {
      throw new Error(
        `Security: RegisterPermission was signed by ${recoveredSigner} but the on-chain mandate signer is ${permissionSigner}.\n` +
          "Connect the owner wallet (mandate signer) in the browser — the agent wallet must never sign permission registrations.",
      );
    }
  } catch (err) {
    if ((err as Error).message.startsWith("Security:")) throw err;
  }

  // Fee charged by the kernel on registration (0 on zero-fee chains like Unichain).
  const fee = await estimatePermissionFee(publicClient, project.contracts.governance, clone);

  // The selective kernel's registerPermission takes a deadline; deployAndAttach
  // forwards whatever deadline the owner signed over. Conjunctive kernels (no
  // deadline) are not supported via deployAndAttach here.
  if (!registerPermissionHasDeadline || deadline === undefined) {
    throw new Error(
      "deploy-clone requires a selective kernel (RegisterPermission with deadline). This chain's kernel does not match.",
    );
  }

  say(() => console.log(`Submitting deployAndAttach (agent pays gas; fee ${fee} wei)…`));
  const walletClient = createWalletClient({
    account: agentSigner.viemAccount,
    chain,
    transport: http(getRpcUrl(project.chainId)),
  });
  const data = encodeFunctionData({
    abi: PERMISSION_FACTORY_ABI,
    functionName: "deployAndAttach",
    args: [sma, impl, salt, initData, deadline, signature],
  });
  const txHash = await walletClient.sendTransaction({
    to: project.contracts.mandateFactory,
    data,
    value: fee,
    account: agentSigner.viemAccount,
    chain,
  });

  say(() => console.log("Waiting for confirmation…"));
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`deployAndAttach reverted (tx ${txHash})`);
  }

  const attached = await pollForPermission(publicClient, project.contracts.kernel, sma, clone);
  if (!attached) {
    throw new Error(
      `Tx ${txHash} mined, but clone ${clone} is not in getPermissions(${sma}). Verify on-chain.`,
    );
  }
  say(() => console.log("✓", `Deployed + registered ${spec.label} at ${clone}`));

  const store = new MandateStore();
  const storedClone = store.add({
    name: label,
    address: clone,
    txHash,
    chainId: project.chainId,
    deployedAt: new Date().toISOString(),
  });
  store.recordAttachment(clone, { sma, txHash });
  appendActivity({
    ts: nowIso(),
    actor: "agent",
    type: "permission_registered",
    permission: clone,
    name: storedClone.name,
    sma,
    txHash,
    chainId: project.chainId,
  });

  emit(json, () => {}, {
    status: "ok",
    clone: { template: options.template, address: clone, impl, txHash, sma, chainId: project.chainId },
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
  if (!isAddress(options.sma, { strict: false })) throw new Error(`Invalid --sma address: ${options.sma}`);
  const sma = getAddress(options.sma);

  const store = new MandateStore();

  // `--address` accepts one entry (address or tracked name) or a comma-separated
  // list of addresses. The single-entry path is unchanged; a list registers all
  // of them in ONE signature via registerPermissions.
  if (options.address.includes(",")) {
    await runAttachBatch(project, channel, options, sma, store);
    return;
  }

  const tracked = store.find(options.address);
  const rawAddress = tracked?.address ?? options.address;
  if (!isAddress(rawAddress, { strict: false })) {
    throw new Error(
      `--address must be a deployed mandate address or a tracked name: ${options.address}`,
    );
  }
  const mandateAddress = getAddress(rawAddress);
  const label = options.label ?? tracked?.name ?? "mandate";

  const publicClient = publicClientFor(project);

  announceSigningUrl(json);

  const txHash = await attachToSma(
    project,
    channel,
    publicClient,
    sma,
    mandateAddress,
    label,
    json,
  );
  if (tracked) store.recordAttachment(mandateAddress, { sma, txHash });

  emit(json, () => {}, {
    status: "ok",
    attached: { sma, mandate: mandateAddress, txHash },
  });
}

/**
 * Batch path for `mandate attach --address <a>,<b>,<c>`: registers every
 * permission in ONE permission-signer signature via the kernel's
 * `registerPermissions`. Comma-separated entries must be addresses (tracked-name
 * resolution stays on the single-entry path). The shared batch txHash is recorded
 * against each tracked permission.
 */
async function runAttachBatch(
  project: ProjectContext,
  channel: SigningChannel,
  options: AttachOptions,
  sma: Address,
  store: MandateStore,
): Promise<void> {
  const json = !!options.json;
  const permissions = parseAddressList(options.address, "--address");

  const publicClient = publicClientFor(project);

  announceSigningUrl(json);

  const txHash = await attachBatchToSma(project, channel, publicClient, sma, permissions, json);

  for (const permission of permissions) {
    if (store.find(permission)) store.recordAttachment(permission, { sma, txHash });
  }

  emit(json, () => {}, {
    status: "ok",
    attached: permissions.map((mandate) => ({ sma, mandate, txHash })),
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
  if (!isAddress(options.sma, { strict: false })) throw new Error(`Invalid --sma address: ${options.sma}`);
  if (!options.all && !options.address) {
    throw new Error("Provide --address <permission> (or a tracked name), or --all");
  }

  const sma = getAddress(options.sma);
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
    const rawWanted = (tracked?.address ?? options.address) as string;
    if (!isAddress(rawWanted, { strict: false })) {
      throw new Error(`--address must be a permission address or a tracked name: ${options.address}`);
    }
    const wanted = getAddress(rawWanted);
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
  });
  announceSigningUrl(json);

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

/**
 * Register multiple permissions on an SMA in ONE permission-signer signature via
 * the kernel's `registerPermissions`. Mirrors the proven batch pattern in
 * `account rotate-signer` (rotate-signer.ts reattachMandates): the owner (mandate
 * signer) signs the RegisterPermissions EIP-712 in the browser; the agent wallet
 * submits and pays gas plus the summed registration fee. Returns the shared batch
 * txHash so the caller can record each attachment.
 */
async function attachBatchToSma(
  project: ProjectContext,
  channel: SigningChannel,
  publicClient: PublicClient,
  sma: Address,
  permissions: Address[],
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
    throw new Error(`SMA ${sma} is not registered with SailKernel; cannot register permissions.`);
  }

  const kernelConfig = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "configs",
    args: [sma],
  })) as [Address, Address, Address, boolean];
  const permissionSigner = kernelConfig[0];

  // Batch registration (registerPermissions, with deadline) is the selective-kernel
  // shape. All deployed kernels are selective; this is a loud guard, not a fallback —
  // if the kernel is ever not selective, refuse rather than sign the wrong shape.
  const caps = await detectKernelCapabilities(publicClient, project.contracts.kernel, {
    chainId: project.chainId,
  });
  if (caps.dispatchModel !== "selective") {
    throw new Error(
      `Batch attach requires a selective kernel, but ${project.contracts.kernel} reports ` +
        `dispatchModel="${caps.dispatchModel}". Attach permissions one at a time instead ` +
        `(sailor mandate attach --address <one> --sma ${sma}).`,
    );
  }

  const nonce = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "signerNonces",
    args: [sma],
  })) as bigint;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const typedData = buildRegisterPermissionsBatchTypedData({
    chainId: project.chainId,
    kernel: project.contracts.kernel,
    account: sma,
    permissions,
    nonce,
    deadline,
  });

  say(() =>
    console.log(
      `\nAttaching ${permissions.length} permissions in one signature — the mandate signer (${permissionSigner}) signs in the browser…`,
    ),
  );
  const response = await channel.requestSignature({
    type: "typed-data",
    kind: "register-permission",
    title: `Authorize ${permissions.length} permissions`,
    description: `Sign once to authorize ${permissions.length} permissions on your SMA. The agent submits the registration transaction and pays gas plus the registration fee.`,
    chainId: project.chainId,
    details: [
      { label: "SMA", value: sma },
      { label: "Permissions", value: String(permissions.length) },
      { label: "Mandate signer", value: permissionSigner },
    ],
    typedData,
  });

  if (response.status === "rejected") {
    throw new Error(`User rejected mandate authorization: ${response.reason ?? "no reason given"}`);
  }
  if (response.status !== "signature") {
    throw new Error(`Expected an EIP-712 signature response, got: ${response.status}`);
  }

  // Sum the exact per-permission fees (0 on the zero-fee deploys).
  let fee = 0n;
  for (const permission of permissions) {
    fee += await estimatePermissionFee(publicClient, project.contracts.governance, permission);
  }

  const chain = getChainById(project.chainId);
  const walletClient = createWalletClient({
    account: agentSigner.viemAccount,
    chain,
    transport: http(getRpcUrl(project.chainId)),
  });

  const registerData = encodeFunctionData({
    abi: SailKernelAbi,
    functionName: "registerPermissions",
    args: [sma, permissions, deadline, response.signature],
  });

  say(() => console.log(`Submitting batch registration (agent pays gas; fee ${fee} wei)…`));
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

  for (const permission of permissions) {
    const present = await pollForPermission(publicClient, project.contracts.kernel, sma, permission);
    appendActivity({
      ts: nowIso(),
      actor: "agent",
      type: "permission_registered",
      permission,
      sma,
      txHash,
      chainId: project.chainId,
    });
    say(() => {
      if (!present) {
        console.log(`⚠  ${permission} not yet visible in the permission set — verify on-chain.`);
      } else {
        console.log("✓", `${permission} present in getPermissions(${sma})`);
      }
    });
  }

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
      console.log("  1. Start from BoundedCallPermission.sol in mandates/ (targets + selectors + max ETH value)");
      console.log("  2. Implement IPermission.evaluate(txData, ctx) with your policy logic");
      console.log("  3. forge build");
      console.log("  4. sailor mandate deploy --contract <Name> --attach --sma <yourSMA>");
      console.log("\n  See examples/custom-mandate/README.md for the full guide.");

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

export function mandateContractsList(options: { json?: boolean } = {}): void {
  const store = new MandateStore();
  const mandates = store.list();
  emit(
    !!options.json,
    () => {
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
    },
    { status: "ok", mandates },
  );
}

// ── update ───────────────────────────────────────────────────────────────────

export function mandateUpdate(options: UpdateOptions): void {
  const { address, name, sourcePath, artifactPath, json } = options;
  if (!name && !sourcePath && !artifactPath) {
    throw new Error("Provide at least one of --name, --source-path, or --artifact-path");
  }
  const store = new MandateStore();
  const updated = store.update(address, { name, sourcePath, artifactPath });
  emit(!!json, () => {
    const changes: string[] = [];
    if (name) changes.push(`name → ${updated.name}`);
    if (sourcePath) changes.push(`sourcePath → ${updated.sourcePath}`);
    if (artifactPath) changes.push(`artifactPath → ${updated.artifactPath}`);
    console.log(`Updated ${updated.address}: ${changes.join(", ")}`);
  }, { status: "ok", mandate: updated });
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
  if (!resolved.startsWith(projectRoot + sep) && resolved !== projectRoot) {
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
