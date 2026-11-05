# syntax=docker/dockerfile:1
# Ziele: `slim` (nur Web-App, kein stdio) und `full` (Supervisor + uv/uvx + stdio-Worker). Standard-Ziel: full.

ARG NODE_IMAGE=node:24-bookworm-slim
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.9.0

FROM ${UV_IMAGE} AS uv

# --- Abhängigkeiten ---
FROM ${NODE_IMAGE} AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

# --- Build: Nuxt/Nitro-Artefakt, Supervisor-Bundle, Dump-Werkzeug ---
FROM deps AS build
COPY . .
RUN pnpm exec nuxt prepare && pnpm build && node scripts/build-supervisor.mjs

# --- Dump-Werkzeug (Umstieg PGlite -> Postgres): eigene, kleine node_modules ---
FROM ${NODE_IMAGE} AS tools
WORKDIR /opt/tools
RUN npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund @electric-sql/pglite@0.5.15 @electric-sql/pglite-tools@0.4.15
COPY --from=build /app/dist/tools/pglite-dump.mjs ./pglite-dump.mjs

# --- gemeinsame Basis ---
FROM ${NODE_IMAGE} AS base
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
# Web-Nutzer ohne Login-Shell; eigene UID/GID, nie 0
RUN groupadd --gid 10001 web && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin web
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=tools /opt/tools /opt/tools
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# --- slim: keine Capabilities nötig, stdio fest aus ---
FROM base AS slim
ENV STDIO_MODE=off IMAGE_TARGET=slim
RUN mkdir -p /data && chown web:web /data
USER web
VOLUME ["/data"]
CMD ["node", ".output/server/index.mjs"]

# --- full: Supervisor als root mit nur SETUID/SETGID/CHOWN (siehe compose.yaml), Web-App läuft als UID 10001 ---
FROM base AS full
ENV STDIO_MODE=auto IMAGE_TARGET=full WEB_UID=10001 WEB_GID=10001 SUP_SOCKET=/run/mcpwarden/sup.sock
COPY --from=uv /uv /uvx /usr/local/bin/
COPY --from=build /app/dist/supervisor ./dist/supervisor
# /data gehört root (der Supervisor prüft das); pgdata legt er selbst an und übergibt es der Web-UID
RUN mkdir -p /data /run/mcpwarden && chown root:root /data && chmod 755 /data
VOLUME ["/data"]
CMD ["node", "dist/supervisor/main.mjs"]
