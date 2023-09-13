#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

HOST="$1"
DOMAIN="$2"

CERTBOT=(
  /var/lib/local/certbot/venv/bin/certbot
  certonly
  --non-interactive --agree-tos
  --work-dir /var/tmp
  --config-dir /var/lib/local/certbot/config
  --logs-dir /var/log/local/certbot
  --email "certbot+$HOST@$DOMAIN"
  --expand
  --domains "$DOMAIN"
  --dns-cloudflare
  --dns-cloudflare-credentials "/usr/local/etc/default/$DOMAIN.certbot.env"
)

"${CERTBOT[@]}"

DOMAIN="$DOMAIN" envsubst "${0%/*}/../certbot.nginx" | sponge -- ""
