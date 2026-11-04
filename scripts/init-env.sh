#!/bin/sh
# Legt eine lokale .env aus .env.example an, mit frischen Zufallswerten.
# Überschreibt eine vorhandene .env nie.
set -eu
cd "$(dirname "$0")/.."
if [ -e .env ]; then
  echo ".env existiert bereits, nichts getan."
  exit 0
fi
secret=$(openssl rand -base64 32)
key=$(openssl rand -base64 32)
sed -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$secret|" \
    -e "s|^MASTER_KEY=.*|MASTER_KEY=$key|" \
    .env.example > .env
echo ".env angelegt."
