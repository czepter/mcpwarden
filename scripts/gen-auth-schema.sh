#!/bin/sh
# Erzeugt das Drizzle-Schema aus der Better-Auth-Konfiguration (deterministisch, nicht von Hand editieren).
set -eu
cd "$(dirname "$0")/.."
out=server/db/schema/auth.ts
pnpm dlx auth@1.7.17 generate --config server/auth/auth.cli.ts --output "$out" --adapter drizzle --dialect postgresql -y
{ printf '// GENERIERT von scripts/gen-auth-schema.sh (auth generate). Nicht editieren.\n'; cat "$out"; } > "$out.tmp"
mv "$out.tmp" "$out"
