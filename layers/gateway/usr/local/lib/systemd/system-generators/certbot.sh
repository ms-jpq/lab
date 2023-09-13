#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/timers.target.wants"

mkdir -v -p -- "$WANTS"

readarray -t -- SITES </usr/local/etc/default/certbot.env

for SITE in "${SITES[@]}"; do
  NAME="$(systemd-escape -- "${SITE%%=*}")"
  if [[ -n "$NAME" ]]; then
    ln -v -sf -- /usr/local/lib/systemd/system/1-certbot@.timer "$WANTS/1-certbot@$NAME.timer"
  fi
done
