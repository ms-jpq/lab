#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
SSL="$RUN/ssl"
mkdir -p -- "$SSL"

for SITE in /var/lib/local/certbot/nginx/*.nginx; do
  NAME="${SITE##*/}"
  cp -f -- "$SITE" "$SSL/$NAME"
done
