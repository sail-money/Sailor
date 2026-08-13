---
name: sailor-risk
description: Assess and disclose the technical risks of a strategy or action (pool depth, manipulation, approval hygiene, oracle trust, venue, MEV) before the user approves it. Use when creating or changing a strategy, mandate, or position, and when asked whether something is safe.
---

# sailor-risk — assess and disclose technical risk before approval

## What this owns

`sailor-risk` owns the technical risk assessment of a strategy or action, and the honest
disclosure of what that risk means for the user's money. It is called by other skills at the
moment a decision is being made (`sailor-strategy` Act 3, `sailor-mandate-planner`,
`sailor-operate`), not a separate station.

It does **not** own:

- **Voice or tone** — that is `soul.md`'s sole job. Report the facts plainly; let `soul.md`
  decide how to say them.
- **Investment advice** — never recommend what to invest in, never predict returns, never rank
  assets or venues. Risk is described; the choice is the user's.
- **The decision** — this skill reports, the user decides. Never make the call for them.

## When to use

- Before the user approves any strategy (in `sailor-strategy` Act 3) or mandate
  (`sailor-mandate-planner`).
- When a strategy, mandate, or position changes in a way that widens exposure.
- When the user asks "is this safe?", "what could go wrong?", or "how much can I lose?".
- When `sailor-operate` detects something unexpected and needs to explain it.

Do **not** use it to: recommend an asset, predict performance, justify a wider mandate, or
soften a real risk to keep the user comfortable.

## The assessment — six dimensions

For each position-opening action in the strategy spec, assess these six. The full methodology,
what each one checks, and what "risky" looks like live in
`references/risk-dimensions.md`. The short version:

1. **Liquidity (pool depth).** Is the pool deep enough that the position can enter and exit
   without moving the price? A thin pool means the user's own trade costs them slippage and can
   be moved by others.
2. **Price manipulation.** Can a small number of actors move the price this position depends
   on? Check the pool's concentration and whether the venue has a manipulable oracle.
3. **Approval hygiene.** What approvals does this action grant, to whom, and can they be
   revoked? An overbroad or non-revocable approval is exposure that outlives the strategy.
4. **Oracle trust.** Where does the price come from, and can it be manipulated or go stale? A
   spot oracle or a single source is weaker than a time-weighted or multi-source one.
5. **Venue risk.** Is the protocol itself sound — admin controls, upgrade keys, fork drift,
   migration risk? A venue can be honest and still be fragile.
6. **MEV and slippage.** What can a bot extract from the trade, and what is the worst-case price
   between intent and execution?

Assess each against the action's own caps and risk bounds from the spec. A risk is only worth
stating when it can cross a bound the user actually set — otherwise it is noise.

Cross-cutting, beyond per-action: **concentration** (how much of the SMA sits in one token, one
venue, or one chain) and **exit path** (can the position actually be unwound when the user wants
out — `sailor-strategy` records this as `exitPath`).

## Disclose, don't decide

For every risk that can cross a bound the user set, state:

- what the risk is, in the user's own financial terms (not jargon),
- the concrete consequence ("if this pool thins, your exit could cost you more than expected"),
- what would have to happen for it to bite.

Never soften to keep the user comfortable, never exaggerate to scare them. If a risk sits
outside what the mandate permits, see `sailor-operate`'s denial ladder — never route around the
kernel to "fix" it.

## Verify

Before the user approves, both are true:

- Every position-opening action has a written risk note in the spec or mandate, with the
  consequence stated.
- The user can restate, in their own words, what they are risking and roughly how much.

If the user cannot restate the risk, it has not actually been disclosed.

## Handoff

After the assessment, return to the skill that called it (`sailor-strategy`,
`sailor-mandate-planner`, or `sailor-operate`). This skill never owns the next step — it informs
it.

## Pitfalls

- **Risk of the action, not the brand.** A reputable token in a thin or manipulated pool is
  still risky. Assess the action, not the name.
- **Past behavior is not a guarantee.** A pool that was deep last week can be thin today;
  re-read live data, do not recall it.
- **Fail-closed is not no-risk.** The kernel stops what the mandate forbids, but it cannot stop
  a bad price or a drained pool inside the bounds. Do not imply the mandate removes risk — it
  only bounds it.
- **Never let disclosure become a recommendation.** "This is risky" is a fact; "so you should
  not do it" is advice. Stop at the fact.
