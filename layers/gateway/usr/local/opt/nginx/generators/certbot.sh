#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
SSL="$RUN/ssl"
LIVE=/var/lib/local/certbot/live

mkdir -p -- "$SSL"

for DIR in "$LIVE"/*; do
  DOMAIN="${DIR##*/}"
  if ! [[ -d "$DIR" ]]; then
    continue
  fi
  CHKSUM="$(cat -- "$DIR"/* | b3sum --no-names)"
  DOMAIN="$DOMAIN" CHKSUM="$CHKSUM" envsubst <'/usr/local/opt/certbot/certbot.nginx' | sponge -- "$SSL/$DOMAIN.nginx"
done
