<!--
Thanks for contributing to Sailor! Please complete the checklist below.
Security vulnerabilities must NOT be filed as a PR — report privately per SECURITY.md.
-->

## Description

<!-- What does this change do, and why? Keep it to one logical unit. -->

## Checklist

- [ ] Description of the change and why (one logical unit).
- [ ] Tests added/updated and passing (`pnpm --filter @sail/sdk test`, `pnpm --filter sailor test`, `pnpm test`).
- [ ] Build and typecheck pass (`pnpm build`, `pnpm typecheck`).
- [ ] Check suite passes (`pnpm run docs:check`, `pnpm run init:check`, `pnpm run update:check`).
- [ ] Docs updated if behavior or the command surface changed.
- [ ] No "audit"-as-assurance wording introduced (the codebase uses "security review").
- [ ] No attribution footer in commits (no `Co-Authored-By`, no tool signatures).
- [ ] For scaffold-template or signing-path changes: discussed in an issue first.
- [ ] This is **not** a security vulnerability (those go privately via [SECURITY.md](../SECURITY.md), not a PR).
