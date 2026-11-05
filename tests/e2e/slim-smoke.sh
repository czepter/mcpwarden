#!/bin/sh
# Slim smoke: the image target `slim` (web app only) starts without capabilities, /healthz and /readyz answer, the web app runs as UID 10001,
# stdio is fixed off (even after "stdio.enabled" by the admin) and a stdio upstream is rejected.
# Usage: sh tests/e2e/slim-smoke.sh   (Docker required; SMOKE_NO_BUILD=1 uses an existing image mcpwarden:slim;
#          NODE_IMAGE=<base> builds with your own base, e.g. with a proxy CA)
set -eu
cd "$(dirname "$0")/../.."
NAME=mcpw-slim-smoke
PORT=${SMOKE_SLIM_PORT:-3918}
J=$(mktemp)
cleanup() { docker logs --tail 40 "$NAME" >"$J.log" 2>&1 || true; docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm -f "$NAME-data" >/dev/null 2>&1 || true; rm -f "$J" "$J.log"; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; docker logs --tail 60 "$NAME" 2>&1 || true; exit 1; }
wait_http() { # url, erwarteter Status
  i=0
  while [ $i -lt 60 ]; do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$1" || true)" = "$2" ] && return 0
    i=$((i + 1)); sleep 1
  done
  return 1
}
post() { curl -s -b "$J" -c "$J" -H 'content-type: application/json' -H "origin: http://localhost:$PORT" -X "$1" "http://localhost:$PORT$2" ${3:+-d "$3"}; }

if [ "${SMOKE_NO_BUILD:-}" != 1 ]; then
  docker build --target slim -t mcpwarden:slim ${NODE_IMAGE:+--build-arg NODE_IMAGE="$NODE_IMAGE" --network host} . >/dev/null || fail "build slim"
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
# Without any capability and without privilege gain: the slim target needs none of that
docker run -d --name "$NAME" -p "$PORT:3000" --cap-drop ALL --security-opt no-new-privileges:true -v "$NAME-data:/data" \
  -e BASE_URL="http://localhost:$PORT" -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" -e MASTER_KEY="$(openssl rand -base64 32)" \
  mcpwarden:slim >/dev/null || fail "docker run"
wait_http "http://localhost:$PORT/healthz" 200 || fail "healthz"
wait_http "http://localhost:$PORT/readyz" 200 || fail "readyz"
echo "ok: slim healthz/readyz (cap-drop ALL, no-new-privileges)"

[ "$(docker exec "$NAME" awk '/^Uid:/ {print $2}' /proc/1/status)" = 10001 ] || fail "web app does not run as UID 10001"
[ "$(docker exec "$NAME" awk '/^CapEff:/ {print $2}' /proc/1/status)" = 0000000000000000 ] || fail "web app has capabilities"
docker exec "$NAME" sh -c 'test ! -e dist/supervisor' || fail "supervisor bundle in the slim image"
echo "ok: uid 10001, CapEff=0, no supervisor bundle"

post POST /api/auth/sign-up/email '{"name":"Admin","email":"admin@example.com","password":"admin-password-123"}' | grep -q '"role":"admin"' || fail "first registration"
caps=$(post GET /api/me/capabilities)
echo "$caps" | grep -q '"stdio":{"allowed":false,"reason":"image_slim"}' || fail "stdio must be blocked in the slim image (image_slim): $caps"
# The admin setting does not open stdio here either
post PUT /api/admin/settings '{"stdio.enabled":true}' | grep -q '"stdio.enabled":true' || fail "settings"
caps=$(post GET /api/me/capabilities)
echo "$caps" | grep -q '"stdio":{"allowed":false,"reason":"image_slim"}' || fail "stdio not blocked after stdio.enabled: $caps"
code=$(curl -s -o "$J.out" -w '%{http_code}' -b "$J" -c "$J" -H 'content-type: application/json' -H "origin: http://localhost:$PORT" -X POST "http://localhost:$PORT/api/upstreams" \
  -d '{"name":"Local","slug":"local","type":"stdio","command":"echo"}')
[ "$code" = 403 ] && grep -q 'stdio_not_allowed' "$J.out" || fail "stdio upstream should have been rejected (HTTP $code): $(cat "$J.out")"
rm -f "$J.out"
echo "ok: stdio locked (image_slim), stdio upstream refused"

docker stop -t 40 "$NAME" >/dev/null || fail "stop"
[ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = 0 ] || fail "exit code$(docker inspect -f '{{.State.ExitCode}}' "$NAME")"
echo "ok: graceful stop (exit 0)"
echo "SLIM SMOKE OK"
