# ── stage 1: build + pack ─────────────────────────────────────────────────────
FROM node:24 AS builder

ARG PNPM_VERSION=11

RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /build
COPY . .
RUN pnpm install --frozen-lockfile
# Build each package in order so Docker layer-caches each step independently
# and so the SDK dist is written to disk before esbuild bundles the CLI.
RUN pnpm --filter @sail/sdk build
RUN pnpm --filter sailor    build
RUN pnpm --filter sailor-ui build
# Mirror what the CI publish workflow does: drop private flag, then pack.
# npm pack respects the "files" field so only published paths are included.
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

# UI dashboard
EXPOSE 3334
# Station / signing daemon (only one process in Docker, always binds here)   
EXPOSE 3141
# Test server
EXPOSE 14333

# Keep container alive for `docker exec -it <name> sailor <command>` usage
CMD ["sleep", "infinity"]
