# Harbor registry — setup

These files bootstrap the Harbor registry repo (`sail-money/harbor`): the library of ready-to-run
money agents. `sailor harbor publish` opens pull requests into it, `sailor harbor list` reads its
releases, and `sailor harbor create <slug>` downloads a released agent from it.

## Layout

```
blueprints/<slug>/<slug>.tar.gz          # packed blueprint (added by `sailor harbor publish` PRs)
blueprints/<slug>/manifest.json          # its manifest: per-file SHA-256 + self-digest, for review
.github/workflows/release-on-merge.yml   # turns a merged blueprint into a tagged release asset
.github/PULL_REQUEST_TEMPLATE/blueprint.md  # review checklist for a blueprint PR
```

`projects/<slug>/` (source projects submitted by `sailor share`) is experimental: `share` and
`clone` are hidden behind `SAILOR_EXPERIMENTAL=1` and a `projects/` release carries no manifest,
so `harbor create` cannot import it. Keep the directory out of the public repo until that flow
is finished.

## How it works

1. `sailor harbor publish` (run inside a blueprint project) packs the agent surface, redacts the
   publisher's identity, scans for secrets, hashes every file into `blueprint.manifest.json`, and
   opens a PR adding `blueprints/<slug>/`. `--release` skips review and creates the release
   directly (maintainers only; needs `contents: write`).
2. A maintainer reviews the PR. The tarball is opaque in the GitHub diff, so review it locally:

   ```bash
   gh pr checkout <n>
   sailor blueprint verify blueprints/<slug>/<slug>.tar.gz
   sailor blueprint import blueprints/<slug>/<slug>.tar.gz --dry-run   # in a scratch project
   ```

3. `release-on-merge.yml` publishes the merged tarball as a release tagged `<slug>-v<n>`, where
   `n` is one more than the highest existing `<slug>-v*` tag.
4. `sailor harbor create <slug>` downloads the highest-numbered release for the slug, verifies
   every file against the manifest, shows the import plan, and imports on confirmation.

## Trust

A blueprint is verified for integrity (every file matches its hash), not for publisher identity.
Releases are unsigned. The review step and the `main` branch protection are the only assurance of
origin, so require a review before merge and restrict who can push to `main`.

## Metrics

Per-agent download counts come from the release asset `download_count`:

```bash
gh api repos/sail-money/harbor/releases \
  --jq '.[] | "\(.tag_name): \(.assets[]?.download_count // 0)"'
```

This is a raw, unauthenticated CDN counter: fine for a popularity view, not a ledger.

## Setup steps

1. Create the repo `sail-money/harbor` (public).
2. Copy `.github/` and `scripts/` into it; submit a pull request.
3. Protect `main`: require a pull request and one review; no direct pushes.
4. The token used by `sailor harbor publish --release` needs `contents: write`; a regular
   publisher needs only the ability to open a PR (fork + PR is handled automatically).
