#!/bin/sh
# Run as root in the container (only SETUID/SETGID/CHOWN). Starts the supervisor; it starts fake-web.mjs as the web UID.
set -e
export DATA_DIR=/data SUP_SOCKET=/run/mcpwarden/sup.sock WEB_UID=10001 WEB_GID=10001 SUP_IDLE_UNIT_MS=1500
export MASTER_KEY=topsecret BETTER_AUTH_SECRET=topsecret2 DATABASE_URL=postgres://x
export WEB_CMD='["node","/work/tests/container/fake-web.mjs"]'
mkdir -p /data && chown 0:0 /data
exec node /work/dist/supervisor/main.mjs
