#!/usr/bin/env node
import { Command } from "commander";
import {
  type DeployChainOptions,
  type PredictOptions,
  accountCreate,
  accountDeployChain,
  accountPredict,
} from "./commands/account.js";
import { capabilities } from "./commands/capabilities.js";
import { doctor } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { keysExportCi, keysGenerate, keysShow } from "./commands/keys.js";
import {
  type AttachOptions,
  type DeployCloneOptions,
  type DeployOptions,
  type RevokeOptions,
  mandateAttach,
  mandateContractsList,
  mandateDeploy,
  mandateDeployClone,
  mandateRevoke,
  mandateTemplates,
} from "./commands/mandate-contracts.js";
import { mandatePrepare, mandateSign } from "./commands/mandate.js";
import { type SimulateOptions, mandateSimulate } from "./commands/mandate-simulate.js";
import { type OnboardOptions, onboard } from "./commands/onboard.js";
import { type RotateSignerOptions, rotateSigner } from "./commands/rotate-signer.js";
import { ownerConnect, ownerShow } from "./commands/owner.js";
import { runCommand } from "./commands/run.js";
import { scan } from "./commands/scan.js";
import { sessionPause, sessionResume } from "./commands/session.js";
import { stationStart, stationStatus, stationStop } from "./commands/station.js";
import { status } from "./commands/status.js";
import { uiCommand, uiStatus, uiStop } from "./commands/ui.js";
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
  .command("init [dir]")
  .description("Scaffold a new Sail agent into the current directory (or [dir] subdirectory)")
  .option("--template <name>", "Template to scaffold from (default: default)")
  .option("--chain <id>", "Default EVM chain id written to .sail/config.json and .env.example")
  .option("--rpc-url <url>", "Default RPC_URL written to .sail/.env.local")
  .action(
    async (
      name: string | undefined,
      opts: { template?: string; chain?: string; rpcUrl?: string },
    ) => {
      try {
        await initCommand(name, opts);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    },
  );

const ui = program.command("ui").description("Manage the local Sailor dashboard");
ui.command("start")
  .description("Start the dashboard at localhost:3333 (default)")
  .action(action(uiCommand));
ui.command("stop")
  .description("Stop the running dashboard")
  .action(() => uiStop());
ui.command("status")
  .description("Show whether the dashboard is running")
  .action(() => uiStatus());
ui.action(action(uiCommand));

const keys = program.command("keys").description("Manage local signing keys");
keys
  .command("generate")
  .description("Generate and encrypt an agent wallet or mandate signer key")
  .action(action(keysGenerate));
keys.command("show").description("Show the address of each stored key").action(action(keysShow));
keys
  .command("export-ci")
  .description(
    "Copy the encrypted agent wallet keystore to ci-keystore.json for committing to CI",
  )
  .action(action(keysExportCi));

const account = program.command("account").description("Manage the Sail SMA");
account
  .command("create")
  .description("Create a new Sail SMA on-chain")
  .action(action(accountCreate));
account
  .command("predict")
  .description(
    "Compute the deterministic Safe address for a given owner + manager + salt (no gas, no deployment)",
  )
  .option("--owner <address>", "Owner EOA address (defaults to .sail/account.json)")
  .option(
    "--manager <address>",
    "Agent (manager) wallet — mixed into the kernel salt (defaults to .sail/account.json)",
  )
  .option("--salt <n>", "CREATE2 salt nonce (default: 0)")
  .option("--chain <id>", "Show prediction for one chain only")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<PredictOptions>(accountPredict));
account
  .command("deploy-chain")
  .description("Deploy the same SMA address on an additional chain using the same owner, manager, and salt")
  .requiredOption("--chain <id>", "Target EVM chain ID (e.g. 8453, 42161, 130, 1)")
  .option("--salt <n>", "CREATE2 salt (defaults to saltNonce stored in .sail/account.json)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<DeployChainOptions>(accountDeployChain));
account
  .command("rotate-signer")
  .description("Rotate the SMA's delegated signer (agent wallet) and re-approve its mandates")
  .option("--sma <address>", "SMA to rotate (defaults to the active account)")
  .option("--to <address>", "Rotate to an existing agent-wallet address instead of generating one")
  .option("--generate", "Generate a fresh local agent wallet (default when --to is omitted)")
  .option("--skip-reattach", "Do not re-approve the previously-attached mandates")
  .option("--reattach-only", "Skip rotation; only re-approve mandates (resume after funding)")
  .option("--json", "Machine-readable output")
  .action(actionWith<RotateSignerOptions>(rotateSigner));

const mandate = program.command("mandate").description("Manage mandates");
mandate
  .command("prepare")
  .description("Prepare a mandate draft for review and signing in the UI (MetaMask)")
  .action(action(mandatePrepare));
mandate
  .command("sign")
  .description("Review and confirm the permissions authorized for your SMA")
  .option("--yes", "Skip the confirmation prompt (for non-interactive / CI use)")
  .action(actionWith<{ yes?: boolean }>(mandateSign));
mandate
  .command("deploy")
  .description("Deploy a Foundry-compiled permission contract via the browser signing UI")
  .option("--artifact <path>", "Path to the Foundry artifact JSON (out/<Name>.sol/<Name>.json)")
  .option("--contract <name>", "Contract name; resolves to <out>/<name>.sol/<name>.json")
  .option("--out <dir>", "Foundry output directory", "out")
  .option("--name <label>", "Label to track this permission under (defaults to contract name)")
  .option("--args <json>", 'Constructor args as a JSON array, e.g. \'[["0x.."],"1000"]\'')
  .option("--build", "Run `forge build` before deploying")
  .option("--attach", "After deploy, register the permission on --sma")
  .option("--sma <address>", "SMA to register on (required with --attach)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<DeployOptions>(mandateDeploy));
mandate
  .command("attach")
  .description("Register an already-deployed permission on an SMA (EIP-712 RegisterPermission)")
  .requiredOption("--address <mandateOrName>", "Permission address, or a name tracked locally")
  .requiredOption("--sma <address>", "SMA to register the permission on")
  .option("--label <label>", "Human-readable label shown in the signing UI")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<AttachOptions>(mandateAttach));
mandate
  .command("deploy-clone")
  .description("Deploy + register a standalone clone permission (e.g. boundedApprove) via the signing UI")
  .requiredOption("--template <key>", "Standalone clone template key (e.g. boundedApprove)")
  .requiredOption("--sma <address>", "SMA to deploy the clone for and register it on")
  .option("--tokens <csv>", "Comma-separated allowed token addresses")
  .option("--spenders <csv>", "Comma-separated allowed spender addresses")
  .option("--max <amount>", "Max amount per tx in base units (default: uint256 max)")
  .option("--label <label>", "Human-readable label to track this permission under")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<DeployCloneOptions>(mandateDeployClone));
mandate
  .command("revoke")
  .description("Revoke permission(s) from an SMA (EIP-712 RevokePermissions, owner-authorized)")
  .option("--address <permissionOrName>", "Permission address, or a name tracked locally")
  .requiredOption("--sma <address>", "Safe (SMA) to revoke the permission(s) from")
  .option("--all", "Revoke every permission currently registered on the SMA")
  .option("--json", "Output JSON")
  .action(actionWith<RevokeOptions>(mandateRevoke));
mandate
  .command("templates")
  .description("Show how to author your own permission contract (and any community-deployed addresses)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(mandateTemplates));
mandate
  .command("simulate")
  .description(
    "Probe a permission against sample calls off-chain (eth_call, NO gas) — prove it " +
      "accepts the calls you want and rejects the ones you don't, before authorizing on-chain",
  )
  .requiredOption("--address <permissionOrName>", "Permission to probe (address or tracked name)")
  .option("--sma <address>", "SMA to probe as (ctx.account; defaults to .sail/account.json)")
  .option("--target <address>", "Inline single call: target contract address")
  .option("--calldata <hex>", "Inline single call: 0x-prefixed calldata")
  .option("--value <wei>", "Inline single call: ETH value in wei (default 0)")
  .option("--expect <pass|fail>", "Inline single call: expected outcome (sets non-zero exit on mismatch)")
  .option("--label <text>", "Inline single call: human-readable label")
  .option("--calls <file>", "Batch: JSON array of { target, calldata, value?, expect?, label? }")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<SimulateOptions>(mandateSimulate));
mandate
  .command("list")
  .description("List permission contracts deployed from this project")
  .action(action(async () => mandateContractsList()));

program
  .command("onboard")
  .description("Set up an SMA, register a permission, confirm the agent is operational")
  .option("--sma <address>", "Use a specific SMA address instead of prompting")
  .option("--new-sma", "Create a new SMA via SailKernel")
  .option("--salt <n>", "CREATE2 salt for deterministic Safe address (default: 0; use 0 for first SMA, increment for subsequent)")
  .option("--template <kindOrAddress>", "Register this permission contract (kind, label, or address)")
  .option("--skip-mandate", "Skip the permission registration step")
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
  .description("Discover the owner's SMAs, their permissions, and local keys; save to context.json")
  .option("--owner <address>", "Owner address to scan (defaults to the saved project owner)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ owner?: string; json?: boolean }>(scan));

program
  .command("status")
  .description("Show current account, permission, and session status")
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

const session = program.command("session").description("Control the agent session");
session
  .command("pause")
  .description("Pause the agent session (revoke dispatch rights)")
  .action(action(sessionPause));
session.command("resume").description("Resume a paused session").action(action(sessionResume));

program
  .command("doctor")
  .description(
    "Preflight (read-only): kernel model, permission health, RPC + gas balances, before spending gas",
  )
  .option("--json", "Output machine-readable JSON")
  .option("--account <address>", "SMA to check (defaults to .sail/account.json)")
  .action(actionWith(doctor));

program
  .command("capabilities")
  .description(
    "Feasibility map (read-only): chains, kernel model, mandate templates, strategy primitives",
  )
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(capabilities));

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

stub("dispatch preview", "Preview a dispatch without submitting");

program.parse(process.argv);
