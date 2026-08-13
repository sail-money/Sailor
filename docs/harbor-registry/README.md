# Harbor registry — setup

These files bootstrap the public Harbor registry repo (`sail-money/harbor`). `sailor share`
opens PRs into it; `sailor harbor list` and `sailor clone` read from it; and
`sailor harbor create` downloads a released agent from it.

## Layout

```
projects/<slug>/                        # one shared project per folder (added by `sailor share` PRs)
projects/.gitkeep                       # keeps the empty projects/ dir tracked in git
.github/workflows/release-on-merge.yml  # packages a merged project into a tagged release asset
.github/PULL_REQUEST_TEMPLATE/share.md  # review checklist
```

## How it works

1. `sailor share` (run inside an operator's project) builds a sanitized copy, opens a
   PR adding `projects/<slug>/`.
2. A maintainer reviews (the PR template checklist) and merges to `main`.
3. `release-on-merge.yml` packages `projects/<slug>/` as `<slug>.tar.gz` and publishes a
   release tagged `<slug>-v<n>` (auto-incrementing).
4. `sailor clone <source>` and `sailor harbor create <slug>` download that asset.

## Metrics

Per-project download counts come from the release asset `download_count`:

```bash
gh api repos/sail-money/harbor/releases \
  --jq '.[] | "\(.tag_name): \(.assets[]?.download_count // 0)"'
```

This is the number a future rewards layer reads. Note: `download_count` is a raw,
unauthenticated CDN counter — fine for a popularity leaderboard, not trustworthy as a
payout ledger. For real rewards, front downloads with an authenticated proxy + DB.

## Setup steps

1. Create the repo `sail-money/harbor` (public).
2. Copy `.github/` and `projects/` (including `.gitkeep`) into it; commit to `main`.
3. Ensure the share token (`SAIL_GH_TOKEN`) has `contents: write` + `pull_requests: write`.
