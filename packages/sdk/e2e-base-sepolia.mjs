/**
 * Headless E2E on Base Sepolia against the NEW bootstrapped contracts:
 *   1. create a Sail SMA
 *   2. deploy two BoundedCallPermission mandates
 *   3. attach (register) both
 *   4. prove enforcement: allowed dispatch succeeds; denied dispatches revert
 *
 * Single local key (deployer EOA) collapses owner = permissionSigner = manager —
 * fine for a testnet smoke test. Run from packages/sdk so viem + ./dist resolve.
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { SailorClient, LocalKeyring, buildSafeSetupInitializer, SAFE_V141 } from "./dist/index.js";

const RPC = process.env.BASE_SEPOLIA_RPC_URL;
const PK = process.env.DEPLOYER_PRIVATE_KEY;
if (!RPC || !PK) throw new Error("Set BASE_SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY");

const CHAIN_ID = 84532;
const KERNEL = "0x41dE9Cb1cbb8b74BDcEE9F5B6b3E72F9ae8281Dc";
const FACTORY = "0xEA2854BC6B26f3FC40E228cE3acc304A244AFcD1";
const ENABLER = "0x637f75534167f7aE3fBc7b07baAcF965DFD94e7f";
const FEE_POLICY = "0x0b484611126D50ee9e0e7935E65Ed1E85c5f8C5C";

const ALLOWED = "0x000000000000000000000000000000000000bEEF"; // allowed target (no code → call succeeds)
const DENIED = "0x000000000000000000000000000000000000dEaD"; // not allowed
const TRANSFER_SEL = "0xa9059cbb"; // ERC20 transfer(address,uint256)

const ARTIFACT =
  "/Users/andressarria/Desktop/SailAgent/SailAccountContainer/SailingChart/base-sepolia-agent/out/BoundedCallPermission.sol/BoundedCallPermission.json";

const account = privateKeyToAccount(PK);
const me = account.address;
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
const keyring = LocalKeyring.fromPrivateKey(PK); // signs RegisterPermissions + Dispatch

const client = new SailorClient({
  rpcUrl: RPC,
  chainId: CHAIN_ID,
  kernel: KERNEL,
  mandateFactory: FACTORY,
}).withSigner(walletClient);

const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
const abi = artifact.abi;
const bytecode = artifact.bytecode.object;

async function deployPerm(targets, selectors, maxValue, label) {
  const hash = await walletClient.deployContract({ abi, bytecode, args: [targets, selectors, maxValue] });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  deployed ${label}: ${rcpt.contractAddress}  (tx ${hash.slice(0, 10)}…)`);
  return rcpt.contractAddress;
}

const log = (m) => console.log(m);

(async () => {
  log(`\n== Sail E2E on Base Sepolia (kernel ${KERNEL.slice(0, 10)}…) ==`);
  const caps = await client.capabilities();
  log(`Kernel model: ${caps.dispatchModel} (${caps.source})`);
  log(`Operator EOA (owner=signer=manager): ${me}`);

  // 1. Create SMA
  log("\n[1] Creating SMA…");
  const safeInitializer = buildSafeSetupInitializer({
    owners: [me],
    threshold: 1n,
    kernel: KERNEL,
    safeModuleEnabler: ENABLER,
  });
  const sma = await client.account.create({
    owner: me,
    permissionSigner: me,
    manager: me,
    chainId: CHAIN_ID,
    safeFactory: SAFE_V141.proxyFactory,
    safeSingleton: SAFE_V141.singletonL2,
    safeInitializer,
    saltNonce: BigInt(Date.now()),
    feePolicy: FEE_POLICY,
  });
  log(`  ✓ SMA: ${sma.safe} (block ${sma.createdAtBlock})`);

  // 2. Deploy two mandates
  log("\n[2] Deploying mandates…");
  const perm1 = await deployPerm([ALLOWED], [], 0n, "perm1 (target-only: allows 0x…bEEF)");
  const perm2 = await deployPerm([ALLOWED], [TRANSFER_SEL], 0n, "perm2 (target+selector: 0x…bEEF + transfer)");

  // 3. Attach both (permissionSigner signs RegisterPermissions; manager submits)
  log("\n[3] Attaching (registering) both mandates…");
  await client.mandate.attachBatch(sma.safe, [{ template: { address: perm1 } }, { template: { address: perm2 } }], keyring);
  const registered = await client.mandate.list(sma.safe);
  log(`  ✓ registered permissions: ${registered.map((r) => r.permission).join(", ")}`);
  log(`  isRegistered(perm1)=${await client.mandate.isRegistered(sma.safe, perm1)}  isRegistered(perm2)=${await client.mandate.isRegistered(sma.safe, perm2)}`);

  // 4. Enforcement proofs
  log("\n[4] Dispatching to prove enforcement…");

  log("  (a) ALLOWED: perm1 → call 0x…bEEF (value 0, empty data) — expect SUCCESS");
  const ok = await client.dispatch.single(sma.safe, perm1, { target: ALLOWED, value: 0n, data: "0x" }, keyring);
  log(`      → success=${ok.success}  tx=${ok.txHash}`);

  log("  (b) DENIED: perm1 → call 0x…dEaD (target NOT allowed) — expect REVERT");
  try {
    await client.dispatch.single(sma.safe, perm1, { target: DENIED, value: 0n, data: "0x" }, keyring, { nonce: 1n });
    log("      → ✗ UNEXPECTED SUCCESS — enforcement FAILED");
  } catch (e) {
    log(`      → ✓ correctly rejected: ${String(e.message).split("\n")[0]}`);
  }

  log("  (c) DENIED: perm2 → call 0x…bEEF with wrong selector (empty data) — expect REVERT");
  try {
    await client.dispatch.single(sma.safe, perm2, { target: ALLOWED, value: 0n, data: "0x" }, keyring, { nonce: 1n });
    log("      → ✗ UNEXPECTED SUCCESS — selector enforcement FAILED");
  } catch (e) {
    log(`      → ✓ correctly rejected: ${String(e.message).split("\n")[0]}`);
  }

  log("\n== DONE ==");
  log(`SMA ${sma.safe} | perm1 ${perm1} | perm2 ${perm2}`);
})().catch((e) => {
  console.error("\nE2E FAILED:", e);
  process.exit(1);
});
