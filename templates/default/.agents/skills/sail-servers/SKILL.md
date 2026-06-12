---
name: sail-servers
description: Start, stop, and health-check the two local Sailor servers — the dashboard UI on localhost:3333 and the signing-station daemon on localhost:3141. Use when launching the browser UI, when a command appears to hang waiting for a signature, or when verifying servers before a signing flow.
---

# Sailor servers

Two independent local servers.

## Dashboard (localhost:3333)

The onboarding wizard and monitoring UI. The owner connects their wallet here; SMA deployment and mandate signing happen in this browser context.

```bash
sailor ui start    # detached; prints the URL
sailor ui status
sailor ui stop
```

Environment: `SAIL_DIR` points the server at the project's `.sail/` directory; `SERVE_DIST=1` serves the built React app at `/`. CORS is restricted to `http://localhost:3333`.

## Signing station (localhost:3141)

A daemon that bridges CLI signing requests to the browser. Commands needing an owner signature queue a request here and block until the owner approves; if no daemon is running, the command starts its own channel for its duration. An explicit daemon is for long sessions, when several signing steps will happen back to back:

```bash
sailor station start    # blocks — run it in the background
sailor station status
sailor station stop
```

Starting is idempotent — an already-running daemon is reused.

## Health checks

```bash
sailor ui status
sailor station status --json
curl -s http://localhost:3141/config     # { url, wsUrl, port, pid, pendingCount }
curl -s http://localhost:3141/pending    # queued signing requests
```

## Troubleshooting

- A CLI command "hangs": it is almost always blocked on a pending signing request. Check `/pending` (or `pendingCount` in `/config`) and tell the user exactly what to approve in the browser and with which wallet. Do not kill and retry — that re-queues the same request.
- Port already in use: find the existing instance with `sailor ui status` or `sailor station status` and stop it with the matching stop command rather than killing the process.
- The dashboard shows stale or empty state: confirm the server was started from this project directory (or that `SAIL_DIR` points at this project's `.sail/`).
