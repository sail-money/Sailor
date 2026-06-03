# sailor

Start a new agent project with `npx sailor init <name>` from inside your AI coding
assistant, or install globally for direct command use and CI/CD.

CLI operator toolkit for Sail Protocol. Run `sailor --help` to see all commands.

```sh
npm install -g sailor
sailor init my-fund
```

## Commands

- `sailor init [name]` — scaffold a new agent project from a template
- `sailor keys generate|show` — generate/show the agent wallet and mandate signer keys
- `sailor account create` — create a new SMA on-chain
- `sailor onboard` — set up an SMA, register a permission, and confirm the agent is operational
- `sailor mandate prepare` — review the permissions attached to your SMA
- `sailor mandate sign` — confirm the permissions authorized for your SMA
- `sailor mandate deploy` — deploy a Foundry-compiled permission contract
- `sailor mandate attach` — register an already-deployed permission on an SMA
- `sailor mandate revoke` — revoke permission(s) from an SMA
- `sailor mandate templates` — how to author your own permission contract
- `sailor mandate list` — list permission contracts deployed from this project
- `sailor owner connect|show` — detect and persist the project owner (your connected wallet)
- `sailor scan` — discover the owner's SMAs, their permissions, and local keys
- `sailor status` — show account, permission, and session status
- `sailor doctor` — read-only preflight before dispatching (gas-free)
- `sailor run` — run the agent execution loop
- `sailor session pause|resume` — control the agent session
- `sailor station start|status|stop` — manage the browser signing daemon
- `sailor ui start|stop|status` — start/stop the local dashboard
```
