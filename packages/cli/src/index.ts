#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Option } from "commander";
import {
  type DeployChainOptions,
  type PredictOptions,
  accountDeployChain,
  accountPredict,
} from "./commands/account.js";
import { capabilities } from "./commands/capabilities.js";
import { type ChainsOptions, chainsCommand } from "./commands/chains.js";
import { doctor } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { type KeysGenerateOptions, keysExportCi, keysGenerate, keysShow } from "./commands/keys.js";
import { type ConfigureOptions, mandateConfigure } from "./commands/mandate-configure.js";
import {
  type DeployCloneOptions,
  type DeployOptions,
  type RegisterOptions,
  type RevokeOptions,
  type UpdateOptions,
  mandateContractsList,
  mandateDeploy,
  mandateDeployClone,
  mandateRegister,
  mandateRevoke,
  mandateTemplates,
  mandateUpdate,
} from "./commands/mandate-contracts.js";
import { type SimulateOptions, mandateSimulate } from "./commands/mandate-simulate.js";
import { mandatePrepare, mandateSign, mandateSync } from "./commands/mandate.js";
import { type OnboardOptions, onboard } from "./commands/onboard.js";
import { ownerConnect, ownerShow } from "./commands/owner.js";
import { type RotateSignerOptions, rotateSigner } from "./commands/rotate-signer.js";
import { runCommand } from "./commands/run.js";
import { scan } from "./commands/scan.js";
import {
  type ServiceInstallOptions,
  type ServiceLogsOptions,
  type ServiceOptions,
  serviceInstall,
  serviceLogs,
  serviceStatus,
  serviceStop,
  serviceUninstall,
} from "./commands/service.js";
import { sessionPause, sessionResume } from "./commands/session.js";
import { signerStart, signerStatus, signerStop } from "./commands/signer.js";
import { status } from "./commands/status.js";
import { type TriggerGithubOptions, triggerGithub } from "./commands/trigger.js";
import { type UiOptions, uiCommand, uiStatus, uiStop } from "./commands/ui.js";
import { updateCommand } from "./commands/update.js";
import { closePrompts } from "./lib/io.js";
import { packageRoot } from "./lib/packagePaths.js";

/**
 * The version users installed — read from the package's own manifest at runtime
 * (the same root the scaffolder resolves), so `sailor --version` can never
 * drift from the published package.json again.
 */
function cliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf-8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program.name("sailor").description("The Sailor CLI — the harness for building and operating DeFi agents on Sail Protocol").version(cliVersion());

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
  .option(
    "--force",
    "Re-initialize even if already initialized (overwrites scaffold files; keys/ and state/ are preserved)",
  )
  .action(
    async (
      name: string | undefined,
      opts: { template?: string; chain?: string; rpcUrl?: string; force?: boolean },
    ) => {
      try {
        await initCommand(name, opts);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    },
  );

program
  .command("update")
  .description(
    "Re-sync agent tooling files (skills, AGENTS.md, Dockerfile) from the latest template",
  )
  .action(action(updateCommand));

const ui = program.command("ui").description("Manage the local Sailor dashboard");
ui.command("start")
  .description("Start the dashboard at localhost:3333 (default)")
  .option("--expose <mode>", "Expose the dashboard over HTTPS on your tailnet (mode: tailscale)")
  .action(actionWith<UiOptions>(uiCommand));
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
  .option("--type <role>", "Key role: agent-wallet (manager) or mandate-signer (non-interactive)")
  .option(
    "--passphrase <value>",
    "Encryption passphrase (else SAIL_PASSPHRASE, else stdin, else prompt)",
  )
  .option("--force", "Overwrite an existing key without prompting")
  .action(actionWith<KeysGenerateOptions>(keysGenerate));
keys.command("show").description("Show the address of each stored key").action(action(keysShow));
keys
  .command("export-ci")
  .description("Copy the encrypted agent wallet keystore to ci-keystore.json for committing to CI")
  .action(action(keysExportCi));

const account = program.command("account").description("Manage the Sail SMA");
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
  .description(
    "Deploy the same SMA address on an additional chain using the same owner, manager, and salt",
  )
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
  .option("--list", "List known agent wallets for this SMA without rotating")
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
  .command("sync")
  .description(
    "Reconcile the local mandate cache with on-chain permissions (kernel is source of truth)",
  )
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(mandateSync));
mandate
  .command("deploy")
  .description("Deploy a Foundry-compiled permission contract via the browser signing UI")
  .option("--artifact <path>", "Path to the Foundry artifact JSON (contracts/out/<Name>.sol/<Name>.json)")
  .option("--contract <name>", "Contract name; resolves to <out>/<name>.sol/<name>.json")
  .option("--out <dir>", "Foundry output directory — the contracts/ workspace's out/", "contracts/out")
  .option("--name <label>", "Label to track this permission under (defaults to contract name)")
  .option(
    "--args <json>",
    'Constructor args as JSON array. Bash: \'["0x..","1"]\'. PowerShell: \'[\\"0x..\\",\\"1\\"]\'. Use --args-file to avoid quoting.',
  )
  .option(
    "--args-file <path>",
    "Path to a JSON file containing constructor args array (recommended on PowerShell)",
  )
  .option("--build", "Run `forge build` before deploying")
  .addOption(new Option("--register", "After deploy, register the permission on --sma"))
  .addOption(new Option("--attach").hideHelp()) // hidden back-compat alias for --register
  .option("--sma <address>", "SMA to register on (required with --register)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<DeployOptions>(mandateDeploy));
{
  // `register` is canonical; `attach` is a hidden alias kept for backward
  // compatibility with existing scripts — same options, same handler, not
  // listed in --help.
  const registerOptions = [
    [
      "--address <mandateOrName>",
      "Permission address or locally-tracked name; or a comma-separated list of addresses to register together in one signature",
    ],
    ["--sma <address>", "SMA to register the permission on"],
  ] as const;
  mandate
    .command("register")
    .description("Register one or more already-deployed permissions on an SMA (EIP-712 RegisterPermission; a comma-separated list registers all in one signature)")
    .requiredOption(...registerOptions[0])
    .requiredOption(...registerOptions[1])
    .option("--label <label>", "Human-readable label shown in the signing UI")
    .option("--json", "Emit machine-readable JSON")
    .action(actionWith<RegisterOptions>(mandateRegister));
  mandate
    .command("attach", { hidden: true })
    .requiredOption(...registerOptions[0])
    .requiredOption(...registerOptions[1])
    .option("--label <label>", "Human-readable label shown in the signing UI")
    .option("--json", "Emit machine-readable JSON")
    .action(actionWith<RegisterOptions>(mandateRegister));
}
mandate
  .command("configure")
  .description(
    "Write per-account bounds on an already-deployed shared permission singleton " +
      "(configureDirect; owner tx via the signing page). Pairs with `mandate register`, " +
      "which only registers — a registered-but-unconfigured singleton denies every call.",
  )
  .requiredOption(
    "--address <singleton>",
    "Shared permission singleton address (deployed on this chain)",
  )
  .requiredOption("--sma <address>", "SMA to configure the singleton for")
  .option("--params <hex>", "Pre-encoded config blob (0x-prefixed hex)")
  .option("--args-file <path>", "JSON file of typed params (paired with --template)")
  .option(
    "--template <name>",
    "Template name (e.g. SwapPermission) — resolves the encoder for --args-file",
  )
  .option("--label <label>", "Human-readable label shown in the signing UI")
  .option("--simulate-only", "Stop after the off-chain pre-flight (no signing, no gas)")
  .option("--force", "Re-configure even if isConfigured is already true")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<ConfigureOptions>(mandateConfigure));
mandate
  .command("deploy-clone")
  .description(
    "[currently unavailable — no clone templates deployed on any chain; use `mandate deploy`] Deploy + register a standalone clone permission via the signing UI",
  )
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
  .description(
    "Show how to author your own permission contract (and any community-deployed addresses)",
  )
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
  .option(
    "--expect <pass|fail>",
    "Inline single call: expected outcome (sets non-zero exit on mismatch)",
  )
  .option("--label <text>", "Inline single call: human-readable label")
  .option("--calls <file>", "Batch: JSON array of { target, calldata, value?, expect?, label? }")
  .option("--json", "Emit machine-readable JSON")
  .option(
    "--summary",
    "Condense output to counts (total / pass / fail / matched) plus full detail for MISMATCHES only",
  )
  .action(actionWith<SimulateOptions>(mandateSimulate));
mandate
  .command("update")
  .description(
    "Update metadata for a tracked permission contract (rename, source path, artifact path)",
  )
  .requiredOption("--address <mandateOrName>", "Permission address or tracked name to update")
  .option("--name <label>", "New tracking label (must be unique within the same chain)")
  .option("--source-path <path>", "Update the relative path to the Solidity source file")
  .option("--artifact-path <path>", "Update the relative path to the Foundry artifact JSON")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<UpdateOptions>(mandateUpdate));
mandate
  .command("list")
  .description("List permission contracts deployed from this project")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(mandateContractsList));

program
  .command("onboard")
  .description("Set up an SMA, register a permission, confirm the agent is operational")
  .option("--sma <address>", "Use a specific SMA address instead of prompting")
  .option("--new-sma", "Create a new SMA via SailKernel")
  .option(
    "--salt <n>",
    "CREATE2 salt for deterministic Safe address (default: 0; use 0 for first SMA, increment for subsequent)",
  )
  .option(
    "--template <kindOrAddress>",
    "Register this permission contract (kind, label, or address)",
  )
  .option("--skip-mandate", "Skip the permission registration step")
  .option("--json", "Emit machine-readable JSON (implies non-interactive)")
  .action(actionWith<OnboardOptions>(onboard));

// `station` is a hidden, deprecated alias of `signer` for v1.2.0 compatibility
// (the printed help never advertises it) — do not remove before the next major.
const signer = program
  .command("signer")
  .alias("station")
  .description("Manage the persistent signing server (browser signing daemon)");
signer
  .command("start")
  .description("Start the signing server and keep it running (blocks — run in the background)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(signerStart));
signer
  .command("status")
  .description("Show whether a signing server is running for this project")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(signerStatus));
signer
  .command("stop")
  .description("Stop the running signing server")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(signerStop));

const owner = program
  .command("owner")
  .description("Detect & persist the project owner (your connected wallet)");
owner
  .command("connect")
  .description("Open the signing page, wait for your wallet, and save it as owner")
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
  .option("--chain <chainId>", "Chain ID to run on (overrides CHAIN_ID env and .env.local)")
  .option(
    "--reason <text>",
    "Label why this run fired (observability only; also read from SAIL_RUN_REASON)",
  )
  .action(async (opts: { once?: boolean; chain?: string; reason?: string }) => {
    try {
      await runCommand({
        once: opts.once,
        chain: opts.chain ? Number(opts.chain) : undefined,
        reason: opts.reason,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      closePrompts();
      process.exit(1);
    }
    closePrompts();
  });

const trigger = program
  .command("trigger")
  .description("Wake the agent on demand from an external system");
trigger
  .command("github")
  .description("Fire the agent's GitHub Actions workflow_dispatch (the same job the cron runs)")
  .option("--workflow <file>", "Workflow file to dispatch", "agent-tick.yml")
  .option("--ref <branch>", "Git ref to run the workflow on", "main")
  .option("--reason <text>", "Why this run fired — recorded as the workflow's reason input")
  .option("--repo <owner/repo>", "Override the repository (default: from the git origin remote)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<TriggerGithubOptions>(triggerGithub));

const session = program.command("session").description("Control the agent session");
session
  .command("pause")
  .description("Pause the agent session (revoke dispatch rights)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(sessionPause));
session
  .command("resume")
  .description("Resume a paused session")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<{ json?: boolean }>(sessionResume));

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

program
  .command("chains")
  .description("List supported chains and their SailKernel deployment addresses")
  .option("--verify", "Verify each kernel is deployed via eth_getCode (one RPC call per chain)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<ChainsOptions>(chainsCommand));

const service = program
  .command("service")
  .description(
    "Run the agent unattended as a local OS service (launchd/systemd/Task Scheduler).\n" +
      "One execution host among several — it runs the loop directly, and composes with\n" +
      "the external-trigger seam (`sailor trigger github`) and the cloud cron job.",
  );
service
  .command("install")
  .description("Install + start the agent as a local service that restarts on crash")
  .option("--interval <s>", "Loop interval in seconds (sets SAILOR_INTERVAL in the unit)")
  .option("--project <path>", "Project root (must contain .sail/; default: current directory)")
  .option("--chain <id>", "Chain ID to run on")
  .option("--force", "Proceed despite a TCC-protected path or unresolved passphrase (with warning)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<ServiceInstallOptions>(serviceInstall));
service
  .command("status")
  .description("Show whether the agent service is installed and running")
  .option("--project <path>", "Project root (default: current directory)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<ServiceOptions>(serviceStatus));
service
  .command("stop")
  .description("Stop the service without removing it")
  .option("--project <path>", "Project root (default: current directory)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<ServiceOptions>(serviceStop));
service
  .command("uninstall")
  .description("Stop and remove the service unit entirely")
  .option("--project <path>", "Project root (default: current directory)")
  .option("--json", "Emit machine-readable JSON")
  .action(actionWith<ServiceOptions>(serviceUninstall));
service
  .command("logs")
  .description("Show the agent log (.sail/agent.log); -f to follow")
  .option("--project <path>", "Project root (default: current directory)")
  .option("-f, --follow", "Follow the log (tail -f)")
  .action(actionWith<ServiceLogsOptions>(serviceLogs));

program.parse(process.argv);
