---
name: sailor-servers
description: Start, stop, and health-check the local dashboard and signing server, and set up remote access. Use when launching the UI, when the dashboard won't open, when a signing request needs a browser, or for a port or pid question.
station: anytime
---

# sailor-servers — the dashboard and signing server

Two distinct local servers — the dashboard (`sailor ui`) and the signing server (`sailor signer`). Both are per-project, both write state under `.sail/runtime/`, and both start idempotently (starting twice reports "already running" and exits 0). A third server, the **sandbox dashboard** (`sailor sandbox`), is the same dashboard rooted at `.shipyard/sandbox/` — covered in its own section below.

## Dashboard — `sailor ui`

```bash
sailor ui start    # spawns a detached Express server, prints the URL, returns immediately
sailor ui status   # ● running  http://localhost:<port>  (pid N)
sailor ui stop     # SIGTERM via the pid file
sailor ui start --expose tailscale   # also serve it on the tailnet over HTTPS (opt-in)
```

- Port: deterministic per project — `3333 + (hash(projectPath) % 667)`, i.e. somewhere in 3333–3999, bumped to the next free port if taken. **Do not assume 3333** — always use the URL the command prints or read `.sail/runtime/ui.json` (`{ pid, port, startedAt, exposed }`).
- The server serves the pre-built React app (`SERVE_DIST=1`) and a local `/api` that reads `.sail/` state (`SAIL_DIR` env).
- `ui start` does not block — no `&` needed.
- `--expose tailscale` (optional): proxies the dashboard onto the operator's tailnet over HTTPS via `tailscale serve` (tailnet-private, never `funnel`). Requires `tailscale` installed + logged in, and Serve + HTTPS enabled for the tailnet (else the command prints the enable link). `ui stop` tears the proxy down. To allow extra browser origins, set `SAILOR_CORS_ORIGINS` (comma-separated; the local origin is always allowed).
- Binds `127.0.0.1` by default (local only). To expose without `--expose tailscale` — e.g. behind a reverse proxy on a domain — set `SAILOR_HOST=0.0.0.0`. The `/api` key-management endpoints are **unauthenticated**, so only do this behind your own auth (reverse-proxy basic-auth or a private tailnet), and throttle them with `SAILOR_RATE_LIMIT_PER_MIN` (default 100; or `rateLimitPerMin` in `.sail/config.json`).

## Sandbox dashboard — `sailor sandbox`

A **second dashboard** for the native sandbox (local anvil forks, zero real funds). Same bundled server as `sailor ui`, but rooted at `.shipyard/sandbox/` instead of `.sail/`, on its own port, with its own EIP-1193 dev wallet wired straight to its forks — no external wallet, no RPC rewriting.

```bash
sailor sandbox start    # start (or resume) the sandbox dashboard; prints the URL
sailor sandbox status   # ● running  http://localhost:<port>  (pid N)
sailor sandbox stop     # SIGTERM via the pid file
```

- Port: deterministic per project but seeded distinctly from the live UI (`<projectPath>:sandbox`), so the two dashboards never collide. Read `.shipyard/sandbox/runtime/ui.json` (`{ pid, port, startedAt }`) for the actual port — don't assume.
- **Health / mode check:** `curl -s http://localhost:<port>/api/mode` → `{"mode":"sandbox"}` (the live dashboard returns `{"mode":"live"}`). Use this to tell the two apart when both are up.
- The live and sandbox dashboards expose **Enter Shipyard / Exit** links to switch between them — the user need not remember two URLs.
- Its state (SMA, keys, mandate, activity) is entirely separate from `.sail/` — see `.shipyard/sandbox/{account,config,forks}.json`, `keys/`, `state/`. To inspect it from the CLI, prefix any read with `SAIL_DIR=.shipyard/sandbox` (e.g. `SAIL_DIR=.shipyard/sandbox sailor status`).

## Signing server — `sailor signer`

```bash
sailor signer start --json   # BLOCKS — run in the background
sailor signer status --json  # running / stopped, url, pid
sailor signer stop --json    # SIGTERM, verified against the recorded URL first
```

(`sailor station …` is a hidden, deprecated alias of `signer` kept for v1.2.0 compatibility — prefer `signer` in anything new.)

- Port: defaults to **3141**, bumped to the next free port if taken. The actual URL is in `.sail/runtime/server.json` (`{ url, wsUrl, port, pid, startedAt, requestSecret }`).
- Health/discovery endpoint: `GET http://localhost:<port>/config` returns `{ url, wsUrl, port, pid, pendingCount }` — `pendingCount` is the number of signing requests waiting for the owner. All other endpoints require a per-startup secret; do not poll them.
- `signer start` **blocks** (the listening socket keeps the process alive) — run it in the background. It is idempotent: if a reachable daemon exists it reports already-running and exits 0.
- The URL to give the user is the **dashboard**'s signing-page route printed by the command: `http://localhost:<ui-port>/#/signer`.

## How they relate

Signing-flow commands (`mandate deploy/register/deploy-clone/revoke`, `onboard`, `account deploy-chain`, `account rotate-signer`, `owner connect`) push requests to a running signing-server daemon if one exists, otherwise they spin up an ephemeral in-process signing server for the duration of the command. Starting a persistent signing server first means the owner connects their wallet once and approves a whole sequence of requests in the same browser tab — do this before any multi-step signing flow.

## Docker installation

If the container is not running, start it from the project root:

```bash
docker run -d --name agent -P -v "${PWD}:/workspace" sailmoney/sailor
```

- `-d` — detached, runs in the background
- `--name agent` — names the container; use a different name with `-e SAILOR_CONTAINER_NAME=<name>` if needed
- `-P` — publishes all exposed ports to random available host ports (UI: 3334, signer: 3141)
- `-v "${PWD}:/workspace"` — mounts the current project directory into the container

If `.sail/config.json → installMode` is `"docker"`, prefix every command with `docker exec <containerName>` (read `containerName` from the same config):

```bash
docker exec agent sailor ui start
docker exec agent sailor ui status
docker exec agent sailor ui stop

docker exec agent sailor signer start --json
docker exec agent sailor signer status --json
docker exec agent sailor signer stop --json
```

The UI always binds to port **3334 inside the container** (the image sets `ENV PORT=3334`), but the host-side port depends on how the container was started. Before giving the user a URL, resolve the actual host port:

```bash
docker port <containerName> 3334
# → 0.0.0.0:3334   (host port matches)
# → 0.0.0.0:8080   (host port is different — use 8080 in the URL)
```

Open `http://localhost:<host-port>` — the resolved port, never a hard-coded 3334.

Project files at `/workspace` are your local directory — read and write them directly from local paths; only `sailor` commands need the `docker exec` prefix.

## Troubleshooting

- Command stuck "waiting"? It is blocked on a browser signature — check `GET /config` `pendingCount`, and tell the user to open the signing-page URL and approve. Signing requests time out after 10 minutes.
- Stale pid file (process died): `ui status` / `signer stop` clean it up automatically.
- `sailor ui start` errors about a missing server bundle or UI dist: the package build is incomplete — re-run the sailor build.

---

This is an anytime utility, not a station — once the servers are sorted, return to the station you came from.
