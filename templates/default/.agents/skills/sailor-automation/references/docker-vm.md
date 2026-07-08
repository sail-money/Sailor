# Docker — run locally or deploy to any machine

**Who this is for:** users with basic Docker knowledge. Works on your local machine, a cloud VM, or any managed container service.

**Best for:** users who want a portable, self-contained execution environment — build once, run anywhere. Also the right choice if you want to test locally and then move to a cloud VM or container service without changing anything.

---

## Requirements

- Docker installed on the machine where the agent will run: https://docs.docker.com/get-docker/
- `ci-keystore.json` present in the project root — generate it with `sailor keys export-ci`
- `RPC_URL` and `SAIL_PASSPHRASE` available as environment variables (never baked into the image)

---

## Build the image

From the project root (where `Dockerfile` lives):

```bash
docker build -t sailor-agent .
```

---

## Run locally

```bash
docker run -d --restart=always \
  -e RPC_URL=<your-rpc-url> \
  -e SAIL_PASSPHRASE=<your-passphrase> \
  -e CHAIN_ID=8453 \
  -e AGENT_INTERVAL=300 \
  --name sailor-agent \
  sailor-agent
```

- `--restart=always` — Docker restarts the container automatically on crash or machine reboot (requires Docker daemon set to start on boot)
- `AGENT_INTERVAL` — seconds between runs; default 300 (5 min). Set to `60` for per-minute, `3600` for hourly, `86400` for daily
- Logs: `docker logs -f sailor-agent`
- Stop: `docker stop sailor-agent && docker rm sailor-agent`

---

## Push to a registry (to deploy elsewhere)

Build the image once, push to a registry, pull it on any machine.

**Docker Hub**

```bash
docker tag sailor-agent <dockerhub-username>/sailor-agent:latest
docker push <dockerhub-username>/sailor-agent:latest
```

**GitHub Container Registry (GHCR)**

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <github-username> --password-stdin
docker tag sailor-agent ghcr.io/<github-username>/sailor-agent:latest
docker push ghcr.io/<github-username>/sailor-agent:latest
```

---

## Pull and run on any other machine

On the target machine (cloud VM, Raspberry Pi, VPS, etc.):

```bash
docker pull <registry>/<image>:latest

docker run -d --restart=always \
  -e RPC_URL=<your-rpc-url> \
  -e SAIL_PASSPHRASE=<your-passphrase> \
  -e CHAIN_ID=8453 \
  -e AGENT_INTERVAL=300 \
  <registry>/<image>:latest
```

No code changes — the same image runs everywhere that has Docker.

---

## Use with managed container services

The same image works with any managed container service. Pass env vars through the service's UI — no code changes needed.

| Service | Notes |
|---|---|
| AWS ECS / Fargate | Task definition with env vars; Fargate = no VM to manage |
| Google Cloud Run | Trigger on schedule via Cloud Scheduler |
| Azure Container Instances | Simple one-off or always-on container |
| Fly.io | `fly launch` + set secrets via `fly secrets set` |
| Railway | Point to image in registry, set env vars in dashboard |
| Render | Background worker from Docker image |

---

## Updating the agent

When you change your strategy code:

```bash
docker build -t sailor-agent .
docker tag sailor-agent <registry>/<image>:latest
docker push <registry>/<image>:latest
# on the target machine:
docker pull <registry>/<image>:latest
docker stop sailor-agent && docker rm sailor-agent
docker run -d --restart=always -e ... <registry>/<image>:latest
```
