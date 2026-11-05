#!/bin/sh
# Compose-Smoke: das Beispiel-Compose (compose.yaml, Ziel full) startet frisch, /healthz und /readyz antworten,
# Erst-Registrierung -> Admin, Einladung, Upstream anlegen, Neustart behält die Daten, Härtung im laufenden Container.
# Aufruf: sh tests/e2e/compose-smoke.sh   (Docker nötig; SMOKE_NO_BUILD=1 nutzt ein vorhandenes Image mcpwarden:full;
#          SMOKE_PG=1 startet zusätzlich das Compose-Profil `pg` und nutzt Postgres statt PGlite)
set -eu
cd "$(dirname "$0")/../.."
P=mcpw-smoke
PORT=${SMOKE_PORT:-3917}
ENVF=$(mktemp)
dc() { docker compose -p $P --env-file "$ENVF" ${SMOKE_PG:+--profile pg} "$@"; }
trap 'dc down -v >/dev/null 2>&1 || true; rm -f "$ENVF" "$ENVF.jar"' EXIT
umask 077
{
  echo "BASE_URL=http://localhost:$PORT"
  echo "PORT=$PORT"
  echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
  echo "MASTER_KEY=$(openssl rand -base64 32)"
  echo "RATE_LIMIT=off"
  [ "${SMOKE_PG:-}" = 1 ] && echo "DATABASE_URL=postgres://postgres:change-me@postgres:5432/mcpwarden"
  true
} > "$ENVF"
fail() { echo "FAIL: $*"; dc logs --no-color --tail 60 || true; exit 1; }
wait_http() { # url, erwarteter Status
  i=0
  while [ $i -lt 90 ]; do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$1" || true)" = "$2" ] && return 0
    i=$((i + 1)); sleep 1
  done
  return 1
}
J="$ENVF.jar"
post() { curl -s -b "$J" -c "$J" -H 'content-type: application/json' -H "origin: http://localhost:$PORT" -X "$1" "http://localhost:$PORT$2" -d "$3"; }

if [ "${SMOKE_NO_BUILD:-}" = 1 ]; then
  # Image `mcpwarden:full` wurde vorher gebaut (z. B. in Umgebungen, in denen der Build ein eigenes Netz/CA braucht)
  dc up -d --no-build >/dev/null || fail "up"
else
  dc up -d --build >/dev/null || fail "up"
fi
wait_http "http://localhost:$PORT/healthz" 200 || fail "healthz"
wait_http "http://localhost:$PORT/readyz" 200 || fail "readyz"
echo "ok: healthz/readyz"

# Härtung im laufenden Container
CID=$(dc ps -q mcpwarden)
[ "$(docker inspect -f '{{.HostConfig.SecurityOpt}}' "$CID")" = "[no-new-privileges:true]" ] || fail "no-new-privileges fehlt"
CAPS=$(docker inspect -f '{{.HostConfig.CapDrop}} {{.HostConfig.CapAdd}}' "$CID")
echo "$CAPS" | grep -q '^\[ALL\]' || fail "cap_drop ALL fehlt: $CAPS"
for c in SETUID SETGID CHOWN; do echo "$CAPS" | grep -q "$c" || fail "cap_add $c fehlt: $CAPS"; done
[ "$(docker inspect -f '{{len .HostConfig.CapAdd}}' "$CID")" = 3 ] || fail "genau drei Capabilities erwartet: $CAPS"
WEBPID=$(docker exec "$CID" sh -c "for p in /proc/[0-9]*; do grep -q '.output/server/index.mjs' \$p/cmdline 2>/dev/null && basename \$p; done | head -1")
[ "$(docker exec "$CID" awk '/^Uid:/ {print $2}' /proc/"$WEBPID"/status)" = 10001 ] || fail "Web-App läuft nicht als UID 10001"
[ "$(docker exec "$CID" awk '/^CapEff:/ {print $2}' /proc/"$WEBPID"/status)" = 0000000000000000 ] || fail "Web-App hat Capabilities"
echo "ok: web uid 10001, CapEff=0, caps SETUID/SETGID/CHOWN, no-new-privileges"

# Full-Stack-Smoke (tests/smoke/flow.ts) gegen den Container: Erst-Registrierung, Login, Einladung, PAT, OAuth 2.1 (DCR, PKCE,
# Consent, Refresh), /mcp tools/list + tools/call ueber ein Fake-MCP auf dem Host, Mandantentrennung, Audience, Widerruf.
# Der Container erreicht das Fake-MCP ueber das Gateway seines Compose-Netzes (Admin gibt es per ssrf.allow frei).
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CID")
GW=$(docker network inspect -f '{{(index .IPAM.Config 0).Gateway}}' "$NET")
[ -n "$GW" ] || fail "Gateway des Compose-Netzes nicht gefunden"
SMOKE_BASE_URL="http://localhost:$PORT" SMOKE_FAKE_HOST="$GW" SMOKE_FAKE_LISTEN=0.0.0.0 SMOKE_SSRF_ALLOW="$GW/32" \
  pnpm exec tsx tests/smoke/run.ts || fail "Full-Stack-Smoke"
echo "ok: full-stack smoke (register, invite, PAT, OAuth+PKCE, /mcp via fake upstream, isolation, revocation)"

# Fachlicher Durchlauf (der Admin existiert durch den Smoke)
post POST /api/auth/sign-in/email '{"email":"admin@example.com","password":"admin-passwort-123"}' >/dev/null
caps=$(post GET /api/me/capabilities '')
echo "$caps" | grep -q '"role":"admin"' || fail "capabilities: $caps"
echo "$caps" | grep -q '"stdio":{"allowed":false,"reason":"instance_disabled"}' || fail "stdio-Grund: $caps"
post PUT /api/admin/settings '{"stdio.enabled":true}' | grep -q '"stdio.enabled":true' || fail "settings"
caps=$(post GET /api/me/capabilities '')
echo "$caps" | grep -q '"stdio":{"allowed":true}' || fail "stdio für Admin erlaubt (Supervisor erreichbar): $caps"
inv=$(post POST /api/admin/invites '{}')
echo "$inv" | grep -q '/invite/' || fail "Einladung: $inv"
post POST /api/upstreams '{"name":"Demo","slug":"demo","type":"http","url":"https://example.com/mcp"}' | grep -q '"slug":"demo"' || fail "Upstream anlegen"
echo "ok: registration, capabilities, settings, invite, upstream"

# Neustart: Daten bleiben (Volume)
dc restart >/dev/null || fail "restart"
wait_http "http://localhost:$PORT/readyz" 200 || fail "readyz nach Neustart"
post POST /api/auth/sign-in/email '{"email":"admin@example.com","password":"admin-passwort-123"}' >/dev/null
post GET /api/upstreams '' | grep -q '"slug":"demo"' || fail "Daten nach Neustart weg"
echo "ok: restart keeps data"

# SIGTERM: sauberes Ende innerhalb der Frist (Exit 0)
dc stop -t 40 >/dev/null || fail "stop"
[ "$(docker inspect -f '{{.State.ExitCode}}' "$CID")" = 0 ] || fail "Exit-Code $(docker inspect -f '{{.State.ExitCode}}' "$CID")"
echo "ok: graceful stop (exit 0)"
echo "SMOKE OK"
