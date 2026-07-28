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
import { checkContractExists, checkSelectorRoutes } from "../lib/contract-check.js";
import { readActiveAccount, readJsonFile, sailPath } from "../lib/io.js";
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
  summary?: boolean;
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
export type CallResult = {
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
  /**
   * Whether the 4-byte selector in calldata routes on the target contract.
   * null = proxy/delegatecall detected or calldata < 4 bytes (indeterminate).
   */
  selectorRoutes: boolean | null;
  /** The 4-byte selector (8 hex chars, no 0x prefix) that was checked. */
  selector: string;
  /** Human-readable reason when selectorRoutes is null. */
  selectorRoutesReason?: string;
};

/** Counts + the mismatching entries — everything `--summary` needs, nothing more. */
export type ProbeSummary = {
  /** Total probes run. */
  total: number;
  /** How many evaluate() returned true / false (independent of expectations). */
  passed: number;
  failed: number;
  /** How many probes carried an `expect`, and how many of those matched. */
  checked: number;
  matched: number;
  /** The full entries whose actual outcome contradicted `expect`. */
  mismatches: CallResult[];
};

/**
 * Reduce a probe run to counts plus the entries that actually need reading.
 *
 * `--json` alone returns one object per probe — several KB for a typical
 * generated probe set, all of which the calling agent must read back just to
 * confirm its own verification passed. `--summary` keeps the counts and the
 * mismatches (the only entries whose detail changes what the agent does next).
 */
export function summarizeResults(results: CallResult[]): ProbeSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.result === "pass").length,
    failed: results.filter((r) => r.result === "fail").length,
    checked: results.filter((r) => r.expect !== null).length,
    matched: results.filter((r) => r.match === true).length,
    mismatches: results.filter((r) => r.match === false),
  };
}

/** The per-entry JSON shape — identical under `--json` and `--summary`. */
function serializeResult(r: CallResult) {
  return {
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
    selector: r.selector,
    selectorRoutes: r.selectorRoutes,
    selectorRoutesReason: r.selectorRoutesReason,
  };
}

/** Render one probe in full — shared by the full listing and `--summary`'s mismatch detail. */
function printCallDetail(r: CallResult, chainId: number): void {
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
  const selectorNote =
    r.selectorRoutes === true
      ? `✓ selector 0x${r.selector} routes`
      : r.selectorRoutes === false
        ? `⚠ selector 0x${r.selector} NOT found in bytecode — call would likely revert with unknown selector`
        : r.selectorRoutesReason
          ? `~ selector check skipped (${r.selectorRoutesReason})`
          : null;
  console.log(`     target ${r.target}   ${codeNote}`);
  if (selectorNote) console.log(`     ${selectorNote}`);
  if (r.reverted && r.revertReason) {
    console.log(`     evaluate() reverted: ${r.revertReason}`);
  }
}

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
  const stored = readActiveAccount();
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
  const stored = readActiveAccount();
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
  // Use options.sma (if overridden) for keystore path resolution so the manager
  // key lookup stays consistent with the account being probed.
  const resolvedManager = managerAddress(options.sma ?? stored?.safe);
  const manager = resolvedManager ?? account;
  const managerIsStandIn = resolvedManager === null;

  const calls = resolveSampleCalls(options);

  // Fetch the current block once — time/block-gated permissions need real values
  // to avoid false negatives, matching what the runner feeds evaluate().
  let blockInfo = { number: 0n, timestamp: 0n };
  let blockStale = false;
  try {
    const block = await pc.getBlock();
    blockInfo = { number: block.number ?? 0n, timestamp: block.timestamp ?? 0n };
  } catch {
    // RPC hiccup — probe proceeds with zeros. Warn: time/block-gated permissions
    // will see timestamp=0 / blockNumber=0 and may produce false negatives.
    blockStale = true;
  }

  // ── Probe all calls concurrently (eth_call only — NO gas, NO signing) ────────
  const results: CallResult[] = await Promise.all(
    calls.map(async (c, i) => {
      const [probe, codeCheck] = await Promise.all([
        probePermissionForCall({
          publicClient: pc,
          kernel: project.contracts.kernel,
          permission,
          account,
          manager,
          call: { target: c.target, value: c.value, data: c.data },
          blockInfo,
        }),
        checkContractExists(pc, c.target),
      ]);
      const result: "pass" | "fail" = probe.accepted ? "pass" : "fail";
      const selectorCheck =
        codeCheck.hasCode && codeCheck.bytecode
          ? checkSelectorRoutes(c.data, codeCheck.bytecode)
          : { selector: "", routes: null as null, reason: codeCheck.hasCode ? "bytecode unavailable" : undefined };
      return {
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
        selectorRoutes: selectorCheck.routes,
        selector: selectorCheck.selector,
        selectorRoutesReason: selectorCheck.reason,
      };
    }),
  );

  const meta: SimulateMeta = {
    chainId,
    permission,
    sma: account,
    submitter: manager,
    submitterIsStandIn: managerIsStandIn,
    blockNumber: blockInfo.number.toString(),
    blockContextStale: blockStale,
  };
  const brief = !!options.summary;

  if (json) {
    emit(true, () => {}, buildSimulateJson(results, meta, brief));
  } else {
    renderSimulateHuman(results, meta, brief);
  }

  if (summarizeResults(results).mismatches.length > 0) process.exit(1);
}

/** Run-level facts shared by every rendering of a probe run. */
export type SimulateMeta = {
  chainId: number;
  permission: Address;
  sma: Address;
  submitter: Address;
  submitterIsStandIn: boolean;
  blockNumber: string;
  blockContextStale: boolean;
};

/**
 * The `--json` payload. With `brief` (i.e. `--summary`) the envelope and the
 * per-entry shape are unchanged — `results` is simply narrowed to the
 * mismatches, and the counts that the omitted entries would have carried are
 * given as totals. Without it the payload is byte-for-byte what it always was.
 */
export function buildSimulateJson(
  results: CallResult[],
  meta: SimulateMeta,
  brief: boolean,
): Record<string, unknown> {
  const summary = summarizeResults(results);
  const noCodeTargets = results.filter((r) => !r.targetHasCode && !r.targetCheckError);
  const ok = summary.mismatches.length === 0;
  const head = {
    status: ok ? "ok" : "mismatch",
    spendsGas: false,
    probe: "off-chain eth_call (evaluate)",
    ...meta,
  };
  const tail = {
    mismatches: summary.mismatches.length,
    noCodeTargets: noCodeTargets.map((r) => r.target),
    ok,
  };
  if (!brief) {
    return { ...head, results: results.map(serializeResult), ...tail };
  }
  return {
    ...head,
    mode: "summary",
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    checked: summary.checked,
    matched: summary.matched,
    results: summary.mismatches.map(serializeResult),
    resultsOmitted: summary.total - summary.mismatches.length,
    ...tail,
  };
}

/** Human-readable rendering — full listing, or (with `brief`) counts + mismatches only. */
export function renderSimulateHuman(
  results: CallResult[],
  meta: SimulateMeta,
  brief: boolean,
): void {
  const { chainId } = meta;
  const summary = summarizeResults(results);
  const noCodeTargets = results.filter((r) => !r.targetHasCode && !r.targetCheckError);
  const ok = summary.mismatches.length === 0;

  if (brief) {
    console.log(
      `sailor mandate simulate — ${summary.total} probe(s): ` +
        `${summary.passed} pass, ${summary.failed} fail  ` +
        `(${summary.matched}/${summary.checked} matched expectations)`,
    );
    if (ok) {
      console.log("No mismatches. ✓");
    } else {
      console.log(`${summary.mismatches.length} MISMATCH — full detail below. ✗\n`);
      for (const r of summary.mismatches) printCallDetail(r, chainId);
    }
    if (noCodeTargets.length > 0) {
      console.log(`⚠ ${noCodeTargets.length} target(s) have no contract code on chain ${chainId}.`);
    }
    return;
  }

  console.log("\nsailor mandate simulate — off-chain probe (eth_call). Spends NO gas, signs nothing.");
  console.log(
    "Shows what the permission's evaluate() returns for these calls. It does NOT guarantee\n" +
      "the permission is correct — only what it does for exactly these inputs.",
  );
  console.log("────────────────────────────────────────");
  console.log(`Permission: ${meta.permission}`);
  console.log(`SMA:        ${meta.sma}`);
  console.log(
    `Submitter:  ${meta.submitter}${meta.submitterIsStandIn ? "  (stand-in: no manager key found locally)" : "  (agent wallet)"}`,
  );
  console.log(`Chain:      ${chainId}   block ${meta.blockNumber}${meta.blockContextStale ? "  ⚠ could not fetch block — time/block-gated permissions may show false negatives" : ""}`);
  console.log("");

  for (const r of results) printCallDetail(r, chainId);

  console.log("");
  if (results.every((r) => r.expect === null)) {
    console.log(`Probed ${results.length} call(s). No expectations were supplied (informational only).`);
  } else if (ok) {
    console.log(`Result: ${summary.matched}/${summary.checked} matched expectations. ✓`);
  } else {
    console.log(
      `Result: ${summary.matched}/${summary.checked} matched, ${summary.mismatches.length} MISMATCH. ✗`,
    );
  }
  if (noCodeTargets.length > 0) {
    console.log(
      `⚠ ${noCodeTargets.length} target(s) have no contract code on chain ${chainId} — ` +
        "likely a wrong or wrong-chain address.",
    );
  }
}
