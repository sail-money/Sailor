/**
 * `sailor mandate simulate` — verify a permission against sample calls BEFORE
 * authorizing it on-chain.
 *
 * This is pure verification tooling. It spends NO gas, signs nothing, and sends
 * no transaction: every probe is an `eth_call` against the permission's
 * `evaluate(txData, ctx)` view. It answers exactly one question —
 *
 *     "for THESE calls, what does this permission's evaluate() return?"
 *
 * — so the user can prove "this permission accepts the calls I want and rejects
 * the ones I don't" before paying registration gas and signing authorization.
 *
 * It does NOT guarantee the permission is correct, does NOT decide anything, and
 * does NOT model protocol economics. It removes the "I had no way to know"
 * failure mode; nothing more.
 *
 * The Context passed to evaluate() is built by buildPermissionContext() — the
 * SAME builder the runner uses on a real dispatch — so the probe reflects real
 * dispatch behaviour rather than a divergent approximation.
 */

import { readFileSync } from "node:fs";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  getAddress,
  isAddress,
  isHex,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { checkContractExists } from "../lib/contract-check.js";
import { readJsonFile, sailPath } from "../lib/io.js";
import { resolveKeyPath } from "../lib/keys.js";
import { MandateStore } from "../lib/mandates.js";
import { emit } from "../lib/output.js";
import { probePermissionForCall } from "../lib/permission-resolver.js";
import { ProjectContext } from "../lib/project.js";
import type { StoredAccount } from "../lib/state.js";

export interface SimulateOptions {
  address: string;
  sma?: string;
  target?: string;
  calldata?: string;
  value?: string;
  expect?: string;
  label?: string;
  calls?: string;
  json?: boolean;
}

/** A single sample call to probe, after parsing/validation. */
type SampleCall = {
  label: string;
  target: Address;
  data: Hex;
  value: bigint;
  expect?: "pass" | "fail";
};

/** Per-call probe outcome, ready for human or JSON rendering. */
type CallResult = {
  index: number;
  label: string;
  target: Address;
  value: string;
  /** "pass" when evaluate() returned true, else "fail". */
  result: "pass" | "fail";
  /** True when evaluate() reverted (vs. returned false). */
  reverted: boolean;
  revertReason?: string;
  expect: "pass" | "fail" | null;
  /** null when no expectation was supplied; otherwise whether actual === expect. */
  match: boolean | null;
  /** Contract-existence of the target (eth_getCode). */
  targetHasCode: boolean;
  targetCheckError?: string;
};

function parseExpect(raw: string | undefined, where: string): "pass" | "fail" | undefined {
  if (raw === undefined) return undefined;
  const v = raw.toLowerCase();
  if (v === "pass" || v === "fail") return v;
  throw new Error(`${where}: "expect" must be "pass" or "fail" — got "${raw}".`);
}

/** Parse and validate the sample calls from inline flags or a --calls JSON file. */
function resolveSampleCalls(options: SimulateOptions): SampleCall[] {
  const hasInline = options.target !== undefined || options.calldata !== undefined;
  if (options.calls && hasInline) {
    throw new Error("Provide EITHER --calls <file> OR inline --target/--calldata, not both.");
  }

  if (options.calls) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(options.calls, "utf8"));
    } catch (err) {
      throw new Error(`Could not read --calls file "${options.calls}": ${(err as Error).message}`);
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(`--calls file must be a non-empty JSON array of { target, calldata, ... }.`);
    }
    return raw.map((entry, i) => parseCallEntry(entry as Record<string, unknown>, i));
  }

  if (!hasInline) {
    throw new Error(
      "No sample calls. Pass --target <addr> --calldata <hex> for one call, " +
        "or --calls <file.json> for a batch.",
    );
  }
  if (!options.target || !options.calldata) {
    throw new Error("Inline call requires BOTH --target <addr> and --calldata <hex>.");
  }
  return [
    parseCallEntry(
      {
        target: options.target,
        calldata: options.calldata,
        value: options.value,
        expect: options.expect,
        label: options.label,
      },
      0,
    ),
  ];
}

function parseCallEntry(entry: Record<string, unknown>, index: number): SampleCall {
  const where = `call[${index}]`;
  const target = entry.target;
  if (typeof target !== "string" || !isAddress(target, { strict: false })) {
    throw new Error(`${where}: "target" must be a valid address — got ${JSON.stringify(target)}.`);
  }
  const data = entry.calldata ?? entry.data;
  if (typeof data !== "string" || !isHex(data)) {
    throw new Error(`${where}: "calldata" must be a 0x-prefixed hex string.`);
  }
  let value = 0n;
  if (entry.value !== undefined && entry.value !== null && entry.value !== "") {
    try {
      value = BigInt(entry.value as string | number);
    } catch {
      throw new Error(`${where}: "value" must be an integer (wei) — got ${JSON.stringify(entry.value)}.`);
    }
  }
  const label =
    typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : `call ${index + 1}`;
  return {
    label,
    target: getAddress(target),
    data: data as Hex,
    value,
    expect: parseExpect(entry.expect as string | undefined, where),
  };
}

/** Read the manager (agent) wallet address without decrypting the keystore. */
function managerAddress(safe: string | undefined): Address | null {
  const stored = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (stored?.manager && isAddress(stored.manager, { strict: false })) {
    return getAddress(stored.manager);
  }
  const ks = readJsonFile<{ address?: string }>(resolveKeyPath("manager", safe));
  return ks?.address ? getAddress(`0x${ks.address.replace(/^0x/, "")}`) : null;
}

export async function mandateSimulate(options: SimulateOptions): Promise<void> {
  const json = !!options.json;
  const project = new ProjectContext();
  const chainId = project.chainId;
  const rpcUrl = getRpcUrl(chainId) ?? getChainById(chainId).rpcUrls.default.http[0];
  const pc = createPublicClient({ chain: getChainById(chainId), transport: http(rpcUrl) });

  // ── Resolve the permission to probe (address or a locally-tracked name) ──────
  const store = new MandateStore();
  const tracked = store.find(options.address);
  const rawPermission = tracked?.address ?? options.address;
  if (!isAddress(rawPermission, { strict: false })) {
    throw new Error(`--address must be a permission address or a tracked name: ${options.address}`);
  }
  const permission = getAddress(rawPermission);

  // ── Resolve the SMA (ctx.account) and the manager (ctx.submitter) ────────────
  const stored = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (options.sma && !isAddress(options.sma, { strict: false })) {
    throw new Error(`Invalid --sma address: ${options.sma}`);
  }
  const accountRaw = options.sma ?? stored?.safe;
  if (!accountRaw) {
    throw new Error("No SMA. Pass --sma <address> or create one (.sail/account.json).");
  }
  const account = getAddress(accountRaw);

  // The runner submits dispatches from the manager (agent) wallet, so it is the
  // submitter in ctx. Fall back to the account address when no manager key is
  // available locally (e.g. pre-key-gen) — noted in the output so the user knows
  // the probe used a stand-in submitter.
  const resolvedManager = managerAddress(stored?.safe);
  const manager = resolvedManager ?? account;
  const managerIsStandIn = resolvedManager === null;

  const calls = resolveSampleCalls(options);

  // Fetch the current block once — time/block-gated permissions need real values
  // to avoid false negatives, matching what the runner feeds evaluate().
  let blockInfo = { number: 0n, timestamp: 0n };
  try {
    const block = await pc.getBlock();
    blockInfo = { number: block.number ?? 0n, timestamp: block.timestamp ?? 0n };
  } catch {
    // RPC hiccup — probe proceeds with zeros; per-call errors will surface below.
  }

  // ── Probe each call (eth_call only — NO gas, NO signing) ─────────────────────
  const results: CallResult[] = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const [probe, codeCheck] = await Promise.all([
      probePermissionForCall({
        publicClient: pc,
        permission,
        account,
        manager,
        call: { target: c.target, value: c.value, data: c.data },
        blockInfo,
      }),
      checkContractExists(pc, c.target),
    ]);
    const result: "pass" | "fail" = probe.accepted ? "pass" : "fail";
    results.push({
      index: i,
      label: c.label,
      target: c.target,
      value: c.value.toString(),
      result,
      reverted: probe.reverted,
      revertReason: probe.error,
      expect: c.expect ?? null,
      match: c.expect ? c.expect === result : null,
      targetHasCode: codeCheck.hasCode,
      targetCheckError: codeCheck.error,
    });
  }

  const mismatches = results.filter((r) => r.match === false);
  const noCodeTargets = results.filter((r) => !r.targetHasCode && !r.targetCheckError);
  const ok = mismatches.length === 0;

  if (json) {
    emit(true, () => {}, {
      status: ok ? "ok" : "mismatch",
      spendsGas: false,
      probe: "off-chain eth_call (evaluate)",
      chainId,
      permission,
      sma: account,
      submitter: manager,
      submitterIsStandIn: managerIsStandIn,
      blockNumber: blockInfo.number.toString(),
      results: results.map((r) => ({
        index: r.index,
        label: r.label,
        target: r.target,
        value: r.value,
        result: r.result,
        reverted: r.reverted,
        revertReason: r.revertReason,
        expect: r.expect,
        match: r.match,
        targetHasCode: r.targetHasCode,
        targetCheckError: r.targetCheckError,
      })),
      mismatches: mismatches.length,
      noCodeTargets: noCodeTargets.map((r) => r.target),
      ok,
    });
    if (!ok) process.exit(1);
    return;
  }

  // ── Human-readable rendering ─────────────────────────────────────────────────
  console.log("\nsailor mandate simulate — off-chain probe (eth_call). Spends NO gas, signs nothing.");
  console.log(
    "Shows what the permission's evaluate() returns for these calls. It does NOT guarantee\n" +
      "the permission is correct — only what it does for exactly these inputs.",
  );
  console.log("────────────────────────────────────────");
  console.log(`Permission: ${permission}`);
  console.log(`SMA:        ${account}`);
  console.log(
    `Submitter:  ${manager}${managerIsStandIn ? "  (stand-in: no manager key found locally)" : "  (agent wallet)"}`,
  );
  console.log(`Chain:      ${chainId}   block ${blockInfo.number}`);
  console.log("");

  for (const r of results) {
    const verdict = r.result === "pass" ? "PASS  " : r.reverted ? "REVERT" : "FAIL  ";
    const expectStr =
      r.expect === null
        ? ""
        : r.match
          ? `  expected ${r.expect}  ✓ MATCH`
          : `  expected ${r.expect}  ✗ MISMATCH`;
    console.log(`[${r.index + 1}] ${verdict}  ${r.label}${expectStr}`);
    const codeNote = r.targetCheckError
      ? `⚠ could not verify contract code (${r.targetCheckError})`
      : r.targetHasCode
        ? "✓ contract present"
        : `⚠ NO contract code on chain ${chainId} — this call would fail on-chain regardless of the permission`;
    console.log(`     target ${r.target}   ${codeNote}`);
    if (r.reverted && r.revertReason) {
      console.log(`     evaluate() reverted: ${r.revertReason}`);
    }
  }

  console.log("");
  if (results.every((r) => r.expect === null)) {
    console.log(`Probed ${results.length} call(s). No expectations were supplied (informational only).`);
  } else {
    const matched = results.filter((r) => r.match === true).length;
    const checked = results.filter((r) => r.expect !== null).length;
    if (ok) {
      console.log(`Result: ${matched}/${checked} matched expectations. ✓`);
    } else {
      console.log(`Result: ${matched}/${checked} matched, ${mismatches.length} MISMATCH. ✗`);
    }
  }
  if (noCodeTargets.length > 0) {
    console.log(
      `⚠ ${noCodeTargets.length} target(s) have no contract code on chain ${chainId} — ` +
        "likely a wrong or wrong-chain address.",
    );
  }

  if (!ok) process.exit(1);
}
