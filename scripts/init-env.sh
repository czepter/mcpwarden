#!/bin/sh
# Creates a local .env from .env.example, with fresh random values.
# Never overwrites an existing .env.
set -eu
umask 077
cd "$(dirname "$0")/.."
if [ -e .env ]; then
  echo ".env already exists, nothing done."
  exit 0
fi
tmp=$(mktemp .env.XXXXXX)
trap 'rm -f "$tmp"' EXIT
secret=$(openssl rand -base64 32)
key=$(openssl rand -base64 32)
sed -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$secret|" \
    -e "s|^MASTER_KEY=.*|MASTER_KEY=$key|" \
    .env.example > "$tmp"
chmod 600 "$tmp"
mv "$tmp" .env
echo ".env created."
