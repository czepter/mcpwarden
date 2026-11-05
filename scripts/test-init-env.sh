#!/bin/sh
# Prüft: .env hat Modus 600, vorhandene .env bleibt unverändert.
set -eu
d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT
mkdir "$d/scripts"
cp "$(dirname "$0")/init-env.sh" "$d/scripts/"
cp "$(dirname "$0")/../.env.example" "$d/"
sh "$d/scripts/init-env.sh" >/dev/null
mode=$(stat -c %a "$d/.env" 2>/dev/null || stat -f %Lp "$d/.env")
[ "$mode" = 600 ] || { echo "FAIL: mode $mode"; exit 1; }
[ "$(ls -A "$d" | grep -c '^\.env\.[A-Za-z0-9]\{6\}$')" = 0 ] || { echo "FAIL: temp left"; exit 1; }
echo keep > "$d/.env"
sh "$d/scripts/init-env.sh" >/dev/null
[ "$(cat "$d/.env")" = keep ] || { echo "FAIL: overwritten"; exit 1; }
echo "OK: .env mode 600, not overwritten"
