import fs from "node:fs";
import net from "node:net";
import { sailPath } from "./io.js";

/** Path to the agent PID file for a given chain (or legacy chain-agnostic). */
export function agentPidPath(chainId?: number): string {
  return chainId != null ? sailPath(`agent-${chainId}.pid`) : sailPath("agent.pid");
}

/** Writes the current process PID to .sail/agent-<chainId>.pid. */
export function writeAgentPid(chainId?: number): void {
  fs.mkdirSync(sailPath(), { recursive: true });
  fs.writeFileSync(agentPidPath(chainId), `${process.pid}\n`);
}

/** Removes the agent PID file for the given chain (or legacy) if present. */
export function clearAgentPid(chainId?: number): void {
  try {
    fs.rmSync(agentPidPath(chainId));
  } catch {
    // already gone — nothing to do
  }
}

/** Reads the recorded agent PID, or null if no (valid) PID file exists. */
export function readAgentPid(chainId?: number): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(agentPidPath(chainId), "utf-8").trim(), 10);
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
  } catch (err) {
    // EPERM means the process exists but we can't signal it — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Resolves the first free TCP port at or above `from` (probes 127.0.0.1). */
export function findFreePort(from: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => findFreePort(from + 1).then(resolve, reject));
    server.listen(from, "127.0.0.1", () => server.close(() => resolve(from)));
  });
}
