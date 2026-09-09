<!-- Opened by `sailor harbor publish`. Reviewers: verify locally; the tarball is opaque in the diff. -->

## What is this?

<!-- name + summary from blueprints/<slug>/manifest.json -->

## Review checklist

- [ ] `blueprints/<slug>/manifest.json` and `<slug>.tar.gz` present; `sailor blueprint verify` passes
- [ ] `sailor blueprint import --dry-run` in a scratch project shows only the agent surface
      (skills, `AGENTS.md`, `soul.md`, `src/`, `contracts/`, `scripts/`, `dashboard/`)
- [ ] No secrets or operator identity: no keys, `.env*`, `.sail/` state, RPC keys, Telegram ids,
      or hard-coded account / agent-wallet addresses in scripts
- [ ] `package.json` has no `preinstall` / `postinstall` / `prepare` scripts
- [ ] Permission contracts have Foundry tests and every check fails closed
- [ ] The strategy and mandate the manifest describes match the code
- [ ] Slug is unique under `blueprints/`
