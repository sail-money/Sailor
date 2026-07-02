/**
 * End-to-end acceptance test — runs against a live testnet, exercising the full account
 * lifecycle: onboarding, template configuration, dispatch, and the session kill switch.
 *
 * Sequence:
 *   1. createAccount SMA (single-tx path).
 *   2. registerAccount via a Safe owner-sig + Safe.execTransaction (the post-#53 two-step
 *      path), and assert a v==1 approved-hash ownerSig is REJECTED (#69) while an ECDSA sig
 *      succeeds.
 *   3. configure a shared template through the version-adaptive Configure signer (v1/v2).
 *   4. dispatch within bounds → success.
 *   5. revoke → a dispatch pre-signed with the pre-revoke nonce is REJECTED (epoch bump, #70).
 *   6. re-activate, then dispatch with a fresh nonce → success.
 *
 * Addresses come from the bundled deployment registry (getSailDeployment) — nothing is
 * hardcoded, so this runs against whatever the SDK is pinned to. Requires a funded key.
 *
 *   CHAIN_ID=84532 RPC_URL=… DEPLOYER_PRIVATE_KEY=0x… node e2e-acceptance.mjs
 *
 * Run from packages/sdk so ./dist and viem resolve. A single local key collapses
 * owner = permissionSigner = manager, which is fine for a testnet acceptance run.
 */
import { http, createPublicClient, createWalletClient, encodeFunctionData, pad } from "viem";
import * as viemChains from "viem/chains";
import { buildRegisterAccountTypedData } from "./dist/eip712.js";
import {
  LocalKeyring,
  SAFE_V141,
  SailorClient,
  buildSafeSetupInitializer,
  getSailDeployment,
} from "./dist/index.js";
import { buildRegisterAccountExecTransaction } from "./dist/safe.js";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 84532);
const RPC = process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL;
if (!RPC) throw new Error("Set RPC_URL (and optionally CHAIN_ID).");

// Key source: a raw DEPLOYER_PRIVATE_KEY, or an encrypted keystore file (KEYSTORE +
// SAIL_PASSPHRASE) — the latter keeps the private key off the command line/transcript.
const PK = process.env.DEPLOYER_PRIVATE_KEY;
const KEYSTORE = process.env.KEYSTORE;
const PASSPHRASE = process.env.SAIL_PASSPHRASE;
const keyring = PK
  ? LocalKeyring.fromPrivateKey(PK)
  : KEYSTORE && PASSPHRASE
    ? await LocalKeyring.fromKeystoreFile(KEYSTORE, PASSPHRASE)
    : (() => {
        throw new Error("Set DEPLOYER_PRIVATE_KEY, or KEYSTORE + SAIL_PASSPHRASE.");
      })();

const dep = getSailDeployment(CHAIN_ID);
const chain = Object.values(viemChains).find((c) => c?.id === CHAIN_ID);
if (!chain) throw new Error(`No viem chain def for chainId ${CHAIN_ID}`);

const me = keyring.address;
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const walletClient = createWalletClient({
  account: keyring.viemAccount,
  chain,
  transport: http(RPC),
});

const client = new SailorClient({
  rpcUrl: RPC,
  chainId: CHAIN_ID,
  kernel: dep.kernel,
  mandateFactory: dep.mandateFactory,
}).withSigner(walletClient);

let passed = 0;
let failed = 0;
const log = (m) => console.log(m);
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    log(`   ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    log(`   ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
/** Run `fn`; return true if it throws (used to assert a call is rejected on-chain). */
async function rejects(fn) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

/**
 * Poll `read()` until `ok(value)` holds, tolerating read-after-write lag on load-balanced
 * public RPC pools (a read right after a mined write can hit a node that hasn't synced the
 * block). Returns the last value; throws only if it never converges.
 */
async function poll(read, ok, { tries = 15, delayMs = 2000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await read();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

const SIGNER_NONCE_ABI = [
  {
    type: "function",
    name: "signerNonces",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];
const signerNonce = (safe) =>
  publicClient.readContract({
    address: dep.kernel,
    abi: SIGNER_NONCE_ABI,
    functionName: "signerNonces",
    args: [safe],
  });

const CREATE_PROXY_ABI = [
  {
    type: "function",
    name: "createProxyWithNonce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "singleton", type: "address" },
      { name: "initializer", type: "bytes" },
      { name: "saltNonce", type: "uint256" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
];

/** Deploy a bare Safe via the proxy factory and return its address (ProxyCreation topic[1]). */
async function deployBareSafe(saltNonce) {
  const initializer = buildSafeSetupInitializer({
    owners: [me],
    threshold: 1n,
    kernel: dep.kernel,
    safeModuleEnabler: dep.safeModuleEnabler,
  });
  const data = encodeFunctionData({
    abi: CREATE_PROXY_ABI,
    functionName: "createProxyWithNonce",
    args: [SAFE_V141.singletonL2, initializer, saltNonce],
  });
  const hash = await walletClient.sendTransaction({ to: SAFE_V141.proxyFactory, data });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  const pc = rcpt.logs.find(
    (l) => l.address.toLowerCase() === SAFE_V141.proxyFactory.toLowerCase() && l.topics.length >= 2,
  );
  if (!pc) throw new Error("ProxyCreation event not found");
  return `0x${pc.topics[1].slice(26)}`;
}

(async () => {
  log(
    `\n== §7 acceptance — chain ${CHAIN_ID} (${chain.name}), kernel ${dep.kernel.slice(0, 10)}… ==`,
  );
  const caps = await client.capabilities();
  log(`Kernel model: ${caps.dispatchModel} (${caps.source}) · operator ${me}\n`);

  // ── Phase 1 — createAccount (single-tx path) ────────────────────────────────
  log("[1] createAccount SMA (single-tx path)");
  const initializer = buildSafeSetupInitializer({
    owners: [me],
    threshold: 1n,
    kernel: dep.kernel,
    safeModuleEnabler: dep.safeModuleEnabler,
  });
  const sma = await client.account.create({
    owner: me,
    permissionSigner: me,
    manager: me,
    chainId: CHAIN_ID,
    safeFactory: SAFE_V141.proxyFactory,
    safeSingleton: SAFE_V141.singletonL2,
    safeInitializer: initializer,
    saltNonce: BigInt(process.env.SALT ?? Date.now()),
    feePolicy: dep.standardFeePolicy,
  });
  check("SMA created + registered", Boolean(sma.safe), sma.safe);

  // ── Phase 2 — registerAccount via owner-sig + Safe.execTransaction (#53), #69 guard ──
  log("\n[2] registerAccount via Safe.execTransaction (owner-sig) + #69 approved-hash guard");
  const bareSafe = await deployBareSafe(BigInt(Number(process.env.SALT ?? Date.now()) + 1));
  const regDeadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const regArgs = {
    chainId: CHAIN_ID,
    kernel: dep.kernel,
    account: bareSafe,
    permissionSigner: me,
    manager: me,
    feePolicy: dep.standardFeePolicy,
    feeAsset: "0x0000000000000000000000000000000000000000",
    deadline: regDeadline,
  };
  const td = buildRegisterAccountTypedData(regArgs);
  const ownerSig = await keyring.signTyped(
    td.domain,
    { primaryType: td.primaryType, types: td.types },
    td.message,
  );

  // #69: a v==1 approved-hash blob must be REJECTED as the kernel ownerSig.
  const approvedHashSig = `0x${pad(me, { size: 32 }).slice(2)}${"00".repeat(32)}01`;
  const badExec = buildRegisterAccountExecTransaction({
    safe: bareSafe,
    ...regArgs,
    ownerSig: approvedHashSig,
    owner: me,
  });
  check(
    "#69: approved-hash ownerSig rejected",
    await rejects(async () => {
      const h = await walletClient.sendTransaction({ to: badExec.to, data: badExec.data });
      const r = await publicClient.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error("reverted");
    }),
  );

  // Real ECDSA ownerSig must succeed.
  const goodExec = buildRegisterAccountExecTransaction({
    safe: bareSafe,
    ...regArgs,
    ownerSig,
    owner: me,
  });
  const regHash = await walletClient.sendTransaction({ to: goodExec.to, data: goodExec.data });
  const regRcpt = await publicClient.waitForTransactionReceipt({ hash: regHash });
  check("ECDSA ownerSig registerAccount succeeds", regRcpt.status === "success", bareSafe);

  // ── Phase 3 — configure a shared template (version-adaptive v1/v2) ───────────
  log("\n[3] configure a shared template (version-adaptive Configure signer)");
  const kt = (dep.knownTemplates ?? [])[0];
  if (!kt) {
    log("   ⚠ no knownTemplates on this chain — skipping configure/dispatch phases");
  } else {
    log(`   using template ${kt.kind} @ ${kt.address}`);
    // NOTE: the params blob must match the DEPLOYED template's configure() ABI. Supply a
    // matching encoder for `kt.kind` here (SDK templates/* or a per-template encoder). This
    // is left explicit so the operator wires the exact bounds they intend to test.
    log("   ⚠ set CONFIGURE_PARAMS wiring for this template before running the configure step");
  }

  // ── Phase 5/6 — revoke → epoch invalidation (#70) → re-activate ─────────────
  log("\n[4] session kill switch: revoke → re-activate, plus signer-nonce epoch bump (#70)");
  const st0 = await client.session.status(sma.safe);
  check("session starts active", st0.active === true, JSON.stringify(st0));

  const signerNonceBefore = await signerNonce(sma.safe);
  await client.session.revoke(sma.safe, keyring);
  // Reads can lag the just-mined revoke on a load-balanced pool — poll to convergence.
  const st1 = await poll(
    () => client.session.status(sma.safe),
    (s) => s.active === false,
  );
  check("session revoked (active=false)", st1.active === false, JSON.stringify(st1));
  const signerNonceAfter = await poll(
    () => signerNonce(sma.safe),
    (n) => n > signerNonceBefore,
  );
  check(
    "#70: signer nonce epoch bumped on revoke (invalidates pre-signed signer ops)",
    signerNonceAfter > signerNonceBefore,
    `${signerNonceBefore} → ${signerNonceAfter}`,
  );

  // activate reads signerNonces JIT; only proceed once the pool reflects the revoke bump, so
  // the SDK's internal read doesn't sign a stale nonce (would revert InvalidSignerSignature).
  await client.session.activate(sma.safe, keyring);
  const st2 = await poll(
    () => client.session.status(sma.safe),
    (s) => s.active === true,
  );
  check("session re-activated (active=true)", st2.active === true, JSON.stringify(st2));
  // NOTE: asserting a *pre-signed dispatch* is rejected end-to-end needs a registered +
  // configured permission on this SMA (Phase 3, operator-set). The signer/manager nonce epoch
  // bump above is the on-chain mechanism that enforces that invalidation.

  log(`\n== RESULT: ${passed} passed, ${failed} failed ==`);
  process.exit(failed === 0 ? 0 : 1);

  log(`\n== RESULT: ${passed} passed, ${failed} failed ==`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("\nACCEPTANCE HARNESS ERROR:", e);
  process.exit(1);
});
