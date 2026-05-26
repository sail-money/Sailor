---
name: sailor-scaffold
description: Monorepo scaffold state — packages, configs, typecheck approach for the sailor repo
metadata:
  type: project
---

Sailor is a pnpm monorepo at /Users/aadopico/sail-work/sailor. It is the operator-facing toolkit for Sail Protocol SMAs.

Packages:
- packages/sdk — @sail/sdk, TypeScript strict, viem peer dep, SailorClient with method stubs, LocalKeyring stub, 7 permission template stubs
- packages/cli — sailor CLI (commander), sailor init [name] is fully implemented (copies dca-rebalancer template), other commands stub to "not implemented yet"
- packages/chains — @sail/chains, empty chains registry, getChain() helper
- packages/create-app — create-sailor-agent binary, spawnSync wrapper around sailor init

Template:
- templates/dca-rebalancer — DCA rebalancer agent starter with src/agent.ts, src/mandate.ts, src/config.ts, sail/WIZARD.md (7 stages), CLAUDE.md + AGENTS.md + .cursor/rules (all identical single-line pointers to WIZARD.md), .github/workflows/agent-tick.yml

**Why:** typecheck requires building @sail/sdk first (tsc -p tsconfig.json emits dist/). All dependent packages resolve @sail/sdk from the built dist. Root typecheck script builds SDK first.

**How to apply:** When making changes to SDK types, remind user to run `pnpm --filter @sail/sdk build` before typechecking dependents. The root `typecheck` script handles this automatically.

Technical notes:
- pnpm 11.3.0, blockExoticSubdeps must be disabled (ox dep in viem): use --config.blockExoticSubdeps=false
- pnpm-workspace.yaml has allowBuilds: '@biomejs/biome': true
- .npmrc has block-exotic-subdeps=false (but pnpm 11 may require the CLI flag too)
- SDK tsconfig has composite: true (for future project references)
- @types/node in cli and create-app devDeps (needed for node: imports and process)
- @types/node in dca-rebalancer template devDeps (needed for process.env)
