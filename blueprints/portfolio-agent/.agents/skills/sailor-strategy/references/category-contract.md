# The category contract

There are two kinds of category file, same contract for both.

- **Core recipes** — `references/trading.md`, `references/yield.md`, `references/payments.md`. Ship
  with Sailor in the `sailor-strategy` skill's `references/`, refreshed by `sailor update`.
- **Project recipes** — `.sail/recipes/<category>.md`. Specific to one project, persist across
  `sailor update` (the updater never touches `.sail/`).

A category file of either kind must contain exactly three things:

1. **2–3 archetypes**, each with pre-filled structural defaults for most dimensions.
2. **Extension dimensions** — the category-specific rows appended to the core completeness gate.
3. **Template routing** — which template skill (or bespoke authoring) each action maps to, with
   capability limits stated from the template's own schema.

## Copy-me skeleton

Paste into a new category file and fill the three required sections:

```markdown
# <Category> — archetypes, extension dimensions, routing

A routing aid consulted when the intent fits this category — not the boundary of what can be built.

## Archetypes
### <Archetype name> — <one-line description>
Defaults: <structural only — cadences, band widths, caps as a fraction of allocated capital, conservative LTV>. The user supplies: <the fields the user must name>.

## Extension dimensions (append to the core gate)
| Dimension | Concrete means |
|---|---|
| <name> | <what "concrete" means for it> |

## Routing (Station 3 reads this)
| Action | Route |
|---|---|
| <action> | <template skill, or "bespoke via sailor-mandates"> |
```

## Adding a category — two audiences

- **PROJECT (for the user):** drop a conforming `<name>.md` into `.sail/recipes/` per the contract
  above. It survives `sailor update`, needs no skill edit and no navigator door line, and is read
  automatically alongside the built-ins. This is the normal way to teach one project a new category.
- **SAILOR (a maintainer, shipping it to everyone):** add a built-in in the repo — one conforming
  `references/<name>.md` in the `sailor-strategy` skill + one door line in `sailor-navigator`'s
  "What can be built here" list + one routing row in `sailor-mandate-planner` — shipped to every
  project via `sailor update`.

`references/possibility-map.md` is not a category reference — it is the cross-category routing aid and
follows its own format.
