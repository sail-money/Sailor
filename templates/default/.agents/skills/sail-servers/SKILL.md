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
```

- Port: deterministic per project — `3333 + (hash(projectPath) % 667)`, i.e. somewhere in 3333–3999, bumped to the next free port if taken. **Do not assume 3333** — always use the URL the command prints or read `.sail/runtime/ui.json` (`{ pid, port, startedAt }`).
- The server serves the pre-built React app (`SERVE_DIST=1`) and a local `/api` that reads `.sail/` state (`SAIL_DIR` env).
- `ui start` does not block — no `&` needed.

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

## Troubleshooting

- Command stuck "waiting"? It is blocked on a browser signature — check `GET /config` `pendingCount`, and tell the user to open the station URL and approve. Signing requests time out after 10 minutes.
- Stale pid file (process died): `ui status` / `station stop` clean it up automatically.
- `sailor ui start` errors about a missing server bundle or UI dist: the package build is incomplete — re-run the sailor build.
