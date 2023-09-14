#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
SSL="$RUN/ssl"
mkdir -p -- "$SSL"

readarray -t -- SITES </usr/local/etc/default/certbot.env
for SITE in "${SITES[@]}"; do
  NAME="${SITE%%=*}"
  if [[ -n "$NAME" ]]; then
    cp -f -- "/var/lib/local/certbot/nginx/$NAME.nginx" "$SSL/$NAME.nginx"
  fi
done
