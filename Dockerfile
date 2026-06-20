# ── stage 1: build + pack ─────────────────────────────────────────────────────
FROM node:24 AS builder

ARG PNPM_VERSION=11

RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /build
COPY . .
RUN pnpm install --frozen-lockfile

# Mirror what the CI publish workflow does: drop private flag, then pack.
# npm pack respects the "files" field so only published paths are included.
RUN pnpm run build
RUN npm pkg delete private
RUN npm pack --pack-destination /tmp

# ── stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-slim

# tsx is a runtime dep: the CLI shell-spawns it to compile user TypeScript agent code
RUN npm install -g tsx

# Install sailor from the packed tarball (exact same files as npm publish)
COPY --from=builder /tmp/sailor-*.tgz /tmp/sailor.tgz
RUN npm install -g /tmp/sailor.tgz && rm /tmp/sailor.tgz

# User agent projects are mounted here at runtime via -v $(pwd):/workspace
WORKDIR /workspace

# Port defaults — all overridable via env vars at runtime
ENV PORT=3334
ENV SAILOR_STATION_PORT=3141
ENV SAILOR_TEST_PORT=14333

# Signals to sailor init/update that commands run via docker exec.
# Override SAILOR_CONTAINER_NAME to match your --name flag:
#   docker run --name myproject -e SAILOR_CONTAINER_NAME=myproject ...
ENV SAILOR_INSTALL_MODE=docker
ENV SAILOR_CONTAINER_NAME=agent

EXPOSE 3334
# Station / signing daemon (only one process in Docker, always binds here)   
EXPOSE 3141
# Test server
EXPOSE 14333

# Keep container alive for `docker exec -it <name> sailor <command>` usage
CMD ["sleep", "infinity"]
