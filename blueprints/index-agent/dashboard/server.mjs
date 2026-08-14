/**
 * Index agent dashboard — a small, local, read-only server.
 *
 * Serves the dashboard at / and the agent's latest portfolio snapshot at
 * /snapshot.json (read from .sail/state/snapshot.json, written every tick by the
 * runtime). Read-only by construction: it never holds keys or writes on-chain.
 *
 * Run with `pnpm dashboard`. Port is INDEX_DASHBOARD_PORT (default 4100, outside
 * the 3333-3999 Sailor UI range and the 3141 signing server).
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.INDEX_DASHBOARD_PORT ?? 4100);
const sailDir = process.env.SAIL_DIR ?? path.join(process.cwd(), ".sail");

// The dashboard title is the one user-facing parameter. It can be set in
// .sail/dashboard.json ({ "title": "..." }) at onboarding; otherwise "Your index".
const title = (() => {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(sailDir, "dashboard.json"), "utf-8"));
    return typeof meta.title === "string" && meta.title ? meta.title : "Your index";
  } catch {
    return "Your index";
  }
})();

function readSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(path.join(sailDir, "state", "snapshot.json"), "utf-8"));
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/snapshot.json") {
    const snap = readSnapshot();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(snap ? { ...snap, title } : { ready: false }));
    return;
  }
  const html = fs.readFileSync(path.join(here, "index.html"), "utf-8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

server.listen(port, () => {
  console.log(`index dashboard: http://localhost:${port}`);
  console.log(`  reads ${path.join(sailDir, "state", "snapshot.json")}`);
});
