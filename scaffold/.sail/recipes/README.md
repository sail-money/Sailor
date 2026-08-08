# `.sail/recipes/` — project strategy recipes

This folder holds **project recipes** — strategy categories specific to *this* project. The **three core
recipes** ship with Sailor as the built-ins in the [`sailor-strategy`](../../.agents/skills/sailor-strategy/SKILL.md)
skill's `references/` (`trading.md`, `yield.md`, `payments.md`) and are refreshed by `sailor update`; the
recipes here are yours and persist across updates.

Drop a `<category>.md` file in this folder to teach **this project** a new strategy category. When
building a strategy, the `sailor-strategy` skill reads every `*.md` here **alongside** the three core
recipes and consults a matching project recipe exactly like a core one — its archetypes pre-fill
structural defaults and its routing rows are what Station 3 follows for that category.

These files are **yours**: they **survive `sailor update`** (the updater refreshes the framework skills
and their built-in `references/`, but never touches `.sail/`), so a project category you add stays put.
No skill edit is needed, and **no navigator "door" line is required** — the skill discovers recipes by
reading this folder, not from a hard-coded list.

## The category-file contract

Each recipe must contain exactly three parts (identical to the built-in category contract — the
copy-me skeleton lives in the `sailor-strategy` skill's "The category contract" section):

1. **Archetypes** — 2–3 named shapes, each with pre-filled **structural** defaults (cadences, band
   widths, caps as a fraction of allocated capital, conservative LTV). Never an invented venue or token
   address, never an asset recommendation.
2. **Extension dimensions** — the category-specific rows appended to the core completeness gate.
3. **Template routing** — which live template skill (or bespoke authoring) each action of the category
   maps to, with capability limits stated from the template's own schema.

A file that doesn't conform to these three parts is ignored as a category source. There is no
`TEMPLATE.md` to copy — start from the skeleton in the skill and save your file as `<category>.md`.
