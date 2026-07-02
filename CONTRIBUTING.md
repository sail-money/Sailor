# Contributing to Sailor

Sailor is the open-source operator toolkit (TypeScript SDK, CLI, and local dashboard) for
[Sail Protocol](https://github.com/sail-money/protocol) — the tooling an operator uses to create
a Separately Managed Account, register a mandate, and run a strategy agent against it. See the
[README](./README.md) for an introduction and [docs/](./docs/) for usage guides.

Sailor will be continuously enhanced through community participation and feedback —
**contributions, issue reports, and design discussions are actively welcomed.** If something is
unclear, broken, or missing, an issue is a contribution.

**License.** Sailor is [MIT](./LICENSE) (© Agentic Finance Inc.). By contributing you agree your
contributions are licensed under the same terms.

---

## ⚠️ Security issues do not go here

**Never file a security vulnerability as a public issue or pull request.** Report it privately
per the [Security Policy](./SECURITY.md) — email **hello@sail.money**. Smart-contract
vulnerabilities belong with the protocol's
[Security Policy](https://github.com/sail-money/protocol/blob/main/SECURITY.md) instead.

---

## Building & testing

Sailor is a [pnpm](https://pnpm.io) workspace targeting Node.js **>= 18**.

```bash
pnpm install            # install workspace dependencies
pnpm build              # build SDK, CLI bundle, and UI
pnpm typecheck          # TypeScript across all packages
pnpm --filter @sail/sdk test    # SDK test suite
pnpm --filter sailor test       # CLI test suite
pnpm test               # UI test suite (sailor-ui)
```

Repo-level quality gates (CI runs all of these — run them locally before opening a PR):

```bash
pnpm run docs:check     # every sailor command / client.* method named in docs must exist
pnpm run init:check     # sailor init smoke test against the local CLI bundle
pnpm run update:check   # sailor update re-sync behavior
```

A PR must pass the build, the three package test suites, and the check suite above.

---

## How to contribute

Contributions are welcome via **issues** and **pull requests**. The most welcome contributions:

- **Bug fixes** — with a test that reproduces the bug.
- **Documentation** — corrections, clarifications, and guides.
- **Tooling and DX** — CLI ergonomics, error messages, scripts, integration helpers.
- **Dashboard improvements** — the local UI under `packages/ui`.

Two areas carry a higher bar and more scrutiny, because every scaffolded project depends on them:
the **scaffold template** (`templates/default/`, including the `.agents/skills` the agent follows
and the worked examples they teach from) and anything that **signs or submits transactions**
(`packages/sdk` signing paths, `packages/cli` dispatch/run flows). Open an **issue to discuss
first** before a large change there, rather than a surprise PR.

---

## Pull request process

- **One logical unit per PR.** Keep changes focused and reviewable.
- **Tests added or updated and passing.**
- **Docs updated** alongside any behavioral or command-surface change (`docs:check` will catch
  references to commands that don't exist — keep it green).
- **Conventional commit style**: `type(scope): imperative summary` — e.g.
  `fix(cli): handle missing RPC_URL in doctor`, `docs: clarify Docker key handling`. Present
  tense, no trailing period, body explains *why* when it isn't obvious.
- **No attribution footers** in commit messages (no `Co-Authored-By`, no tool signatures).
- Discussion happens in **GitHub issues** — open one for anything larger than a small fix.

### Reviews

Pull requests require review from the maintainer team (**@AlvaroAlonso-0**, **@dreski3**).
Documentation-only PRs are lighter-touch; changes to the scaffold template or signing paths get
the most scrutiny.

---

## Code style

- TypeScript, formatted and linted with [Biome](https://biomejs.dev) (`pnpm lint`).
- Match the style of the surrounding code; comments state what the code can't.
- **Terminology.** Like the protocol repo, the codebase and docs say **"security review"**, never
  "audit". Keep that consistent.

---

## Questions

For non-security questions, open an issue or email **hello@sail.money**.
Project site: <https://sail.money>.
