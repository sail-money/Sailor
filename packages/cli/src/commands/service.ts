import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnvFile } from "../lib/io.js";
import { keyExists } from "../lib/keys.js";
import { emit } from "../lib/output.js";
import type { StoredAccount } from "../lib/state.js";

/**
 * `sailor service` — install/manage the agent as an unattended local OS service
 * (launchd on macOS, systemd --user on Linux, Task Scheduler on Windows).
 *
 * This is the LOCAL execution host: it runs `sailor run` (the loop) in the
 * project directory, restarting on crash. It is ONE host among several — the
 * cloud cron job and the external-trigger seam (`sailor trigger github`) are
 * others — and it's the right choice for privacy, no-committed-keys, or
 * latency-sensitive strategies. It can also (later) host a local watcher that
 * fires runs on events; here it just runs the loop directly.
 *
 * The keystore passphrase is NEVER written into the unit file. The service
 * relies on `sailor run` injecting `SAIL_PASSPHRASE` from the project's 0600
 * `.sail/.env.local` (per the passphrase-persistence work), so the only secret
 * at rest is the already-protected env file. `install` refuses to proceed if the
 * passphrase isn't resolvable from there — otherwise every tick would fail to
 * unlock the key.
 */

// ── Config + pure unit generators (testable without touching the OS) ──────────

export interface ServiceConfig {
  /** Sanitized project name used in unit/label/file names. */
  projectName: string;
  /** Absolute project root (contains .sail/). Becomes the unit's working dir. */
  projectDir: string;
  /** Absolute path to the node binary (process.execPath) — units don't inherit PATH. */
  nodePath: string;
  /** Absolute path to the sailor CLI entry (resolved index.cjs) — never bare `npx sailor`. */
  cliEntry: string;
  /** Absolute path to the agent log file (.sail/agent.log). */
  logPath: string;
  /** Loop interval seconds → SAILOR_INTERVAL in the unit env (run reads it). */
  interval?: number;
  /** Chain id → `run --chain`. */
  chain?: number;
  /** Seconds to wait before restarting after a crash. */
  restartSec?: number;
}

/** Reduce a project name to a safe token for file/label names. */
export function sanitizeName(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "agent";
}

/** macOS launchd label, e.g. money.sail.my-agent. */
export function launchdLabel(projectName: string): string {
  return `money.sail.${projectName}`;
}

/** Linux systemd unit name, e.g. sail-my-agent.service. */
export function systemdUnitName(projectName: string): string {
  return `sail-${projectName}.service`;
}

/** Windows Task Scheduler task name, e.g. Sail-my-agent. */
export function windowsTaskName(projectName: string): string {
  return `Sail-${projectName}`;
}

/** `run` arguments derived from the config (chain as a flag; interval via env). */
function runArgs(cfg: ServiceConfig): string[] {
  const args = ["run"];
  if (cfg.chain != null) args.push("--chain", String(cfg.chain));
  return args;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * macOS LaunchAgent plist. RunAtLoad + KeepAlive-on-crash (restart only when the
 * loop exits non-zero) + ThrottleInterval to avoid crash loops. Absolute node +
 * CLI paths because launchd does not inherit the shell PATH. SAILOR_INTERVAL is
 * the only env we set — the passphrase comes from .env.local via `run`.
 */
export function buildLaunchdPlist(cfg: ServiceConfig): string {
  const label = launchdLabel(cfg.projectName);
  const args = [cfg.nodePath, cfg.cliEntry, ...runArgs(cfg)];
  const argXml = args.map((a) => `    <string>${xmlEscape(a)}</string>`).join("\n");
  const intervalEnv =
    cfg.interval != null
      ? `  <key>EnvironmentVariables</key>\n  <dict>\n    <key>SAILOR_INTERVAL</key>\n    <string>${cfg.interval}</string>\n  </dict>\n`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(cfg.projectDir)}</string>
${intervalEnv}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>${cfg.restartSec ?? 30}</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(cfg.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(cfg.logPath)}</string>
</dict>
</plist>
`;
}

/**
 * Linux systemd --user service. Restart=on-failure with RestartSec. Absolute
 * node + CLI paths (systemd doesn't inherit the login PATH). Logs go to the
 * journal AND are appended to .sail/agent.log via StandardOutput=append.
 */
export function buildSystemdUnit(cfg: ServiceConfig): string {
  const exec = [cfg.nodePath, cfg.cliEntry, ...runArgs(cfg)]
    .map((a) => (/\s/.test(a) ? `"${a}"` : a))
    .join(" ");
  const intervalEnv = cfg.interval != null ? `Environment=SAILOR_INTERVAL=${cfg.interval}\n` : "";
  return `[Unit]
Description=Sail agent — ${cfg.projectName}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${cfg.projectDir}
${intervalEnv}ExecStart=${exec}
Restart=on-failure
RestartSec=${cfg.restartSec ?? 30}
StandardOutput=append:${cfg.logPath}
StandardError=append:${cfg.logPath}

[Install]
WantedBy=default.target
`;
}

/**
 * Windows Task Scheduler task XML (registered with `schtasks /Create /XML`).
 * Runs at logon, restarts on failure. The action is cmd.exe so stdout/stderr can
 * be appended to the log file and SAILOR_INTERVAL can be set inline; the node and
 * CLI paths are absolute.
 */
export function buildWindowsTaskXml(cfg: ServiceConfig): string {
  const runTail = runArgs(cfg).join(" ");
  const intervalSet = cfg.interval != null ? `set SAILOR_INTERVAL=${cfg.interval}&& ` : "";
  // cmd /c "<set?> "node" "cli" run >> "log" 2>&1"
  const inner = `${intervalSet}"${cfg.nodePath}" "${cfg.cliEntry}" ${runTail} >> "${cfg.logPath}" 2>&1`;
  const args = `/c "${inner}"`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Sail agent — ${xmlEscape(cfg.projectName)}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Settings>
    <RestartOnFailure>
      <Interval>PT${cfg.restartSec ?? 30}S</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions>
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>${xmlEscape(args)}</Arguments>
      <WorkingDirectory>${xmlEscape(cfg.projectDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

// ── OS gotcha #1: macOS TCC-protected directories ─────────────────────────────

/**
 * launchd jobs cannot read TCC-protected dirs (~/Desktop, ~/Documents,
 * ~/Downloads) — a service whose project lives there silently can't read
 * `.sail/`. Pure so it's testable with an injected home dir.
 */
export function isTccProtected(projectDir: string, home: string = os.homedir()): boolean {
  const rel = path.relative(home, path.resolve(projectDir));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false; // not under home
  const top = rel.split(path.sep)[0];
  return ["Desktop", "Documents", "Downloads"].includes(top ?? "");
}

// ── OS gotcha #2 helper: resolve the absolute CLI entry ───────────────────────

/** The absolute path to the running sailor CLI script (resolves the bin symlink). */
export function resolveCliEntry(): string {
  try {
    return fs.realpathSync(process.argv[1] as string);
  } catch {
    return path.resolve(process.argv[1] as string);
  }
}

// ── Project resolution (Feedback #7: no upward walk; refuse ambiguity) ─────────

/**
 * Resolve the project root: an explicit `--project`, else cwd. The directory
 * MUST directly contain `.sail/` — we do NOT walk upward and latch onto a parent
 * project, which would silently install a service for the wrong agent.
 */
export function resolveProjectDir(explicit?: string): string {
  const dir = path.resolve(explicit ?? process.cwd());
  if (!fs.existsSync(path.join(dir, ".sail"))) {
    throw new Error(
      `No .sail/ found in ${dir}.\n` +
        "Run this from your Sailor project root, or pass --project <path>. " +
        "(The installer does not search parent directories — that would risk targeting the wrong project.)",
    );
  }
  return dir;
}

// ── Passphrase readiness (reuses #128's intent, scoped to what a unit gets) ────

export interface PassphraseReadiness {
  keystorePresent: boolean;
  passphraseInEnvFile: boolean;
  ready: boolean;
}

/**
 * A unit does NOT inherit the shell env, so the only SAIL_PASSPHRASE source it
 * gets is the project's `.sail/.env.local` (injected by `run`). Readiness =
 * a manager keystore exists AND `.env.local` carries SAIL_PASSPHRASE.
 */
export function passphraseReadiness(projectDir: string): PassphraseReadiness {
  const account = (() => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(projectDir, ".sail", "account.json"), "utf-8"),
      ) as StoredAccount;
    } catch {
      return null;
    }
  })();
  // keyExists resolves relative to process.cwd(); evaluate from the project dir.
  const prevCwd = process.cwd();
  let keystorePresent = false;
  try {
    process.chdir(projectDir);
    keystorePresent = keyExists("manager", account?.safe);
  } catch {
    keystorePresent = false;
  } finally {
    process.chdir(prevCwd);
  }
  const env = parseEnvFile(path.join(projectDir, ".sail", ".env.local"));
  const passphraseInEnvFile = Boolean(env.SAIL_PASSPHRASE);
  return { keystorePresent, passphraseInEnvFile, ready: keystorePresent && passphraseInEnvFile };
}

// ── Build a config for the current install ─────────────────────────────────────

function buildConfig(opts: ServiceInstallOptions): ServiceConfig {
  const projectDir = resolveProjectDir(opts.project);
  return {
    projectName: sanitizeName(path.basename(projectDir)),
    projectDir,
    nodePath: process.execPath,
    cliEntry: resolveCliEntry(),
    logPath: path.join(projectDir, ".sail", "agent.log"),
    interval: opts.interval != null ? Number(opts.interval) : undefined,
    chain: opts.chain != null ? Number(opts.chain) : undefined,
    restartSec: 30,
  };
}

// ── Commands ───────────────────────────────────────────────────────────────────

export interface ServiceInstallOptions {
  interval?: string;
  project?: string;
  chain?: string;
  force?: boolean;
  json?: boolean;
}

export interface ServiceOptions {
  project?: string;
  json?: boolean;
}

export interface ServiceLogsOptions extends ServiceOptions {
  follow?: boolean;
}

function plistPath(projectName: string): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${launchdLabel(projectName)}.plist`);
}

function systemdPath(projectName: string): string {
  return path.join(os.homedir(), ".config", "systemd", "user", systemdUnitName(projectName));
}

export async function serviceInstall(opts: ServiceInstallOptions = {}): Promise<void> {
  const cfg = buildConfig(opts);
  const platform = process.platform;

  // Gotcha #1 — macOS TCC.
  if (platform === "darwin" && isTccProtected(cfg.projectDir)) {
    const msg =
      `Project is under a macOS TCC-protected folder (Desktop/Documents/Downloads):\n  ${cfg.projectDir}\n` +
      "launchd services cannot read those folders, so the agent would silently fail to read .sail/.\n" +
      "Move the project somewhere like ~/sail/<name>, or re-run with --force to install anyway.";
    if (!opts.force) throw new Error(msg);
    console.warn(`⚠ ${msg}\n  Proceeding because --force was given.`);
  }

  // Passphrase readiness (the #128 preflight, scoped to what a unit can see).
  const pp = passphraseReadiness(cfg.projectDir);
  if (!pp.ready) {
    const why = !pp.keystorePresent
      ? "no agent keystore found"
      : "SAIL_PASSPHRASE is not in .sail/.env.local";
    const msg =
      `Passphrase not resolvable for an unattended service (${why}).\n` +
      "A service does not inherit your shell env, so SAIL_PASSPHRASE must live in .sail/.env.local (0600).\n" +
      'Run "sailor keys generate" (and save the passphrase) or set it in .sail/.env.local, then retry. ' +
      'Verify with "sailor doctor".';
    if (!opts.force) throw new Error(msg);
    console.warn(`⚠ ${msg}\n  Proceeding because --force was given.`);
  }

  fs.mkdirSync(path.dirname(cfg.logPath), { recursive: true });

  if (platform === "darwin") {
    const plist = buildLaunchdPlist(cfg);
    const dest = plistPath(cfg.projectName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, plist);
    const uid = process.getuid?.() ?? 0;
    try {
      // Replace any prior instance, then load.
      try {
        execFileSync("launchctl", ["bootout", `gui/${uid}/${launchdLabel(cfg.projectName)}`], {
          stdio: "ignore",
        });
      } catch {
        /* not loaded yet */
      }
      execFileSync("launchctl", ["bootstrap", `gui/${uid}`, dest], { stdio: "inherit" });
    } catch (err) {
      throw new Error(`launchctl bootstrap failed: ${(err as Error).message}`);
    }
    emit(opts.json, () => okInstall(cfg, dest), { status: "ok", platform, unit: dest, ...cfg });
    return;
  }

  if (platform === "linux") {
    const unit = buildSystemdUnit(cfg);
    const dest = systemdPath(cfg.projectName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, unit);
    try {
      execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
      execFileSync("systemctl", ["--user", "enable", "--now", systemdUnitName(cfg.projectName)], {
        stdio: "inherit",
      });
    } catch (err) {
      throw new Error(`systemctl --user enable failed: ${(err as Error).message}`);
    }
    emit(opts.json, () => okInstall(cfg, dest), { status: "ok", platform, unit: dest, ...cfg });
    return;
  }

  if (platform === "win32") {
    const xml = buildWindowsTaskXml(cfg);
    const dest = path.join(os.tmpdir(), `${windowsTaskName(cfg.projectName)}.xml`);
    fs.writeFileSync(dest, xml, "utf-8");
    try {
      execFileSync(
        "schtasks",
        ["/Create", "/TN", windowsTaskName(cfg.projectName), "/XML", dest, "/F"],
        { stdio: "inherit" },
      );
    } catch (err) {
      throw new Error(`schtasks /Create failed: ${(err as Error).message}`);
    } finally {
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        /* best effort */
      }
    }
    emit(opts.json, () => okInstall(cfg, windowsTaskName(cfg.projectName)), {
      status: "ok",
      platform,
      unit: windowsTaskName(cfg.projectName),
      ...cfg,
    });
    return;
  }

  throw new Error(`Unsupported platform for service install: ${platform}`);
}

function okInstall(cfg: ServiceConfig, unit: string): void {
  console.log(`✓ Installed Sail agent service for "${cfg.projectName}"`);
  console.log(`  unit:    ${unit}`);
  console.log(`  runs:    ${cfg.nodePath} ${cfg.cliEntry} ${runArgs(cfg).join(" ")}`);
  console.log(`  workdir: ${cfg.projectDir}`);
  console.log(`  logs:    ${cfg.logPath}   (sailor service logs -f)`);
  console.log("  The loop runs unattended and restarts on crash.");
  console.log(
    "  This is one execution host; you can also wake the agent on demand with `sailor trigger github`.",
  );
}

export async function serviceStatus(opts: ServiceOptions = {}): Promise<void> {
  const projectName = sanitizeName(path.basename(resolveProjectDir(opts.project)));
  const platform = process.platform;
  // `installed` (the unit is registered) and `running` (a live process right
  // now) are independent: a healthy service caught between ticks, throttled, or
  // crash-looping is installed-but-not-running. Track them separately so we
  // never report a registered unit as "not installed".
  let installed = false;
  let running = false;
  let detail = "";
  try {
    if (platform === "darwin") {
      installed = fs.existsSync(plistPath(projectName));
      const uid = process.getuid?.() ?? 0;
      try {
        // stderr ignored so launchctl's "Could not find service" noise (when the
        // job isn't loaded) doesn't leak to the terminal before our clean verdict.
        detail = execFileSync("launchctl", ["print", `gui/${uid}/${launchdLabel(projectName)}`], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        installed = true; // loaded into launchd → definitely installed
        running = /state = running/.test(detail);
      } catch {
        /* not loaded — `installed` stays as the on-disk plist check above */
      }
    } else if (platform === "linux") {
      installed = fs.existsSync(systemdPath(projectName));
      try {
        // is-active prints active/inactive/failed; it exits non-zero unless
        // active, so the value also arrives via stdout on the throw.
        detail = execFileSync("systemctl", ["--user", "is-active", systemdUnitName(projectName)], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch (err) {
        detail = ((err as { stdout?: Buffer }).stdout?.toString() ?? "").trim() || (err as Error).message;
      }
      running = detail === "active";
    } else if (platform === "win32") {
      try {
        detail = execFileSync("schtasks", ["/Query", "/TN", windowsTaskName(projectName)], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        installed = true; // schtasks query succeeded → the task exists
        running = /Running/.test(detail);
      } catch (err) {
        detail = (err as Error).message;
      }
    }
  } catch (err) {
    detail = (err as Error).message;
  }
  const state = !installed ? "not installed" : running ? "running" : "installed · idle";
  emit(
    opts.json,
    () => {
      console.log(`Service "${projectName}": ${state}`);
      if (detail) console.log(detail.split("\n").slice(0, 8).join("\n"));
    },
    { status: "ok", project: projectName, installed, running },
  );
}

export async function serviceStop(opts: ServiceOptions = {}): Promise<void> {
  const projectName = sanitizeName(path.basename(resolveProjectDir(opts.project)));
  const platform = process.platform;
  if (platform === "darwin") {
    const uid = process.getuid?.() ?? 0;
    execFileSync("launchctl", ["bootout", `gui/${uid}/${launchdLabel(projectName)}`], {
      stdio: "inherit",
    });
  } else if (platform === "linux") {
    execFileSync("systemctl", ["--user", "stop", systemdUnitName(projectName)], { stdio: "inherit" });
  } else if (platform === "win32") {
    execFileSync("schtasks", ["/End", "/TN", windowsTaskName(projectName)], { stdio: "inherit" });
  }
  emit(opts.json, () => console.log(`✓ Stopped service "${projectName}" (not removed).`), {
    status: "ok",
    project: projectName,
    stopped: true,
  });
}

export async function serviceUninstall(opts: ServiceOptions = {}): Promise<void> {
  const projectName = sanitizeName(path.basename(resolveProjectDir(opts.project)));
  const platform = process.platform;
  if (platform === "darwin") {
    const uid = process.getuid?.() ?? 0;
    try {
      execFileSync("launchctl", ["bootout", `gui/${uid}/${launchdLabel(projectName)}`], {
        stdio: "ignore",
      });
    } catch {
      /* already stopped */
    }
    fs.rmSync(plistPath(projectName), { force: true });
  } else if (platform === "linux") {
    try {
      execFileSync("systemctl", ["--user", "disable", "--now", systemdUnitName(projectName)], {
        stdio: "ignore",
      });
    } catch {
      /* already disabled */
    }
    fs.rmSync(systemdPath(projectName), { force: true });
    try {
      execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    } catch {
      /* best effort */
    }
  } else if (platform === "win32") {
    execFileSync("schtasks", ["/Delete", "/TN", windowsTaskName(projectName), "/F"], {
      stdio: "inherit",
    });
  }
  emit(opts.json, () => console.log(`✓ Uninstalled service "${projectName}".`), {
    status: "ok",
    project: projectName,
    uninstalled: true,
  });
}

export async function serviceLogs(opts: ServiceLogsOptions = {}): Promise<void> {
  const projectDir = resolveProjectDir(opts.project);
  const logPath = path.join(projectDir, ".sail", "agent.log");
  if (!fs.existsSync(logPath)) {
    console.log(`No log yet at ${logPath}. The service writes here once it runs.`);
    return;
  }
  if (opts.follow) {
    // Stream new lines. `tail -f` is universal on macOS/Linux; on Windows fall
    // back to a one-shot read (PowerShell Get-Content -Wait differs per shell).
    if (process.platform === "win32") {
      console.log(fs.readFileSync(logPath, "utf-8"));
      console.log("(follow mode is not supported on Windows here — re-run to refresh)");
      return;
    }
    execFileSync("tail", ["-f", logPath], { stdio: "inherit" });
    return;
  }
  // Last ~200 lines.
  const lines = fs.readFileSync(logPath, "utf-8").split("\n");
  console.log(lines.slice(-200).join("\n"));
}
