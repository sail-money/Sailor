#!/usr/bin/env node
import { Command } from "commander";
import { accountCreate } from "./commands/account.js";
import { doctor } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { keysGenerate, keysShow } from "./commands/keys.js";
import {
  type AttachOptions,
  type DeployOptions,
  type RevokeOptions,
  mandateAttach,
  mandateContractsList,
  mandateDeploy,
  mandateRevoke,
  mandateTemplates,
} from "./commands/mandate-contracts.js";
import { mandatePrepare, mandateSign } from "./commands/mandate.js";
import { type OnboardOptions, onboard } from "./commands/onboard.js";
import { ownerConnect, ownerShow } from "./commands/owner.js";
import { runCommand } from "./commands/run.js";
import { scan } from "./commands/scan.js";
import { sessionPause, sessionResume } from "./commands/session.js";
import { stationStart, stationStatus, stationStop } from "./commands/station.js";
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

/** Like {@link action} but for command handlers that take parsed options. */
function actionWith<T>(fn: (opts: T) => Promise<void> | void): (opts: T) => Promise<void> {
  return async (opts: T) => {
    try {
      await fn(opts);
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
  .option("--chain <id>", "Default EVM chain id written to .sail/config.json and .env.example")
  .option("--rpc-url <url>", "Default RPC_URL written to .sail/.env.local")
  .action(async (name: string | undefined, opts: { chain?: string; rpcUrl?: string }) => {
    try {
      await initCommand(name, opts);
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
keys.command("show").description("Show the address of each stored key").action(action(keysShow));

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
mandate
  .command("deploy")
  .description("Deploy a Foundry-compiled mandate contract via the browser signing UI")
  .option("--artifact <path>", "Path to the Foundry artifact JSON (out/<Name>.sol/<Name>.json)")
  .option("--contract <name>", "Contract name; resolves to <out>/<name>.sol/<name>.json")
  .option("--out <dir>", "Foundry output directory", "out")
  .option("--name <label>", "Label to track this mandate under (defaults to contract name)")
  .option("--args <json>", 'Constructor args as a JSON array, e.g. \'[["0x.."],"1000"]\'')
  .option("--build", "Run `forge build` before deploying")
  .option("--attach", "After deploy, attach the mandate to --sma")
  .option("--sma <address>", "Safe to attach to (required with --attach)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<DeployOptions>(mandateDeploy));
mandate
  .command("attach")
  .description("Attach an already-deployed mandate to a Safe (EIP-712 RegisterPermission)")
  .requiredOption("--address <mandateOrName>", "Mandate address, or a name tracked locally")
  .requiredOption("--sma <address>", "Safe (SMA) to attach the mandate to")
  .option("--label <label>", "Human-readable label shown in the signing UI")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<AttachOptions>(mandateAttach));
mandate
  .command("revoke")
  .description("Revoke permission(s) from a Safe (EIP-712 RevokePermissions, owner-authorized)")
  .option("--address <permissionOrName>", "Permission address, or a name tracked locally")
  .requiredOption("--sma <address>", "Safe (SMA) to revoke the permission(s) from")
  .option("--all", "Revoke every permission currently registered on the SMA")
  .option("--json", "Output JSON")
  .action(actionWith<RevokeOptions>(mandateRevoke));
mandate
  .command("templates")
  .description("List pre-deployed mandate templates available on this chain")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(mandateTemplates));
mandate
  .command("list")
  .description("List mandates deployed from this project")
  .action(action(async () => mandateContractsList()));

program
  .command("onboard")
  .description("Set up an SMA, attach a mandate, confirm the agent is operational")
  .option("--sma <address>", "Use a specific Safe address instead of prompting")
  .option("--new-sma", "Create a new Safe via SailKernel")
  .option("--template <kindOrAddress>", "Attach this mandate template (kind, label, or address)")
  .option("--skip-mandate", "Skip the mandate attachment step")
  .option("--json", "Emit machine-readable JSON (implies non-interactive)")
  .action(actionWith<OnboardOptions>(onboard));

const station = program
  .command("station")
  .description("Manage the persistent signing station (browser signing daemon)");
station
  .command("start")
  .description("Start the signing station and keep it running (blocks — run in the background)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(stationStart));
station
  .command("status")
  .description("Show whether a signing station is running for this project")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(stationStatus));
station
  .command("stop")
  .description("Stop the running signing station")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(stationStop));

const owner = program
  .command("owner")
  .description("Detect & persist the project owner (your connected wallet)");
owner
  .command("connect")
  .description("Open the signing station, wait for your wallet, and save it as owner")
  .option("--json", "Emit machine-readable JSON")
  .option("--timeout <seconds>", "How long to wait for a wallet connection", "300")
  .action(actionWith<{ json?: boolean; timeout?: string }>(ownerConnect));
owner
  .command("show")
  .description("Show the saved project owner")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(ownerShow));

program
  .command("scan")
  .description("Discover the owner's Safes, their mandates, and local keys; save to context.json")
  .option("--owner <address>", "Owner address to scan (defaults to the saved project owner)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ owner?: string; json?: boolean }>(scan));

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
session.command("resume").description("Resume a paused session").action(action(sessionResume));

program
  .command("doctor")
  .description("Preflight (read-only): kernel dispatch model + permission health, before spending gas")
  .option("--json", "Output machine-readable JSON")
  .option("--account <address>", "SMA to check (defaults to .sail/account.json)")
  .action(actionWith(doctor));

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

stub("setup", "Walk through the Sailor setup guide");
stub("dispatch preview", "Preview a dispatch without submitting");

program.parse(process.argv);
