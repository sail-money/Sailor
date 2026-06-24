import { checksum, readJsonFile, sailPath } from "../lib/io.js";
import { keyExists } from "../lib/keys.js";
import { isProcessAlive, readAgentPid } from "../lib/process.js";
import type { StoredAccount, StoredMandate, StoredSession } from "../lib/state.js";

/**
 * `sailor status` — one-screen summary of local setup progress:
 * keys, account deployment, signed mandate, and agent run state.
 */
export async function status(): Promise<void> {
  const hasManager = keyExists("manager");
  const hasPermissionSigner = keyExists("permissionSigner");
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  // mandate.json may hold a single mandate or an array (multi-mandate accounts,
  // matching how `sailor run` reads it). Normalise to an array and tolerate
  // partial records that predate the current shape — see the guarded render below.
  const mandateRaw = readJsonFile<StoredMandate | StoredMandate[]>(sailPath("mandate.json"));
  const mandates = (Array.isArray(mandateRaw) ? mandateRaw : mandateRaw ? [mandateRaw] : []).filter(
    Boolean,
  );
  const hasMandate = mandates.length > 0;
  const session = readJsonFile<StoredSession>(sailPath("session.json"));

  console.log("Sailor status");
  console.log("────────────────────────────────────────");

  console.log("Keys:");
  console.log(`  agent wallet      ${hasManager ? "✓" : '✗  run "sailor keys generate"'}`);
  console.log(
    `  mandate signer    ${hasPermissionSigner ? "✓" : '✗  run "sailor keys generate"'}`,
  );

  console.log("Account:");
  if (account) {
    console.log(`  ✓ deployed   ${checksum(account.safe)}  (chain ${account.chainId})`);
  } else {
    console.log('  ✗ not deployed   run "sailor onboard --new-sma"');
  }

  console.log("Mandate:");
  if (hasMandate) {
    // Guard against partial/legacy mandate records missing `permissions`.
    const n = mandates.reduce((sum, m) => sum + (m?.permissions?.length ?? 0), 0);
    const permLabel = `${n} permission${n === 1 ? "" : "s"}`;
    console.log(
      mandates.length > 1
        ? `  ✓ signed   ${mandates.length} mandates, ${permLabel}`
        : `  ✓ signed   ${permLabel}`,
    );
  } else {
    console.log('  ✗ not signed   run "sailor mandate sign"');
  }

  console.log("Agent:");
  const pid = readAgentPid();
  const running = pid !== null && isProcessAlive(pid);
  let agentState: string;
  if (running) {
    agentState = `running (PID ${pid})`;
  } else if (!hasMandate) {
    agentState = "not configured";
  } else if (session && session.active === false) {
    agentState = "stopped (session paused)";
  } else {
    agentState = "stopped";
  }
  console.log(`  ${agentState}`);
}
