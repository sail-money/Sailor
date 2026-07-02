/**
 * sailor mandate configure — write the per-account bounds on an already-deployed
 * shared permission template (a ConfigurablePermission singleton).
 *
 *   sailor mandate configure --address <singleton> --sma <SMA> \
 *       --params 0x<abi-encoded-blob>
 *   sailor mandate configure --address <singleton> --sma <SMA> \
 *       --template SwapPermission --args-file config.json
 *
 * `sailor mandate attach` only REGISTERS a shared template on the kernel; a
 * registered-but-unconfigured singleton has `isConfigured == false` and the
 * kernel denies every call. This command performs the missing configure half.
 *
 * It drives `configureDirect(account, params)` — the path where the caller is the
 * SMA's `permissionSigner`. In the default Sailor onboarding the owner (browser
 * wallet) IS the permissionSigner, so this is a plain owner transaction routed
 * through the signing station: no EIP-712 `Configure` signature is required.
 *
 * Flow: resolve template address → encode/validate the config blob → off-chain
 * pre-flight `eth_call` of `configureDirect` (aborts on revert, before any gas) →
 * request the owner transaction via the signing station → wait for receipt →
 * verify `isConfigured(<SMA>) == true`. `--simulate-only` stops after pre-flight.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ConfigurablePermissionAbi,
  SailKernelAbi,
} from "@sail/sdk";
import { boundedSwapTemplate } from "@sail/sdk/templates";
import type { BoundedSwapParams } from "@sail/sdk/templates";
import {
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  encodeFunctionData,
  getAddress,
  getContractError,
  isAddress,
  isHex,
  publicActions,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { appendActivity, nowIso } from "../lib/io.js";
import { emit } from "../lib/output.js";
import { ProjectContext } from "../lib/project.js";
import {
  type SigningChannel,
  createSigningChannel,
  signingPageUrl,
} from "../signing/client.js";
import { projectPort } from "../lib/packagePaths.js";

export interface ConfigureOptions {
  /** Shared singleton address (already deployed on this chain). */
  address: string;
  /** Target SMA (Safe). */
  sma: string;
  /** Pre-encoded config blob (mutually exclusive with --args-file/--template). */
  params?: string;
  /** JSON file with typed config params; paired with --template. */
  argsFile?: string;
  /** Template name — resolves an encoder that turns --args-file into the blob. */
  template?: string;
  /** Human-readable label shown in the signing UI + recorded in the activity log. */
  label?: string;
  /** Stop after the off-chain pre-flight (no signing, no gas). */
  simulateOnly?: boolean;
  /** Re-configure even if isConfigured is already true. */
  force?: boolean;
  /** Emit machine-readable JSON. */
  json?: boolean;
}

/** Minimal EIP-712-ish field list a template's params decode to, for coercion. */
type TemplateEntry = {
  label: string;
  encode: (raw: Record<string, unknown>) => Hex;
  decode: (blob: Hex) => Record<string, unknown>;
  /** Field names that must be coerced JSON → bigint (base units). */
  bigintFields: readonly string[];
};

const TEMPLATE_REGISTRY: Record<string, TemplateEntry> = {
  SwapPermission: {
    label: "Bounded Swap (Uniswap V3)",
    bigintFields: ["maxAmountPerTx"] as const,
    encode: (raw) =>
      boundedSwapTemplate.encoder.encode(coerceSwapParams(raw)),
    decode: (blob) => {
      const p = boundedSwapTemplate.encoder.decode(blob);
      return {
        routers: p.routers,
        tokensIn: p.tokensIn,
        tokensOut: p.tokensOut,
        maxAmountPerTx: p.maxAmountPerTx.toString(),
        maxSlippageBps: p.maxSlippageBps,
        priceOracle: p.priceOracle,
        maxPriceAgeSec: p.maxPriceAgeSec,
      };
    },
  },
};

function asAddressArray(v: unknown, field: string): Address[] {
  if (!Array.isArray(v)) throw new Error(`${field}: expected an array of addresses`);
  return v.map((x, i) => {
    if (typeof x !== "string" || !isAddress(x, { strict: false })) {
      throw new Error(`${field}[${i}]: invalid address "${String(x)}"`);
    }
    return getAddress(x);
  });
}

function asAddress(v: unknown, field: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) {
    throw new Error(`${field}: invalid address "${String(v)}"`);
  }
  return getAddress(v);
}

function asUint(v: unknown, field: string): bigint {
  if (v === undefined || v === null) throw new Error(`${field}: missing`);
  try {
    return BigInt(typeof v === "string" || typeof v === "number" ? v : String(v));
  } catch {
    throw new Error(`${field}: expected an integer, got "${String(v)}"`);
  }
}

function asInt(v: unknown, field: string): number {
  const n = asUint(v, field);
  return Number(n);
}

function coerceSwapParams(raw: Record<string, unknown>): BoundedSwapParams {
  return {
    routers: asAddressArray(raw.routers, "routers"),
    tokensIn: asAddressArray(raw.tokensIn, "tokensIn"),
    tokensOut: asAddressArray(raw.tokensOut, "tokensOut"),
    maxAmountPerTx: asUint(raw.maxAmountPerTx, "maxAmountPerTx"),
    maxSlippageBps: asInt(raw.maxSlippageBps, "maxSlippageBps"),
    priceOracle: asAddress(raw.priceOracle, "priceOracle"),
    maxPriceAgeSec: asInt(raw.maxPriceAgeSec, "maxPriceAgeSec"),
  };
}

function requireProject(): ProjectContext {
  if (!ProjectContext.exists()) {
    console.log('No Sailor project found. Run "sailor init" first.');
    process.exit(1);
  }
  return new ProjectContext();
}

function fail(err: unknown, json = false): never {
  const msg = err instanceof Error ? err.message : String(err);
  emit(json, () => console.error(`\nMandate configure failed: ${msg}`), {
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

function announceSigningUrl(json: boolean): void {
  const url = signingPageUrl(projectPort(process.cwd()));
  if (json) {
    process.stdout.write(`${JSON.stringify({ status: "waiting_for_signature", url })}\n`);
  } else {
    console.log(`\n→ Open the Sailor dashboard to approve signing requests:\n  ${url}\n`);
  }
}

/** Resolve the config blob from --params (hex) or --args-file + --template. */
function resolveBlob(options: ConfigureOptions): { blob: Hex; via: string } {
  const hasParams = options.params !== undefined;
  const hasArgsFile = options.argsFile !== undefined;

  if (hasParams && hasArgsFile) {
    throw new Error("Provide EITHER --params <hex> OR --args-file <path>, not both.");
  }
  if (!hasParams && !hasArgsFile) {
    throw new Error(
      "Provide the config blob as --params <0x-hex>, or as --args-file <path> paired with --template <Name>.",
    );
  }

  if (hasParams) {
    const raw = options.params!.trim();
    if (!isHex(raw) || raw.length <= 2) {
      throw new Error(`--params must be 0x-prefixed hex; got "${options.params}".`);
    }
    return { blob: raw as Hex, via: "params" };
  }

  // --args-file + --template
  const templateName = options.template;
  if (!templateName) {
    throw new Error("--args-file requires --template <Name> (e.g. SwapPermission).");
  }
  const entry = TEMPLATE_REGISTRY[templateName];
  if (!entry) {
    throw new Error(
      `Unknown --template "${templateName}". Known: ${Object.keys(TEMPLATE_REGISTRY).join(", ")}. ` +
        `Pass a pre-encoded blob with --params for any other template.`,
    );
  }

  const argsFilePath = resolve(options.argsFile!);
  let raw: string;
  try {
    raw = readFileSync(argsFilePath, "utf8").trim();
  } catch {
    throw new Error(`Cannot read --args-file: ${argsFilePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`--args-file is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--args-file must contain a JSON object of template params.");
  }
  const blob = entry.encode(parsed as Record<string, unknown>);
  return { blob, via: `template:${templateName}` };
}

export async function mandateConfigure(options: ConfigureOptions): Promise<void> {
  const project = requireProject();
  const channel = await createSigningChannel(process.cwd());
  try {
    await channel.start();
    await runConfigure(project, channel, options);
  } catch (err) {
    fail(err, options.json);
  } finally {
    channel.stop();
  }
}

async function runConfigure(
  project: ProjectContext,
  channel: SigningChannel,
  options: ConfigureOptions,
): Promise<void> {
  const json = !!options.json;
  const say = (fn: () => void) => {
    if (!json) fn();
  };

  if (!isAddress(options.sma, { strict: false })) {
    throw new Error(`Invalid --sma address: ${options.sma}`);
  }
  if (!isAddress(options.address, { strict: false })) {
    throw new Error(
      `--address must be a deployed shared-template singleton address: ${options.address}`,
    );
  }
  const sma = getAddress(options.sma);
  const singleton = getAddress(options.address);

  const { blob, via } = resolveBlob(options);

  const publicClient = publicClientFor(project);

  // SMA must be registered with the kernel; read the on-chain permissionSigner
  // (the owner that must send the configureDirect tx — msg.sender == permissionSigner).
  const registered = await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "registered",
    args: [sma],
  });
  if (!registered) {
    throw new Error(`SMA ${sma} is not registered with SailKernel; cannot configure a permission for it.`);
  }
  const kernelConfig = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "configs",
    args: [sma],
  })) as [Address, Address, Address, Address, boolean];
  const permissionSigner = kernelConfig[0];
  if (!permissionSigner || permissionSigner === getAddress("0x0000000000000000000000000000000000000000")) {
    throw new Error(`SMA ${sma} has no on-chain permissionSigner; cannot configure.`);
  }

  // Idempotency: if already configured, stop unless --force.
  const alreadyConfigured = await publicClient.readContract({
    address: singleton,
    abi: ConfigurablePermissionAbi,
    functionName: "isConfigured",
    args: [sma],
  });
  if (alreadyConfigured && !options.force) {
    say(() =>
      console.log(
        `\n✓ ${singleton} is already configured for ${sma} (isConfigured == true).\n` +
          `  Re-run with --force to overwrite the current bounds.`,
      ),
    );
    emit(
      json,
      () => {},
      { status: "ok", alreadyConfigured: true, singleton, sma, chainId: project.chainId },
    );
    return;
  }

  const nonce = (await publicClient.readContract({
    address: singleton,
    abi: ConfigurablePermissionAbi,
    functionName: "configNonces",
    args: [sma],
  })) as bigint;

  say(() => {
    console.log(`\nconfigure ${singleton}`);
    console.log(`  SMA:              ${sma}`);
    console.log(`  permissionSigner: ${permissionSigner}  (must sign in the browser — owner tx)`);
    console.log(`  current nonce:   ${nonce}`);
    console.log(`  already set:     ${alreadyConfigured ? "yes (--force will overwrite)" : "no"}`);
    console.log(`  config blob:     ${blob}  (via ${via}, ${Math.floor((blob.length - 2) / 2)} bytes)`);
  });

  // ── Pre-flight: off-chain eth_call of configureDirect from the permissionSigner.
  // Aborts on revert BEFORE any signing or gas. A revert here means the blob is
  // invalid for this template's _applyConfig (encoding gotcha) or the bounds
  // violate an internal check. simulateContract sets eth_call `from` = permissionSigner
  // so configureDirect's msg.sender == permissionSigner check holds in the sim.
  const configureDirectData = encodeFunctionData({
    abi: ConfigurablePermissionAbi,
    functionName: "configureDirect",
    args: [sma, blob],
  });

  say(() => console.log(`\nPre-flight (eth_call of configureDirect, no gas)…`));
  try {
    await publicClient.simulateContract({
      address: singleton,
      abi: ConfigurablePermissionAbi,
      functionName: "configureDirect",
      args: [sma, blob],
      account: permissionSigner,
    });
  } catch (err) {
    const ce = getContractError(err as Error, {
      abi: ConfigurablePermissionAbi as unknown as Abi,
      address: singleton,
      args: [sma, blob],
      functionName: "configureDirect",
    });
    const reason = (ce as Error)?.message ?? (err as Error)?.message ?? String(err);
    throw new Error(
      `Pre-flight reverted — the config blob is invalid for ${singleton} on ${sma}.\n` +
        `  Revert: ${reason}\n` +
        `  This is the encoding gotcha (flat params vs wrapped struct) or an internal bound check. ` +
        `Re-encode per the template's _applyConfig tuple and retry.`,
    );
  }
  say(() => console.log("✓ pre-flight passed (configureDirect would succeed)."));

  // Round-trip decode against the registry if we encoded via a known template,
  // so the operator sees what the contract will store before signing.
  let decoded: Record<string, unknown> | undefined;
  if (options.template && TEMPLATE_REGISTRY[options.template]) {
    try {
      decoded = TEMPLATE_REGISTRY[options.template].decode(blob);
      say(() => {
        console.log("\nDecoded bounds (what the singleton will store):");
        for (const [k, v] of Object.entries(decoded!)) {
          const display = Array.isArray(v) ? v.join(", ") : String(v);
          console.log(`  ${k}: ${display}`);
        }
      });
    } catch {
      // best-effort — the pre-flight already validated; decode failure is informational
    }
  }

  if (options.simulateOnly) {
    emit(
      json,
      () => {
        console.log("\n--simulate-only: stopping after pre-flight (no signing, no gas).");
      },
      {
        status: "ok",
        simulateOnly: true,
        singleton,
        sma,
        permissionSigner,
        nonce: nonce.toString(),
        alreadyConfigured,
        blob,
        blobBytes: Math.floor((blob.length - 2) / 2),
        decoded,
        chainId: project.chainId,
      },
    );
    return;
  }

  // ── Request the owner transaction through the signing station.
  const label = options.label ?? (options.template ?? "shared-template");
  announceSigningUrl(json);
  say(() =>
    console.log(
      `Pushing configure request — the mandate signer (${permissionSigner}) must approve in the browser…`,
    ),
  );

  const response = await channel.requestSignature({
    type: "transaction",
    kind: "arbitrary-tx",
    title: `Configure "${label}"`,
    description:
      `Write per-account bounds on the shared permission ${singleton}.\n` +
      "You (the mandate signer) send the transaction — configureDirect requires msg.sender to be the permissionSigner.",
    chainId: project.chainId,
    to: singleton,
    data: configureDirectData,
    details: [
      { label: "SMA", value: sma },
      { label: "Singleton", value: singleton },
      { label: "Template", value: options.template ?? "(raw blob)" },
      { label: "Mandate signer", value: permissionSigner },
      { label: "Config blob (bytes)", value: String(Math.floor((blob.length - 2) / 2)) },
      ...(decoded
        ? Object.entries(decoded).map(([k, v]) => ({
            label: k,
            value: Array.isArray(v) ? v.join(", ") : String(v),
          }))
        : []),
    ],
  });

  if (response.status === "rejected") {
    throw new Error(`User rejected configure: ${response.reason ?? "no reason given"}`);
  }
  if (response.status !== "signed") {
    throw new Error(`Expected a signed transaction, got: ${response.status}`);
  }

  say(() => console.log("Waiting for confirmation…"));
  const receipt = await publicClient.waitForTransactionReceipt({ hash: response.txHash });
  if (receipt.status !== "success") {
    throw new Error(`configureDirect transaction failed (tx ${response.txHash})`);
  }

  // ── Verify isConfigured == true on-chain.
  const configuredNow = await publicClient.readContract({
    address: singleton,
    abi: ConfigurablePermissionAbi,
    functionName: "isConfigured",
    args: [sma],
  });
  if (!configuredNow) {
    throw new Error(
      `Tx ${response.txHash} mined, but isConfigured(${sma}) is still false. Verify on-chain.`,
    );
  }
  say(() => console.log("✓", `Configured ${singleton} for ${sma} (isConfigured == true).`));

  appendActivity({
    ts: nowIso(),
    actor: "owner",
    type: "permission_configured",
    permission: singleton,
    name: label,
    sma,
    txHash: response.txHash,
    chainId: project.chainId,
  });

  emit(
    json,
    () => {
      console.log(
        `\nNext: prove it accepts/rejects the right calls before dispatching:\n` +
          `  sailor mandate simulate --address ${singleton} --sma ${sma} --calls ./probe.json`,
      );
    },
    {
      status: "ok",
      singleton,
      sma,
      template: options.template,
      permissionSigner,
      txHash: response.txHash,
      blob,
      chainId: project.chainId,
    },
  );
}
