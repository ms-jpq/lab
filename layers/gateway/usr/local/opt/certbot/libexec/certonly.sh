#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

HOST="$1"
DOMAIN="$2"
CONF=/var/lib/local/certbot
NGINX="$CONF/nginx"
LOG=/var/cache/local/certbot/logs
TMP="$(mktemp)"

mkdir -v -p -- "$NGINX" "$LOG"

readarray -t -- SITES </usr/local/etc/default/certbot.env
for SITE in "${SITES[@]}"; do
  NAME="${SITE%%=*}"
  if [[ "$NAME" == "$DOMAIN" ]]; then
    TOKEN="${SITE#*=}"
  fi
done

printf -- '%s\n' "dns_cloudflare_api_token = $TOKEN" >"$TMP"

CERTBOT=(
  /var/cache/local/certbot/venv/bin/certbot
  certonly
  --non-interactive --agree-tos
  --keep-until-expiring
  --expand
  --work-dir /var/tmp
  --config-dir "$CONF"
  --logs-dir "$LOG"
  --email "certbot+$HOST@$DOMAIN"
  --domains "$DOMAIN,*.$DOMAIN"
  --dns-cloudflare
  --dns-cloudflare-credentials "$TMP"
)

"${CERTBOT[@]}"

CHKSUM="$(cat -- "/var/lib/local/certbot/live/$DOMAIN"/* | b2sum)"
DOMAIN="$DOMAIN" CHKSUM="$CHKSUM" envsubst <"${0%/*}/../certbot.nginx" | sponge -- "$NGINX/$DOMAIN.nginx"
