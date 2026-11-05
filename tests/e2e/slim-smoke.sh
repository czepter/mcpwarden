#!/bin/sh
# Slim-Smoke: das Image-Ziel `slim` (nur Web-App) startet ohne Capabilities, /healthz und /readyz antworten, die Web-App läuft als UID 10001,
# stdio ist fest aus (auch nach "stdio.enabled" durch den Admin) und ein stdio-Upstream wird abgelehnt.
# Aufruf: sh tests/e2e/slim-smoke.sh   (Docker nötig; SMOKE_NO_BUILD=1 nutzt ein vorhandenes Image mcpwarden:slim;
#          NODE_IMAGE=<Basis> baut mit eigener Basis, z. B. mit Proxy-CA)
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
# Ohne jede Capability und ohne Rechtegewinn: das Ziel slim braucht nichts davon
docker run -d --name "$NAME" -p "$PORT:3000" --cap-drop ALL --security-opt no-new-privileges:true -v "$NAME-data:/data" \
  -e BASE_URL="http://localhost:$PORT" -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" -e MASTER_KEY="$(openssl rand -base64 32)" \
  mcpwarden:slim >/dev/null || fail "docker run"
wait_http "http://localhost:$PORT/healthz" 200 || fail "healthz"
wait_http "http://localhost:$PORT/readyz" 200 || fail "readyz"
echo "ok: slim healthz/readyz (cap-drop ALL, no-new-privileges)"

[ "$(docker exec "$NAME" awk '/^Uid:/ {print $2}' /proc/1/status)" = 10001 ] || fail "Web-App läuft nicht als UID 10001"
[ "$(docker exec "$NAME" awk '/^CapEff:/ {print $2}' /proc/1/status)" = 0000000000000000 ] || fail "Web-App hat Capabilities"
docker exec "$NAME" sh -c 'test ! -e dist/supervisor' || fail "Supervisor-Bundle im Slim-Image"
echo "ok: uid 10001, CapEff=0, kein Supervisor-Bundle"

post POST /api/auth/sign-up/email '{"name":"Admin","email":"admin@example.com","password":"admin-passwort-123"}' | grep -q '"role":"admin"' || fail "Erst-Registrierung"
caps=$(post GET /api/me/capabilities)
echo "$caps" | grep -q '"stdio":{"allowed":false,"reason":"image_slim"}' || fail "stdio muss im Slim-Image gesperrt sein (image_slim): $caps"
# Auch die Admin-Einstellung öffnet stdio hier nicht
post PUT /api/admin/settings '{"stdio.enabled":true}' | grep -q '"stdio.enabled":true' || fail "settings"
caps=$(post GET /api/me/capabilities)
echo "$caps" | grep -q '"stdio":{"allowed":false,"reason":"image_slim"}' || fail "stdio nach stdio.enabled nicht gesperrt: $caps"
code=$(curl -s -o "$J.out" -w '%{http_code}' -b "$J" -c "$J" -H 'content-type: application/json' -H "origin: http://localhost:$PORT" -X POST "http://localhost:$PORT/api/upstreams" \
  -d '{"name":"Local","slug":"local","type":"stdio","command":"echo"}')
[ "$code" = 403 ] && grep -q 'stdio_not_allowed' "$J.out" || fail "stdio-Upstream hätte abgelehnt werden müssen (HTTP $code): $(cat "$J.out")"
rm -f "$J.out"
echo "ok: stdio locked (image_slim), stdio upstream refused"

docker stop -t 40 "$NAME" >/dev/null || fail "stop"
[ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = 0 ] || fail "Exit-Code $(docker inspect -f '{{.State.ExitCode}}' "$NAME")"
echo "ok: graceful stop (exit 0)"
echo "SLIM SMOKE OK"
