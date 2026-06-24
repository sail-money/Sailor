# Genesis Feedback — Design Proposals (F9–F13)

These items from the genesis tester feedback are **design / product**, not
direct bug fixes. They are captured here as concrete, implementable proposals so
they can be scoped and built in follow-ups. The code findings (F1, F3, F4, F5,
F6, F7, F8) ship as their own branches/PRs.

Status legend: 🟡 nice-to-have · 🟢 recommended next · ⚪ larger effort.

---

## F9 — Optional Tailscale HTTPS exposure for the station 🟡

**Depends on:** F8 (configurable CORS origins) — already shipped.

**Today:** the station/dashboard binds `127.0.0.1` only. F8 lets an operator add
allowed CORS origins, but they still have to wire the HTTPS reverse proxy
themselves.

**Proposal:** an opt-in `sailor ui start --expose tailscale` (or
`SAILOR_EXPOSE=tailscale`). When set and the `tailscale` CLI is present:

1. Resolve the tailnet hostname via `tailscale status --json` (`Self.DNSName`).
2. Run `tailscale serve https / http://127.0.0.1:<port>` as a child process,
   tearing it down on `sailor ui stop` / process exit.
3. Auto-append `https://<dnsname>` to `CORS_ORIGINS` (reuses the F8 plumbing).
4. Print the HTTPS URL; refuse with an actionable error if `tailscale` is not
   installed or not logged in.

**Guardrails:** default stays local-only — this never runs unless explicitly
requested. Use `tailscale serve` (tailnet-private), **not** `funnel` (public);
gate `funnel` behind a separate, louder `--expose tailscale-public` flag with a
confirmation, since it puts a signing surface on the public internet.

**Effort:** small–medium (one child-process manager + status parsing). The CORS
half is already done.

---

## F10 — Human-readable mandate preview before signing 🟢

**Today:** when an LLM authored the setup, the user signs the mandate without a
clear, plain-language view of what they are authorizing.

**Proposal:** a pre-signature review screen (and CLI equivalent) that renders the
mandate from the same data the signature commits to — never a separate
description that could drift:

- **Per permission:** template name + plain-language recital ("Swap WETH→USDC on
  Uniswap, ≤ $500/tx, ≥ 98% oracle price"), the exact allowed `(target,
  selector)` pairs, and bounds (caps, slippage, recipient pins).
- **Mandate-level:** SMA address, chain, manager (agent) wallet, fee policy +
  protocol-cut cap, expiry/session terms.
- **Diff mode** for re-signs: show what changed vs the currently-active mandate.
- Derive the recital from the on-chain `IPermissionIntrospection` metadata + the
  decoded config blob, so the preview is a faithful projection of the bytes
  being signed. The existing `MandatePage` recital is the visual starting point.
- CLI parity: `sailor mandate sign --preview` prints the same summary and
  requires confirmation; `--json` emits it for agent review.

**Effort:** medium (mostly a renderer over data we already have).

---

## F11 — Visual view of an active mandate 🟢

**Today:** after issuing, it's hard to tell what the agent can and cannot do.

**Proposal:** an "what this agent may do" panel on `MandatePage`/`AgentPage`:

- A capabilities grid: ✓ allowed actions (with bounds) and, equally prominent,
  ✗ everything outside the mandate ("cannot withdraw to external addresses",
  "cannot trade non-allowlisted tokens"). The deny side is what builds trust.
- Per-permission bound chips (caps, slippage band, allowlists) rendered from the
  decoded config — reuse the F10 recital builder.
- Live status: session active/paused, expiry countdown, remaining per-period
  budget if the policy exposes it.

**Effort:** medium. Shares the F10 recital/decoder; this is its persistent view.

---

## F12 — Visual of agent activity (working vs idle) ⚪

**Today:** unclear when the agent is working vs idle; no at-a-glance proof it's
acting within bounds.

**Proposal:** an activity surface on the dashboard:

- **Heartbeat/status strip:** last tick time, next scheduled tick, current state
  (idle / evaluating / dispatching / paused), sourced from `/api/agent-status`
  + `activity.jsonl`.
- **Timeline / sparkline:** buys/sells or portfolio value over time from the
  positions snapshots + activity log, each point linking to its Decision Journal
  entry (now chain-aware after F5).
- **Within-bounds affordance:** mark each action ✓ allowed-by-mandate, and
  surface any mandate-denied attempts (already logged) so "the agent tried X and
  the mandate stopped it" is visible — reinforces the guardrails.

**Effort:** larger (new data viz; some data, e.g. periodic NAV, may need a
lightweight server-side sampler). Sequence after F10/F11.

---

## F13 — Lower the DeFi-knowledge barrier in onboarding ⚪

**Today:** onboarding feels DeFi-heavy and intimidating, even acknowledging the
target user is a DeFi + coding-agent user.

**Proposal (incremental, not a rewrite):**

- **Progressive disclosure:** lead each onboarding step with the plain-language
  intent; tuck addresses/selectors/chain-ids behind a "Details" expander.
- **Glossary on hover:** inline definitions for SMA, mandate, permission signer,
  manager/agent wallet, slippage — terms the wizard already uses.
- **Guided default path:** a recommended testnet (Base Sepolia) + a starter
  mandate template, so a new user reaches a working agent with minimal choices,
  then graduates to custom config.
- **"Explain this to me" hand-off:** the existing AI hand-off modal, but seeded
  with the user's current step so the LLM can narrate it.

**Effort:** larger / ongoing UX track; ship as incremental polish rather than a
single PR.

---

## Suggested sequencing

1. **F10** (mandate preview) — unblocks trust and is mostly a renderer over
   existing data.
2. **F11** (active-mandate view) — reuses F10's decoder.
3. **F9** (Tailscale opt-in) — small, self-contained, F8 already landed.
4. **F12**, **F13** — larger tracks; schedule after the above.
