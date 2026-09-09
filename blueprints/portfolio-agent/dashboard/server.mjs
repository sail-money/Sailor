import fs from "node:fs";
// Onchain Finance Portfolio Agent — read-only dashboard.
//
// A small local server that reads the project's on-chain state from disk (the runtime's
// snapshot, the mandate record, the activity log) and, for the live token amounts, makes
// plain `balanceOf` reads through the same RPCs the agent uses. Read-only by design: it
// never touches keys, passphrases, or dispatch. See sailor-extend.
//
// Style follows alejandrodopico.com: white ground, black text, the system font, hairline
// black rules, underlined links, a narrow measure. No cards, no gradients, no colour.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http as httpTransport } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SAIL = path.join(ROOT, ".sail");
const RUNTIME = path.join(SAIL, "runtime");
const PID_FILE = path.join(RUNTIME, "dashboard.json");

const PORT = Number(process.env.DASHBOARD_PORT || 4123);
const BALANCE_TTL_MS = 60_000;

// ── State readers (all tolerant of missing files) ────────────────────────────
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SAIL, file), "utf-8"));
  } catch {
    return fallback;
  }
}
function readLines(file) {
  try {
    return fs.readFileSync(path.join(SAIL, file), "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** RPC endpoints the agent itself uses (.sail/.env.local: RPC_URL_<chainId>, RPC_URL + CHAIN_ID). */
function readRpcUrls() {
  const env = {};
  for (const line of readLines(".env.local")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const urls = {};
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^RPC_URL_(\d+)$/);
    if (m && v) urls[m[1]] = v;
  }
  // The scaffold's named variables (see .env.example), for chains without RPC_URL_<id>.
  const named = {
    ETH_MAINNET_RPC_URL: "1",
    BASE_RPC_URL: "8453",
    ARBITRUM_RPC_URL: "42161",
    OPTIMISM_RPC_URL: "10",
    UNICHAIN_RPC_URL: "130",
    WORLD_RPC_URL: "480",
    HYPEREVM_RPC_URL: "999",
    ROBINHOOD_RPC_URL: "4663",
    BSC_RPC_URL: "56",
  };
  for (const [k, id] of Object.entries(named)) if (env[k] && !urls[id]) urls[id] = env[k];
  if (env.RPC_URL && env.CHAIN_ID && !urls[env.CHAIN_ID]) urls[env.CHAIN_ID] = env.RPC_URL;
  return urls;
}

const ERC20_BALANCE_OF = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const clients = new Map();
function clientFor(chainId, url) {
  const key = `${chainId}:${url}`;
  if (!clients.has(key))
    clients.set(key, createPublicClient({ transport: httpTransport(url, { timeout: 8_000 }) }));
  return clients.get(key);
}

let balanceCache = { at: 0, bySymbol: {} };

/** Live token amounts per basket symbol, summed across the chains it lives on. Cached 60s. */
async function readBalances(portfolio, safe) {
  if (!safe || Date.now() - balanceCache.at < BALANCE_TTL_MS) return balanceCache.bySymbol;
  const urls = readRpcUrls();
  const bySymbol = {};
  await Promise.all(
    (portfolio.basket || []).map(async (token) => {
      let total = 0n;
      let decimals = null;
      let ok = false;
      for (const c of token.chains || []) {
        const url = urls[String(c.chainId)];
        if (!url) continue;
        try {
          const raw = await clientFor(c.chainId, url).readContract({
            address: c.address,
            abi: ERC20_BALANCE_OF,
            functionName: "balanceOf",
            args: [safe],
          });
          total += raw;
          decimals = decimals ?? c.decimals;
          ok = true;
        } catch {
          // an unreachable RPC leaves the amount unknown rather than showing a false zero
        }
      }
      if (ok) bySymbol[token.symbol] = { raw: total.toString(), decimals };
    }),
  );
  balanceCache = { at: Date.now(), bySymbol };
  return bySymbol;
}

// ── Formatting ───────────────────────────────────────────────────────────────
function formatUsd(usdc6) {
  const n = BigInt(usdc6 || "0");
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = (abs / 10n ** 6n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 10n ** 6n).toString().padStart(6, "0").slice(0, 2);
  return `${neg ? "−" : ""}$${whole}.${frac}`;
}
function pct(bps) {
  return `${(Number(bps) / 100).toFixed(1)}%`;
}
/** A token amount with up to 4 decimals, trailing zeros trimmed: 3.6, 0.0421, 1,204.5 */
function formatAmount(raw, decimals) {
  const n = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = ((n % base) * 10_000n) / base; // 4 decimal places
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracStr = frac.toString().padStart(4, "0").replace(/0+$/, "");
  return fracStr ? `${wholeStr}.${fracStr}` : wholeStr;
}

async function buildState() {
  const snapshot = readJson("state/snapshot.json", null);
  const account = readJson("account.json", {});
  const portfolio = readJson("portfolio.json", {});
  const ui = readJson("runtime/ui.json", null);
  const balances = await readBalances(portfolio, account.safe);

  // Holdings: the basket is the source of truth for the rows (a newly added asset shows up at
  // 0 before the runtime's first tick with it); the snapshot supplies value and weight.
  const snapBySymbol = new Map((snapshot?.holdings || []).map((h) => [h.symbol, h]));
  const holdings = (portfolio.basket || []).map((t) => {
    const h = snapBySymbol.get(t.symbol);
    const targetBps = Math.round(t.weight * 10_000);
    const bal = balances[t.symbol];
    return {
      symbol: t.symbol,
      amount: bal ? formatAmount(bal.raw, bal.decimals) : null,
      value: h ? formatUsd(h.value) : null,
      weightPct: h ? pct(h.weightBps) : null,
      targetPct: pct(targetBps),
      weightBps: h ? Number(h.weightBps) : 0,
      targetBps,
      status: h ? h.status : "pending",
      chainIds: (t.chains || []).map((c) => c.chainId),
    };
  });
  // Biggest holding first; assets never bought (no snapshot value yet) last.
  const sortValue = (h) =>
    snapBySymbol.has(h.symbol) ? Number(snapBySymbol.get(h.symbol).value) : -1;
  holdings.sort((a, b) => sortValue(b) - sortValue(a));

  // P&L is measured against what the owner actually put in. Net deposits = cost basis of the
  // holdings (USDC spent on buys minus USDC received from sells) + idle USDC + USDC in flight —
  // a quantity the agent's own trading never changes; only deposits and withdrawals move it.
  // The holdings' current market value ("invested") is NOT that number and read as misleading.
  let netDeposits = null;
  let pnl = null;
  let pnlPct = null;
  if (snapshot?.costBasis != null && snapshot?.investedValue != null) {
    const holdingsValue = BigInt(snapshot.investedValue);
    const cost = BigInt(snapshot.costBasis);
    const deposits =
      cost + BigInt(snapshot.idleUsdc || "0") + BigInt(snapshot.pendingBridgeUsdc || "0");
    const d = holdingsValue - cost; // equals totalValue − netDeposits
    netDeposits = formatUsd(deposits);
    pnl = d >= 0n ? `+${formatUsd(d)}` : formatUsd(d);
    if (deposits > 0n)
      pnlPct = `${d < 0n ? "−" : "+"}${((Number(d < 0n ? -d : d) / Number(deposits)) * 100).toFixed(2)}%`;
  }

  return {
    title: readJson("dashboard.json", { title: "Onchain Finance Portfolio Agent" }).title,
    safe: account.safe || null,
    chains: account.deployedChains || [],
    sailorUiUrl: ui?.port ? `http://localhost:${ui.port}` : null,
    totalValue: snapshot ? formatUsd(snapshot.totalValue) : null,
    holdingsValue: snapshot ? formatUsd(snapshot.investedValue) : null,
    netDeposits,
    pnl,
    pnlPct,
    rebalanceBand:
      portfolio.rebalanceBandBps != null ? `±${portfolio.rebalanceBandBps / 100}pp` : null,
    holdings,
    asOf: snapshot?.asOf ? new Date(snapshot.asOf * 1000).toISOString() : null,
    balancesAsOf: balanceCache.at ? new Date(balanceCache.at).toISOString() : null,
  };
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Onchain Finance Portfolio Agent</title>
<style>
  :root { --bg: #fff; --fg: #000; --rule: #000; --muted: #666; --track: #e6e6e6; --gap: 1.5rem; --measure: 76ch; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { color-scheme: light; }
  body {
    font-family: -apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 16px; line-height: 1.55; color: var(--fg); background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--fg); text-decoration: underline; text-underline-offset: 2px; }
  .wrap { max-width: var(--measure); margin: 0 auto; padding: 0 1rem 4rem; }
  nav { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid var(--rule); }
  nav .spacer { flex: 1; }
  nav .live { font-size: 0.85rem; }
  h1 { font-size: 1.6rem; font-weight: 700; line-height: 1.2; margin: var(--gap) 0 0.25rem; }
  h2 { font-size: 1.2rem; font-weight: 700; margin: calc(var(--gap) * 1.25) 0 0.5rem; }
  .meta { margin-top: 0.25rem; }
  .meta .sep { margin: 0 0.4rem; }
  .note { color: var(--muted); font-size: 0.9rem; margin-top: 0.4rem; }
  .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.9em; }

  .summary { display: flex; flex-wrap: wrap; gap: 0 2.5rem; margin-top: var(--gap); padding: 0.75rem 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
  .summary div { padding: 0.25rem 0; }
  .summary .label { display: block; font-size: 0.85rem; color: var(--muted); }
  .summary .value { font-size: 1.35rem; font-weight: 700; line-height: 1.2; }
  .summary .sub { font-size: 0.85rem; color: var(--muted); }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 400; font-size: 0.85rem; color: var(--muted); padding: 0.4rem 0.6rem 0.4rem 0; border-bottom: 1px solid var(--rule); }
  td { padding: 0.55rem 0.6rem 0.55rem 0; border-bottom: 1px solid var(--track); vertical-align: middle; }
  tr:last-child td { border-bottom: 1px solid var(--rule); }
  td.num, th.num { text-align: right; padding-right: 1.4rem; }
  td.sym { font-weight: 700; }
  td.amt { white-space: nowrap; }
  .bar { position: relative; height: 4px; background: var(--track); min-width: 90px; }
  .bar .fill { position: absolute; inset: 0 auto 0 0; background: var(--fg); }
  .bar .target { position: absolute; top: -4px; bottom: -4px; width: 1px; background: var(--fg); }
  .w { display: flex; align-items: center; gap: 0.6rem; }
  .w span { min-width: 3.2rem; }
  .status { font-size: 0.85rem; }
  .status.sell::before, .status.buy::before { content: "→ "; }

  ul.list { list-style: none; }
  ul.list li { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; padding: 0.45rem 0; border-bottom: 1px solid var(--track); }
  ul.list li:last-child { border-bottom: 1px solid var(--rule); }
  ul.list .t { font-family: ui-monospace, Menlo, monospace; font-size: 0.8rem; color: var(--muted); min-width: 11.5rem; }
  ul.list .k { font-weight: 700; }
  ul.list .r { margin-left: auto; color: var(--muted); font-size: 0.85rem; white-space: nowrap; }
  .empty { color: var(--muted); }
  footer { margin-top: calc(var(--gap) * 1.5); padding-top: 0.75rem; border-top: 1px solid var(--rule); font-size: 0.85rem; color: var(--muted); }
  @media (max-width: 640px) { .hide-sm { display: none; } }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <a href="/">portfolio</a>
    <a id="sailor-link" href="#" hidden>sailor</a>
    <a id="basescan" href="#" target="_blank" rel="noopener">basescan</a>
    <a id="etherscan" href="#" target="_blank" rel="noopener">etherscan</a>
    <a id="debank" href="#" target="_blank" rel="noopener">debank</a>
    <span class="spacer"></span>
    <span class="live" id="live">…</span>
  </nav>

  <h1 id="title">Onchain Finance Portfolio Agent</h1>
  <div class="meta">
    <span class="mono" id="safe">—</span><span class="sep">·</span><span id="chains"></span>
  </div>
  <div class="note">Self-custodied. Every trade enforced on-chain by a mandate. Read-only view.</div>

  <div class="summary">
    <div><span class="label">Portfolio value</span><span class="value" id="total">—</span></div>
    <div><span class="label">Net deposits</span><span class="value" id="deposits">—</span></div>
    <div><span class="label">P&amp;L</span><span class="value" id="pnl">—</span></div>
  </div>

  <h2>Holdings</h2>
  <table>
    <thead><tr><th>Asset</th><th>Amount</th><th class="num">Value</th><th>Weight</th><th class="num">Target</th><th class="hide-sm">Status</th></tr></thead>
    <tbody id="holdings"></tbody>
  </table>
  <div class="note" id="band"></div>

  <footer><span id="asof"></span> Values from the agent's last tick; amounts read live and refreshed every minute. Mandate and activity live in the <a id="sailor-foot" href="#">Sailor dashboard</a>.</footer>
</div>

<script>
const $ = (id) => document.getElementById(id);
const short = (a) => a ? a.slice(0,6) + "…" + a.slice(-4) : "";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const chainName = (id) => ({1:"Ethereum",8453:"Base",4663:"Robinhood"}[id] || ("chain " + id));

async function refresh() {
  try {
    const r = await fetch("/api/state");
    const s = await r.json();
    $("title").textContent = s.title || "Onchain Finance Portfolio Agent";
    document.title = s.title || "Onchain Finance Portfolio Agent";
    $("safe").textContent = s.safe || "—";
    $("chains").textContent = (s.chains || []).map(chainName).join(" · ");
    if (s.sailorUiUrl) { $("sailor-link").href = s.sailorUiUrl; $("sailor-link").hidden = false; $("sailor-foot").href = s.sailorUiUrl; }
    $("asof").textContent = s.asOf ? "As of " + new Date(s.asOf).toLocaleString() + "." : "";
    if (s.safe) {
      $("basescan").href = "https://basescan.org/address/" + s.safe;
      $("etherscan").href = "https://etherscan.io/address/" + s.safe;
      $("debank").href = "https://debank.com/profile/" + s.safe;
    }
    $("live").textContent = s.balancesAsOf ? "live · " + new Date(s.balancesAsOf).toLocaleTimeString() : "";
    $("total").textContent = s.totalValue || "—";
    $("deposits").textContent = s.netDeposits || "—";
    $("pnl").textContent = s.pnl ? s.pnl + (s.pnlPct ? " (" + s.pnlPct + ")" : "") : "—";
    $("band").textContent = s.rebalanceBand ? "Rebalance band " + s.rebalanceBand + " around each target; trims on the rebalance cadence (every run by default), buys toward target on every run." : "";

    $("holdings").innerHTML = (s.holdings || []).map((h) => {
      const w = Math.min(100, Math.max(0, h.weightBps / 100));
      const tgt = Math.min(100, h.targetBps / 100);
      const status = h.status === "in-band" ? "in band" : h.status;
      return '<tr><td class="sym">' + esc(h.symbol) + '</td>' +
        '<td class="amt">' + (h.amount != null ? esc(h.amount) + ' <span class="mono">' + esc(h.symbol) + '</span>' : '<span class="empty">—</span>') + '</td>' +
        '<td class="num">' + (h.value || '<span class="empty">—</span>') + '</td>' +
        '<td><div class="w"><span>' + (h.weightPct || '—') + '</span><div class="bar"><div class="fill" style="width:' + w + '%"></div><div class="target" style="left:' + tgt + '%"></div></div></div></td>' +
        '<td class="num">' + esc(h.targetPct) + '</td>' +
        '<td class="hide-sm"><span class="status ' + esc(h.status) + '">' + esc(status) + '</span></td></tr>';
    }).join("");

  } catch (err) {
    console.error(err);
    $("live").textContent = "offline";
  }
}
refresh();
setInterval(refresh, 15000);
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  if (req.url === "/api/state") {
    try {
      const state = await buildState();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(state));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(PAGE);
});

// ── Lifecycle: record { pid, port, startedAt } like `sailor ui` does, fail loudly on a
// taken port (instead of a silent crash), and clean the record up on exit.
function writePidFile() {
  try {
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.writeFileSync(
      PID_FILE,
      `${JSON.stringify({ pid: process.pid, port: PORT, startedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  } catch (err) {
    console.error(`could not write ${PID_FILE}: ${err.message}`);
  }
}
function removePidFile() {
  try {
    const cur = JSON.parse(fs.readFileSync(PID_FILE, "utf-8"));
    if (cur.pid === process.pid) fs.unlinkSync(PID_FILE);
  } catch {
    // nothing to clean up
  }
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `port ${PORT} is already in use — another dashboard (or a stale process) holds it. Run \`npm run dashboard:stop\` or set DASHBOARD_PORT to a free port.`,
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  writePidFile();
  console.log(
    `Onchain Finance Portfolio Agent dashboard → http://localhost:${PORT}  (pid ${process.pid})`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    removePidFile();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
