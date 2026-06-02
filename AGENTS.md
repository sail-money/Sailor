# Sailor — Operator Toolkit for Sail Protocol

This is the Sailor monorepo. It ships a CLI (`sailor`), a local UI server, and an SDK for building and running autonomous on-chain agents via Sail Protocol SMAs.

## Packages

| Package | What it does |
|---------|-------------|
| `packages/cli` | The `sailor` CLI — init, keys, account, mandate, station, ui, run |
| `packages/ui` | Local dashboard + browser-based account setup at localhost:3333 |
| `packages/sdk` | TypeScript SDK — SailorClient, LocalKeyring, kernel ABIs, deployments |
| `packages/chains` | Per-chain registry |

## What an end user does after install

1. `sailor ui start` — starts the local server
2. Open `http://localhost:3333` — browser guides account setup (choose chain, connect wallet, generate agent key, deploy SMA)
3. Configure `.sail/.env.local` (RPC URL, SAIL_API_KEY, SAIL_PASSPHRASE)
4. Fund the agent key with ETH for gas
5. `sailor mandate prepare` → approve in browser
6. `sailor run` — agent starts executing

## Development

```bash
pnpm install
pnpm build          # build all packages
pnpm test           # API tests (vitest, no chain needed)
pnpm test:ui        # browser smoke tests (playwright, needs pnpm build first)
```

## Key conventions
- `SAIL_DIR` env var points to the `.sail/` directory the server reads from
- `SERVE_DIST=1` makes the UI server also serve the built React app
- Test fixtures live in `packages/ui/test/fixtures/` — isolated tmp dirs, no real RPC
- All CLI commands support `--json` and respect `SAIL_PASSPHRASE` for headless use
