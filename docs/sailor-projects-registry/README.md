# sailor-projects registry — setup

These files bootstrap the public registry repo (`sail-money/sailor-projects`) that
`sailor share` opens PRs into and `sailor replicate` downloads from.

## Layout

```
projects/<slug>/        # one shared project per folder (added by `sailor share` PRs)
.github/workflows/release-on-merge.yml   # zips a merged project → tagged release asset
.github/PULL_REQUEST_TEMPLATE/share.md   # review checklist
```

## How it works

1. `sailor share` (run inside an operator's project) builds a sanitized copy, opens a
   PR adding `projects/<slug>/`.
2. A maintainer reviews (the PR template checklist) and merges to `main`.
3. `release-on-merge.yml` packages `projects/<slug>/` as `<slug>.tar.gz` and publishes a
   release tagged `<slug>-v<n>` (auto-incrementing).
4. `sailor replicate <asset-url>` downloads that asset.

## Metrics

Per-project download counts come from the release asset `download_count`:

```bash
gh api repos/sail-money/sailor-projects/releases \
  --jq '.[] | "\(.tag_name): \(.assets[]?.download_count // 0)"'
```

This is the number a future rewards layer reads. Note: `download_count` is a raw,
unauthenticated CDN counter — fine for a popularity leaderboard, not trustworthy as a
payout ledger. For real rewards, front downloads with an authenticated proxy + DB.

## Setup steps

1. Create the repo `sail-money/sailor-projects` (public).
2. Copy `.github/` and an empty `projects/` into it; commit to `main`.
3. Ensure the share token (`SAIL_GH_TOKEN`) has `contents: write` + `pull_requests: write`.
