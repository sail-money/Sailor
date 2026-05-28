/**
 * sailor owner — detect and persist the project owner (the user's wallet).
 *
 *   sailor owner connect   # open the signing station, wait for the wallet to
 *                          # connect, then save it as the owner
 *   sailor owner show      # print the saved owner
 *
 * The owner is the address that connects in the browser signing UI: the wallet
 * that owns the Safes (SMAs) and signs high-stakes operations. Persisting it
 * lets later commands (scan, onboard) know whose Safes to look up.
 */

import type { Address } from "viem";
import { emit } from "../lib/output.js";
import { ProjectContext } from "../lib/project.js";
import { createSigningChannel } from "../signing/client.js";

export async function ownerConnect(options: { json?: boolean; timeout?: string }): Promise<void> {
  const projectRoot = process.cwd();
  if (!ProjectContext.exists()) {
    emit(options.json, () => console.log('No Sailor project found. Run "sailor init" first.'), {
      status: "error",
      error: "no-project",
    });
    process.exit(1);
  }
  const project = new ProjectContext();

  const channel = await createSigningChannel(projectRoot);
  try {
    await channel.start();

    if (!options.json) {
      console.log("→ Open this in your browser and connect your wallet:");
      console.log(`  ${channel.url}`);
      if (channel.remote) console.log("  (using the running signing station)");
      console.log("\nWaiting for a wallet connection…");
    }

    const timeoutMs = Number(options.timeout ?? "300") * 1000;
    const address = (await channel.waitForWallet(timeoutMs)) as Address;
    project.setOwner(address);

    emit(
      options.json,
      () => {
        console.log("✓ Owner connected & saved:", address);
        console.log("  Saved to .sail/state/owner.json");
      },
      { status: "connected", owner: address, url: channel.url },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(options.json, () => console.error(`Owner connect failed: ${msg}`), {
      status: "error",
      error: msg,
    });
    process.exit(1);
  } finally {
    channel.stop();
  }
}

export function ownerShow(options: { json?: boolean }): void {
  if (!ProjectContext.exists()) {
    emit(options.json, () => console.log('No Sailor project found. Run "sailor init" first.'), {
      status: "error",
      error: "no-project",
    });
    process.exit(1);
  }
  const owner = new ProjectContext().getOwner();
  if (!owner) {
    emit(options.json, () => console.log('No owner saved yet. Run "sailor owner connect".'), {
      owner: null,
    });
    return;
  }
  emit(options.json, () => console.log("Owner:", owner), { owner });
}
