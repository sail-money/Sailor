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
  const mandate = readJsonFile<StoredMandate>(sailPath("mandate.json"));
  const session = readJsonFile<StoredSession>(sailPath("session.json"));

  console.log("Sailor status");
  console.log("────────────────────────────────────────");

  console.log("Keys:");
  console.log(`  manager           ${hasManager ? "✓" : '✗  run "sailor keys generate"'}`);
  console.log(
    `  permissionSigner  ${hasPermissionSigner ? "✓" : '✗  run "sailor keys generate"'}`,
  );

  console.log("Account:");
  if (account) {
    console.log(`  ✓ deployed   ${checksum(account.safe)}  (chain ${account.chainId})`);
  } else {
    console.log('  ✗ not deployed   run "sailor account create"');
  }

  console.log("Mandate:");
  if (mandate) {
    const n = mandate.permissions.length;
    console.log(`  ✓ signed   ${n} permission${n === 1 ? "" : "s"}`);
  } else {
    console.log('  ✗ not signed   run "sailor mandate sign"');
  }

  console.log("Agent:");
  const pid = readAgentPid();
  const running = pid !== null && isProcessAlive(pid);
  let agentState: string;
  if (running) {
    agentState = `running (PID ${pid})`;
  } else if (!mandate) {
    agentState = "not configured";
  } else if (session && session.active === false) {
    agentState = "stopped (session paused)";
  } else {
    agentState = "stopped";
  }
  console.log(`  ${agentState}`);
}
