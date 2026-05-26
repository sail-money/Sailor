import fs from "node:fs";
import { sailPath } from "./io.js";

/** Path to the agent PID file written by `sailor run`. */
export function agentPidPath(): string {
  return sailPath("agent.pid");
}

/** Writes the current process PID to .sail/agent.pid. */
export function writeAgentPid(): void {
  fs.mkdirSync(sailPath(), { recursive: true });
  fs.writeFileSync(agentPidPath(), `${process.pid}\n`);
}

/** Removes the agent PID file if present. */
export function clearAgentPid(): void {
  try {
    fs.rmSync(agentPidPath());
  } catch {
    // already gone — nothing to do
  }
}

/** Reads the recorded agent PID, or null if no (valid) PID file exists. */
export function readAgentPid(): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(agentPidPath(), "utf-8").trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/** Returns true if a process with the given PID is currently alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs error checking without actually sending a signal.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
