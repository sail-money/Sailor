---
name: sail-servers
description: Start, stop, and health-check the two local servers — the Sailor dashboard and the signing station. Use when launching the UI, when a signing request needs a browser, when a port or pid question comes up, or when a command appears stuck waiting for a signature.
---

# Sail servers

Two distinct local servers. Both are per-project, both write state under `.sail/runtime/`, and both start idempotently (starting twice reports "already running" and exits 0).

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

## Signing station — `sailor station`

```bash
sailor station start --json   # BLOCKS — run in the background
sailor station status --json  # running / stopped, url, pid
sailor station stop --json    # SIGTERM, verified against the recorded URL first
```

- Port: defaults to **3141**, bumped to the next free port if taken. The actual URL is in `.sail/runtime/server.json` (`{ url, wsUrl, port, pid, startedAt, requestSecret }`).
- Health/discovery endpoint: `GET http://localhost:<port>/config` returns `{ url, wsUrl, port, pid, pendingCount }` — `pendingCount` is the number of signing requests waiting for the owner. All other endpoints require a per-startup secret; do not poll them.
- `station start` **blocks** (the listening socket keeps the process alive) — run it in the background. It is idempotent: if a reachable daemon exists it reports already-running and exits 0.
- The URL to give the user is the **dashboard** station route printed by the command: `http://localhost:<ui-port>/#/station`.

## How they relate

Signing-flow commands (`mandate deploy/attach/deploy-clone/revoke`, `onboard`, `account deploy-chain`, `account rotate-signer`, `owner connect`) push requests to a running station daemon if one exists, otherwise they spin up an ephemeral in-process signing server for the duration of the command. Starting a persistent station first means the owner connects their wallet once and approves a whole sequence of requests in the same browser tab — do this before any multi-step signing flow.

## Docker installation

If `.sail/config.json → installMode` is `"docker"`, prefix every command with `docker exec <containerName>` (read `containerName` from the same config):

```bash
docker exec agent sailor ui start
docker exec agent sailor ui status
docker exec agent sailor ui stop

docker exec agent sailor station start --json
docker exec agent sailor station status --json
docker exec agent sailor station stop --json
```

The UI always binds to port **3334 inside the container** (the image sets `ENV PORT=3334`), but the host-side port depends on how the container was started. Before giving the user a URL, resolve the actual host port:

```bash
docker port <containerName> 3334
# → 0.0.0.0:3334   (host port matches)
# → 0.0.0.0:8080   (host port is different — use 8080 in the URL)
```

The URL to open in the browser is `http://localhost:<host-port>` where `<host-port>` is what `docker port` returned, not necessarily 3334. Never hard-code the port — always resolve it first.

Project files at `/workspace` are your local directory — read and write them directly from local paths; only `sailor` commands need the `docker exec` prefix.

## Troubleshooting

- Command stuck "waiting"? It is blocked on a browser signature — check `GET /config` `pendingCount`, and tell the user to open the station URL and approve. Signing requests time out after 10 minutes.
- Stale pid file (process died): `ui status` / `station stop` clean it up automatically.
- `sailor ui start` errors about a missing server bundle or UI dist: the package build is incomplete — re-run the sailor build.
