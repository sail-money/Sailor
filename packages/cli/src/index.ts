#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("sailor")
  .description("Operator toolkit for Sail Protocol")
  .version("0.1.0");

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
stub("account create", "Create a new Sail SMA on-chain");
stub("mandate sign", "Sign and attach a mandate to a Safe");
stub("dispatch preview", "Preview a dispatch without submitting");
stub("run", "Start the agent runner (cron or one-shot)");
stub("ui", "Open the local dashboard at localhost:3333");
stub("status", "Show current account and session status");
stub("session pause", "Pause the manager session (revoke dispatch rights)");
stub("session resume", "Resume a paused session");

program.parse(process.argv);
