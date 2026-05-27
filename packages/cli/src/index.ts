#!/usr/bin/env node
import { Command } from "commander";
import { accountCreate } from "./commands/account.js";
import { initCommand } from "./commands/init.js";
import { keysGenerate, keysShow } from "./commands/keys.js";
import { mandatePrepare, mandateSign } from "./commands/mandate.js";
import { runCommand } from "./commands/run.js";
import { sessionPause, sessionResume } from "./commands/session.js";
import { status } from "./commands/status.js";
import { uiCommand } from "./commands/ui.js";
import { closePrompts } from "./lib/io.js";

const program = new Command();

program.name("sailor").description("Operator toolkit for Sail Protocol").version("0.1.0");

/** Wraps a command action with consistent error handling and prompt cleanup. */
function action(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      closePrompts();
      process.exit(1);
    }
    closePrompts();
  };
}

// ── Implemented ───────────────────────────────────────────────────────────────

program
  .command("init [name]")
  .description("Scaffold a new Sail agent from the DCA-rebalancer template")
  .action(async (name?: string) => {
    try {
      await initCommand(name);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("ui")
  .description("Open the local dashboard at localhost:3333")
  .action(action(uiCommand));

const keys = program.command("keys").description("Manage local signing keys");
keys
  .command("generate")
  .description("Generate and encrypt a manager or permissionSigner key")
  .action(action(keysGenerate));
keys
  .command("show")
  .description("Show the address of each stored key")
  .action(action(keysShow));

const account = program.command("account").description("Manage the Sail SMA");
account
  .command("create")
  .description("Create a new Sail SMA on-chain")
  .action(action(accountCreate));

const mandate = program.command("mandate").description("Manage mandates");
mandate
  .command("prepare")
  .description("Prepare a mandate draft for review and signing in the UI (MetaMask)")
  .action(action(mandatePrepare));
mandate
  .command("sign")
  .description("Review and sign the agent's mandate with a local key (advanced)")
  .action(action(mandateSign));

program
  .command("status")
  .description("Show current account, mandate, and session status")
  .action(action(status));

program
  .command("run")
  .description("Run the agent execution loop (use --once for a single tick)")
  .option("--once", "Run a single tick then exit")
  .action(async (opts: { once?: boolean }) => {
    try {
      await runCommand({ once: opts.once });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      closePrompts();
      process.exit(1);
    }
    closePrompts();
  });

const session = program.command("session").description("Control the manager session");
session
  .command("pause")
  .description("Pause the manager session (revoke dispatch rights)")
  .action(action(sessionPause));
session
  .command("resume")
  .description("Resume a paused session")
  .action(action(sessionResume));

// ── Stubs ─────────────────────────────────────────────────────────────────────

function stub(name: string, description: string): void {
  program
    .command(name)
    .description(description)
    .allowUnknownOption()
    .action(() => {
      console.log(`sailor ${name}: not implemented yet`);
    });
}

stub("wizard", "Walk through the interactive setup wizard");
stub("dispatch preview", "Preview a dispatch without submitting");

program.parse(process.argv);
