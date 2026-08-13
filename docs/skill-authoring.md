# Skill authoring standard

How Sailor skills are written, and why. This is the maintainer-facing contract for the 17
skills under `scaffold/.agents/skills/`. It exists so every skill is authored to the same bar
and stays that way as the set grows.

## The model: three tiers of disclosure

A coding agent reads every skill's `name` and `description` on every turn, then loads a full
SKILL.md body only when a task matches, then loads `references/` only when the body says so.
That is the whole performance budget:

| Tier | What loads | Target cost |
|---|---|---|
| Discovery | `name` + `description` for all 17 skills | ~80 tokens per skill, every turn |
| Activation | one SKILL.md body | under ~5,000 tokens |
| Execution | `references/`, `scripts/`, `assets/` | only when the body calls for them |

Every rule below protects that budget. A skill that puts detail in its description or its
top-level body taxes every future turn, whether the task uses it or not.

## Frontmatter

```yaml
---
name: sailor-risk
description: <one line>
station: anytime
---
```

- `name` — `sailor-` prefix, lowercase, hyphens. It equals the directory name. A skill's path
  is always `.agents/skills/<name>/SKILL.md`, so skills reference each other by **name**, never
  by path.
- `description` — one line, third person, present tense, stating **what** the skill does and
  **when** to use it, plus two to four concrete trigger phrases. Target roughly 120 to 280
  characters; hard stop at 300. No markdown, no em-dashes. This line is the discovery signal —
  if a user's phrasing would not match it, the skill will not be found.
- `station` — where the skill sits in the five-station flow, as the structured twin of the prose
  map in `sailor-navigator`. Exactly one value: `arrive`, `strategy`, `mandate`, `agent`, or
  `sail` for a station owner/support skill, or `anytime` for a utility that is not a station
  (the navigator itself, risk, project-info, servers, token-resolve, swap-quote). Never leave it
  off a new skill.

Good:

```yaml
description: Assess and disclose the technical risks of a strategy or action (pool depth, manipulation, approval hygiene, oracle trust, venue, MEV) before the user approves it. Use when creating or changing a strategy, mandate, or position, and when asked whether something is safe.
```

Bad (what this standard replaces):

```yaml
description: Station 2 AND the single skill for creating or configuring a strategy — turn the user's intent into a complete, concrete strategy spec … (1,142 characters, em-dash, prose)
```

## Body structure

Canonical sections, in order. Not every skill needs all of them; a utility drops Precondition,
an assessment drops Steps for its own procedure. But when a section appears it appears under
this name and in this order.

| Section | Purpose | Rule |
|---|---|---|
| `# <name> — <one-line purpose>` | the H1 | one line, matches the description's job |
| `## What this owns` | scope, and what it explicitly does NOT own | point to the owner (e.g. `soul.md` owns voice) |
| `## When to use` | triggers, and when NOT to use | delegate the "not" case to another skill by name |
| `## Precondition` | fail-closed gate | if it fails, name where to go and return when passed |
| `## Steps` / `## Run it` | numbered procedure, exact commands | commands copy-pasteable, never paraphrased |
| `## Verify` | exit verifier | concrete, checkable, "how do I know it worked" |
| `## Handoff` | the next skill, by name | one skill, never a menu |
| `## Pitfalls` | failure modes and gotchas | each is a real mistake, not a restatement of Steps |

Detail that would push the body past ~5,000 tokens moves to `references/<topic>.md` and the body
links it. A `references/` file is loaded only when the body says to load it.

## Cross-referencing

Reference other skills by **bare name** in backticks: `` `sailor-strategy` ``. Never by path
(`../sailor-strategy/SKILL.md`) — paths break when the layout changes, and the flat layout makes
name the stable identifier. The registry in `.agents/skill-registry.json` is the single source
of truth for the name list and the core vs custom classification.

## The registry

`.agents/skill-registry.json` classifies every skill as `core` or `custom`:

- **core** — what makes it a Sailor agent (identical across every agent). Ships in the npm
  package, protected from blueprint pruning, updated by `sailor update`.
- **custom** — what makes it *this* agent (strategy-specific). Selectable per blueprint, and
  refreshed with the blueprint when a new version of that blueprint ships.

When you add a skill, you add it to the registry in the same change. The CLI's blueprint import
reads the registry and refuses to prune a core skill, whatever a manifest asks for.

## Rollout — completed

The set was authored before this standard and migrated in order of discovery cost. Every phase is
verified with `pnpm build` and `pnpm test`.

1. **`sailor-risk`** — written to the standard from the start (the reference example).
2. **Descriptions only** — all 17 `description` lines rewritten to one line (193 to 275 chars).
3. **Cross-reference migration** — 206 references converted from `../sailor-X/SKILL.md` paths to
   bare names; only `references/*.md` file links keep paths.
4. **Template-spoke merge** — the seven `sailor-template-*` skills became references under
   `sailor-templates` (`references/swap.md`, `swap-no-oracle.md`, `transfer.md`, `withdraw.md`,
   `deposit.md`, `borrow.md`, `approve-batch.md`), taking the set from 24 skills to 17.
5. **Section normalization** — the largest bodies restructured to the canonical sections with
   overflow moved to `references/`: `sailor-strategy` (28 → 12 KB), `sailor-agent-build` (28 → 8 KB,
   its ~18 KB code skeleton moved to `references/canonical-skeleton.md`), `sailor-onboarding`
   (16 → 7 KB, the welcome script moved to `references/welcome-script.md`), `sailor-navigator`
   (10 → 7 KB). Gate-structured skills (`sailor-mandates`, `sailor-mandate-planner`) gained the
   canonical `When to use` framing without touching their gates.
