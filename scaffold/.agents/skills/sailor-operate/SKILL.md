---
name: sailor-operate
description: "Station 5 — operate a live agent. Answers the operator's running-agent questions: \"what did my agent do\", \"is my agent working\", \"why was it denied\", \"pause my agent\", \"stop the agent\", \"change the caps\", \"widen the mandate\", \"narrow the mandate\", \"withdraw my funds\", \"get my money out\", \"shut it all down\", \"my agent seems stuck\". Reading .sail/activity.jsonl, tuning bounds, pausing, revoking, and exiting to the owner."
---

# sailor-operate — monitor, tune, revoke, exit (Station 5)

The agent is live; this skill answers the operator's questions about it. Station 5 has two halves: [`sailor-automation`](../sailor-automation/SKILL.md) launches the agent unattended, and this skill operates it thereafter. Operating is the steady state — there is no "next" station.

**Gate:** a launched agent, or at minimum a registered mandate. Read-only state questions can also be answered by [`sailor-project-info`](../sailor-project-info/SKILL.md); this skill adds the operating actions (tune, pause, revoke, exit).

## "What is my agent doing?"

Every tick appends to `.sail/activity.jsonl` — append-only JSON, one event per line, trivially tailable. Event types the runner writes:

| Event | Fields | Means |
|---|---|---|
| `tick_start` / `tick_end` | `reason`, `chainId` | a run cycle began / finished |
| `log` | `msg` | a line your `ctx.log()` emitted |
| `dispatch_approved` | `permission`, `target` | a permission accepted the call (about to submit) |
| `dispatch_executed` | `permission`, `target`, `txHash` | on-chain success |
| `dispatch_reverted` | `permission`, `target`, `txHash`, `gasUsed` | submitted but reverted on-chain |
| `dispatch_denied` | `target`, `reason` | no permission authorized it (`reason`: `no calls`, `no_registered_permissions`, `no_permission_match` — the most common: no registered permission's `evaluate()` accepted the call — or the permission's own reason, falling back to `denied`) |
| `error` | `reason`, `chainId` | the tick threw |

Practical reads (plain shell):

```bash
tail -f .sail/activity.jsonl                                  # live feed
grep '"type":"dispatch_denied"' .sail/activity.jsonl | tail   # recent denials
grep '"type":"dispatch_executed"' .sail/activity.jsonl | tail # recent successes + txHash
```

Visual path: `sailor ui start` → the dashboard shows account state, mandate health, balances, and the same activity feed. `sailor status` gives a one-screen account / permission / session summary.

## "Why was a dispatch denied?"

A denial is information, not a failure (AGENTS.md invariant 3). Find the `dispatch_denied` event, read its `reason`, and map it to one of three causes:

1. **The call was outside the permission's bounds** → the system worked as designed. If the strategy legitimately needs that call, the bounds are too tight — go to "Change the bounds" (with the user).
2. **The permission is misconfigured** (registered but not configured, wrong allowlist/cap) → retune it (below). `no_registered_permissions` means nothing is registered for that action yet — back to [`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md).
3. **The agent built the wrong dispatch** (wrong selector/target/recipient) → fix the tick loop ([`sailor-agent-build`](../sailor-agent-build/SKILL.md)).

Never route around the kernel. A denial is corrected by fixing the bounds or the code, never by bypassing the check — and never by asking for or accepting a private key as a shortcut (AGENTS.md invariant 6). If none of the three causes above resolves it, that's an honest failure to report to the user, not a reason to reach for credentials.

## "Change the bounds" (tune)

Retune a shared template in place with `configure --force` — re-encode the blob with the new cap/allowlist and re-run; the address stays registered, no re-register:

```bash
sailor mandate configure --address <SINGLETON> --sma <SMA> --params <0x-new-blob> --force
```
(`--template <Name> --args-file ./new-config.json` only works for `SwapPermission` today — every
other shared template needs the blob pre-built and passed via `--params`; see
[`sailor-templates` reuse-flow](../sailor-templates/references/reuse-flow.md).)

Follow the template's own steps ([`sailor-templates`](../sailor-templates/SKILL.md) reuse flow + the matching `sailor-template-*` spoke). (`sailor mandate update` changes only tracked *metadata* — name/source/artifact paths — not bounds.)

**Widening requires the user's explicit, informed approval** (AGENTS.md invariant 2): before any signature, state plainly what the change lets the agent newly do. Narrowing is safe to propose freely, but still confirm.

## "Pause / resume"

```bash
sailor session pause     # on-chain: revokes the manager's dispatch rights (one tx)
sailor session resume    # on-chain: restores them
```

`session pause` submits an on-chain `revokeSession` — the kernel advances the manager's session nonce by a full epoch, so every already-signed, in-flight dispatch becomes invalid immediately; the agent can execute nothing until `resume`. It does **not** touch custody (the owner's Safe is untouched) and does **not** stop the local `sailor run` process — a running loop keeps ticking but every dispatch is denied on-chain until you resume. To stop a daemonized runner too: `sailor service stop` (and `sailor service status` / `sailor service logs -f` to inspect it).

## "Revoke" — the escalation ladder

Each rung is broader; all are owner-authorized and take effect in one block:

```bash
sailor mandate revoke --address <P> --sma <SMA>   # remove ONE permission (narrow the mandate)
sailor mandate revoke --all --sma <SMA>           # remove EVERY registered permission
sailor session pause                              # kill switch: end the manager's dispatch authority entirely
```

Beyond the protocol, the **Safe is the owner's ultimate control** — the owner can act directly on the account at any time (next section), independent of any permission or session state.

## "Exit — get my money out"

Two paths; use both understanding which is sovereign:

- **(a) Safe app — the sovereign exit.** The SMA is a Safe the owner controls directly. `sailor ui start` → the dashboard's **Open in Safe** link goes to `app.safe.global` for this account, chain-aware (it maps the account's chain to the right Safe prefix). From there the owner moves funds with their own wallet signature. This works **regardless of agent, mandate, or session state** — it is the guaranteed way out and needs no permission.
- **(b) Agent-mediated withdraw — within bounds.** If a `WithdrawPermission` is registered ([`sailor-template-withdraw`](../sailor-template-withdraw/SKILL.md)), the agent (or a one-off `sailor run --once`) can consolidate funds to the owner's fixed recipient within the mandate's cap. Convenient for routine sweeps; bounded by the permission.

Use (b) for routine consolidation while running; use (a) whenever you want certainty, or the agent is paused/misbehaving/unresponsive.

**Full shutdown recipe** (order matters):

1. `sailor session pause` — freeze the manager first, so nothing moves while you exit.
2. Withdraw the funds — Safe app (a) for certainty, or a withdraw dispatch (b) if that permission exists.
3. `sailor mandate revoke --all --sma <SMA>` — remove the permissions so the account is inert.

Pausing before withdrawing prevents the agent from acting mid-exit; revoking last leaves the mandate intact until the funds are safely out.

## "Rotate the manager key"

For key hygiene or a suspected agent-wallet compromise:

```bash
sailor account rotate-signer --generate          # new local agent wallet, or --to <address> for an existing one
```

Rotation **clears every attached mandate on-chain (fail-closed)** and re-approves them for the new signer in one batched `RegisterPermissions` signature, so they rebind to the new wallet. If the run is interrupted after rotation, `--reattach-only` resumes the re-approval (fund the new wallet first). Until re-approval completes, the new signer has no mandates — the agent is safely inert, not partially authorized.

## Where to go from here

Operating is the steady state — no next station. For run/transaction notifications or a strategy-specific dashboard, see [`sailor-extend`](../sailor-extend/SKILL.md); to change how the agent is scheduled/hosted, [`sailor-automation`](../sailor-automation/SKILL.md).
