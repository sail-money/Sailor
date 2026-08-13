---
name: sailor-extend
description: Add notifications (Telegram, email) and a strategy-specific dashboard to a live agent. Use once the agent is live to offer alerts, monitoring, or a custom view, and when the user asks for notifications or a dashboard.
station: sail
---

# sailor-extend — notifications and custom dashboards

These are user-land code the assistant writes into this project — not Sailor features. (For operating the running agent itself — reading activity, tuning, pausing, revoking, exiting — see `sailor-operate`; this skill is the optional notifications/dashboard layer on top.)

## Notifications

Two hook points, pick per the user's setup:

1. **Inside the agent loop** (`src/agent.ts`) — fires on every tick, works locally and in CI. Send from within `tick()` after a meaningful event, or read `.sail/activity.jsonl` and alert on `dispatch_reverted` / `dispatch_denied` / `error` entries.
2. **As a GitHub Actions step** (`.github/workflows/agent-tick.yml`) — fires once per scheduled run; simplest for run-level success/failure alerts.

### Telegram (Bot API)

One-time setup: create a bot with @BotFather (get `TELEGRAM_BOT_TOKEN`), have the user message the bot once, read their chat id from `https://api.telegram.org/bot<token>/getUpdates`. Store both as secrets/env — never hardcode.

The exact curl shape:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  --data-urlencode text="sailor: tick complete — 2 executed, 0 reverted"
```

As a CI step appended to `agent-tick.yml` (add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as repo secrets):

```yaml
      - name: Notify Telegram
        if: always()
        env:
          TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          CHAT: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          curl -s "https://api.telegram.org/bot${TOKEN}/sendMessage" \
            -d chat_id="${CHAT}" \
            --data-urlencode text="agent-tick: ${{ job.status }} — $(date -u +%FT%TZ)"
```

From `src/agent.ts`, the same call via `fetch()` inside `tick()` — gate it so a notification failure never throws into the tick (wrap in try/catch; a lost alert must not stop a dispatch).

### Email (CI step)

Simplest reliable path is a provider action in the workflow, e.g. `dawidd6/action-send-mail` with SMTP credentials in secrets:

```yaml
      - name: Email on failure
        if: failure()
        uses: dawidd6/action-send-mail@v3
        with:
          server_address: smtp.example.com
          server_port: 465
          username: ${{ secrets.MAIL_USERNAME }}
          password: ${{ secrets.MAIL_PASSWORD }}
          subject: "Sail agent tick failed"
          to: user@example.com
          from: sailor-agent
          body: "Run ${{ github.run_id }} failed. Check gh run view --log."
```

For local runs, email is rarely worth a daemon — prefer Telegram, or pipe `.sail/activity.jsonl` into whatever the user already monitors.

## Custom dashboard

The stock dashboard (`sailor ui start`) shows account state, mandate health, balances, and activity. A strategy-specific view (price chart + portfolio for a trading agent; health factor + yield for a lending agent) is a small app the assistant builds reading:

- `.sail/activity.jsonl` — every dispatch with txHash, gas, denial reasons, owner signing events; append-only JSON lines, trivially tailable.
- `.sail/account.json` / `.sail/state/mandates.json` — the SMA address and the permission set to display.
- On-chain state via the SDK: `import { SailorClient } from '@sail.money/sailor/sdk'` for kernel/mandate reads, or any viem `PublicClient` for balances and protocol positions.

Keep it local and read-only: a small server (or static page polling a tiny endpoint) that reads `.sail/` and the chain. Do not put keys, passphrases, or write operations in a dashboard. Pick a port outside 3333–3999 (reserved by per-project Sailor UIs) and 3141 (signing server).
