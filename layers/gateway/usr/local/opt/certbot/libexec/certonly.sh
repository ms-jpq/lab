#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CONF=/var/lib/local/certbot
LOG=/var/cache/local/certbot/logs

mkdir -v -p -- "$LOG"

readarray -t -- SITES </usr/local/etc/default/certbot.env

CERTBOT=(
  /opt/python3/certbot/bin/certbot
  certonly
  --non-interactive --agree-tos
  --keep-until-expiring
  --expand
  --work-dir /var/tmp
  --webroot
  --webroot-path /run/local/nginx/acme
  --config-dir "$CONF"
  --logs-dir "$LOG"
  --email "$USER@$HOSTNAME"
)

for SITE in "${SITES[@]}"; do
  if [[ -n "$SITE" ]]; then
    CERTBOT+=(--domains "$SITE")
  fi
done

PYTHONPATH=/opt/python3/certbot exec -- "${CERTBOT[@]}"
